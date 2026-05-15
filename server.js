// =============================================================================
// server.js — Car Thief Online
// Node.js WebSocket + HTTP server. Handles rooms, game state, day timer.
//
// Usage:
//   node server.js
//   Open http://localhost:8080 in a browser.
//
// Requires: ws  (npm install ws)
// =============================================================================

'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const logic  = require('./logic.js');
const admin  = require('firebase-admin');
const svcAcct = process.env.SERVICE_ACCOUNT_KEY
  ? JSON.parse(process.env.SERVICE_ACCOUNT_KEY)
  : require('./serviceAccountKey.json'); // local dev fallback

admin.initializeApp({
  credential: admin.credential.cert(svcAcct),
});

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------
const PORT         = process.env.PORT || 8080;
const DAY_DURATION = 5 * 60 * 1000; // 5 minutes per in-game day (ms)
const STATIC_ROOT  = __dirname;

// MIME types for static file serving
const MIME = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.bmp':  'image/bmp',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

// ---------------------------------------------------------------------------
// HTTP — static file server
// ---------------------------------------------------------------------------
const httpServer = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(STATIC_ROOT, urlPath);

  // Safety check — prevent directory traversal outside project root
  if (!filePath.startsWith(STATIC_ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------------------------------------------------------------------------
// ROOM STORE
// ---------------------------------------------------------------------------

/**
 * rooms: Map<code, Room>
 *
 * Room shape:
 * {
 *   code:          string,
 *   hostId:        string,
 *   started:       boolean,
 *   day:           number,
 *   dayTimer:      NodeJS.Timeout | null,
 *   players:       Map<id, { ws, name, portraitSrc, profession, connected }>,
 *   playerStates:  Map<id, gameState>,
 *   locationPools: {},      // shared — all players see the same vehicles
 *   pendingClaims: {},    // uid -> { locId, vehicle, playerId } — locked during active steal
 *   pendingRace:   { challengerId, targetId, vehicle } | null,
 * }
 */
const rooms = new Map();
const browsers = new Set(); // WS connections browsing room list (pre-auth)

function makeRoomCode() {
  // 4 uppercase letters — easy to read aloud (e.g. "XKQZ")
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4);
}

function makePlayerId() {
  return 'p' + crypto.randomBytes(4).toString('hex');
}

/** Broadcast a message to every connected player in a room */
function broadcast(room, msg) {
  const payload = JSON.stringify(msg);
  for (const [, p] of room.players) {
    if (p.connected && p.ws.readyState === 1 /* OPEN */) {
      p.ws.send(payload);
    }
  }
}

/** Send a message to one specific player */
function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function pushRoomList() {
  const list = [...rooms.values()]
    .filter(r => !r.started && r.isPublic)
    .map(r => ({
      code:        r.code,
      roomName:    r.roomName,
      hostName:    [...r.players.values()][0]?.name || '?',
      playerCount: r.players.size,
    }));
  const payload = JSON.stringify({ type: 'room_list', rooms: list });
  for (const ws of browsers) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

/** Return a safe player summary list (no ws reference) */
function playerList(room) {
  return [...room.players.entries()].map(([id, p]) => ({
    id, name: p.name, portraitSrc: p.portraitSrc, profession: p.profession,
    connected: p.connected,
  }));
}

// ---------------------------------------------------------------------------
// DAY TIMER
// ---------------------------------------------------------------------------

function startDayTimer(room) {
  if (room.dayTimer) clearInterval(room.dayTimer);
  room.dayTimer = setInterval(() => {
    room.day++;
    // Advance every player's state
    for (const [id, state] of room.playerStates) {
      const msg = logic.advanceDay(state);
      const p = room.players.get(id);
      if (p && p.ws && p.ws.readyState === 1) {
        send(p.ws, { type:'day_advanced', state, msg, day: room.day });
      }
    }
    // Refresh shared vehicle pools
    refreshRoomPools(room);
    broadcast(room, { type:'pool_update', locationPools: room.locationPools });
    console.log(`[${room.code}] Day ${room.day} began.`);
  }, DAY_DURATION);
}

function stopDayTimer(room) {
  if (room.dayTimer) { clearInterval(room.dayTimer); room.dayTimer = null; }
}

// ---------------------------------------------------------------------------
// VEHICLE POOL HELPERS  (server-side — mirrors logic in game.js)
// ---------------------------------------------------------------------------

// Inlined from game.js; keep in sync.
const VEHICLES_DATA = require('./vehicles.json');

function _shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function _mkUid() { return 'v' + Math.random().toString(36).slice(2, 9); }

function _filterByLocType(all, locType) {
  switch (locType) {
    case 'racing':      return all.filter(v => v.isRaceWorthy && !v.isMoto && !v.isTruck);
    case 'residential': return all.filter(v => !v.isMoto && !v.isTruck && v.price <= 40000);
    case 'busy':        return all.filter(v => !v.isMoto && !v.isTruck);
    default:            return all.filter(v => !v.isTruck);
  }
}

function _enrichVehicle(v, locId) {
  const spec  = [v.body, v.seats ? `${v.seats} seats` : null, v.engine].filter(Boolean).join(', ');
  const sheet = Math.ceil(v.imgIdx / 10);
  return Object.assign({}, v, {
    uid:       _mkUid(), locId,
    condition: 30 + Math.floor(Math.random() * 66),
    img:       `Graphics/pixel_cars/cars${String(sheet).padStart(2,'0')}.png`,
    frameX:    ((v.imgIdx - 1) % 10) * 64,
    spec,
  });
}

function _generatePool(locId, locType, count) {
  const all      = VEHICLES_DATA.filter(v => v.price > 0);
  let   filtered = _filterByLocType(all, locType);
  if (filtered.length < 3) filtered = all;
  const n = count != null ? count : 3 + Math.floor(Math.random() * 3);
  return _shuffle(filtered).slice(0, n).map(v => _enrichVehicle(v, locId));
}

function initRoomPools(room, locDefs) {
  room.locationPools = {};
  for (const loc of locDefs) {
    room.locationPools[loc.id] = _generatePool(loc.id, loc.type);
  }
  room.locDefs = locDefs;
}

function refreshRoomPools(room) {
  if (!room.locDefs) return;
  for (const loc of room.locDefs) {
    let pool = room.locationPools[loc.id] || [];
    pool = pool.filter(() => Math.random() > 0.20);
    if (pool.length < 2) {
      pool.push(..._generatePool(loc.id, loc.type, 2 - pool.length + Math.floor(Math.random() * 2)));
    }
    room.locationPools[loc.id] = pool;
  }
}

// ---------------------------------------------------------------------------
// MESSAGE HANDLERS
// ---------------------------------------------------------------------------

function handleMessage(ws, playerId, roomCode, data) {
  const room = rooms.get(roomCode);

  switch (data.type) {

    // ── start_game ─────────────────────────────────────────────────────────
    // Host triggers this. Server initialises a playerState for every player,
    // builds shared vehicle pools, starts day timer.
    case 'start_game': {
      if (!room || room.hostId !== playerId || room.started) return;
      if (room.players.size < 1) { send(ws, { type:'error', msg:'Need at least 1 player.' }); return; }
      room.started = true;
      // Build per-player states
      for (const [id, p] of room.players) {
        const state = logic.initState(p.name, p.portraitSrc, p.profession);
        room.playerStates.set(id, state);
      }
      // Receive locDefs from host payload; fall back to defaults
      const locDefs = data.locDefs || [];
      initRoomPools(room, locDefs);
      startDayTimer(room);
      // Send each player their own state + shared pools
      for (const [id, p] of room.players) {
        send(p.ws, {
          type: 'game_started',
          state: room.playerStates.get(id),
          locationPools: room.locationPools,
          players: playerList(room),
        });
      }
      pushRoomList();
      console.log(`[${room.code}] Game started with ${room.players.size} players.`);
      break;
    }

    // ── do_action ──────────────────────────────────────────────────────────
    // Crime scene action. Server resolves, returns updated player state.
    case 'do_action': {
      if (!room || !room.started) return;
      const state   = room.playerStates.get(playerId);
      const vehicle = data.vehicle || {};
      const result  = logic.resolveAction(data.action, state, vehicle);
      // Apply skill gain if earned
      if (result.skillGain && state.stats[result.skillGain]) {
        state.stats[result.skillGain].val = Math.min(
          state.stats[result.skillGain].max,
          state.stats[result.skillGain].val + 1
        );
      }
      send(ws, { type:'action_result', result, state });
      break;
    }

    // ── steal_claim ────────────────────────────────────────────────────────
    // Player claims a specific vehicle (uid) at a location.
    // First claim wins; subsequent claims for the same uid are rejected.
    case 'steal_claim': {
      if (!room || !room.started) return;
      const { locId, uid } = data;
      const pool = room.locationPools[locId];
      if (!pool) {
        // Location not tracked on server — player is in a city the server hasn't
        // seen yet (e.g. they flew there after game start). No shared pool conflict
        // is possible for this location, so ack immediately.
        send(ws, { type:'steal_ack', locId, uid });
        break;
      }
      const idx = pool.findIndex(v => v.uid === uid);
      if (idx === -1) {
        // Vehicle is either already claimed (pending) or gone — nack silently
        send(ws, { type:'steal_nack', locId, uid });
        return;
      }
      // Lock vehicle: remove from pool into pendingClaims for duration of steal attempt
      const [vehicle] = pool.splice(idx, 1);
      if (!room.pendingClaims) room.pendingClaims = {};
      room.pendingClaims[uid] = { locId, vehicle, playerId };
      send(ws, { type:'steal_ack', locId, uid });
      broadcast(room, { type:'pool_update', locationPools: room.locationPools });
      break;
    }

    // ── arrest ─────────────────────────────────────────────────────────────
    // Client reports a bust; server applies penalties and returns updated state.
    case 'arrest': {
      if (!room || !room.started) return;
      const state = room.playerStates.get(playerId);
      state.arrests = (state.arrests || 0) + 1;
      const penalties = logic.applyArrestPenalties(state);
      send(ws, { type:'arrest_result', penalties, state });
      break;
    }

    // ── steal_success ──────────────────────────────────────────────────────
    // Client confirms a successful theft. Consume pendingClaim, record vehicle.
    case 'steal_success': {
      if (!room || !room.started) return;
      const state   = room.playerStates.get(playerId);
      const vehicle = data.vehicle;
      // Remove from pendingClaims — vehicle is now permanently gone from pool
      if (room.pendingClaims && data.uid) delete room.pendingClaims[data.uid];
      if (!state.activeVehicle) {
        state.activeVehicle = vehicle;
      } else {
        if (!state.garage) state.garage = [];
        if (state.garage.length < 6) state.garage.push(vehicle);
      }
      send(ws, { type:'state_update', state });
      break;
    }

    // ── steal_abort ─────────────────────────────────────────────────────────
    // Player was arrested or fled — return the vehicle to the shared pool.
    case 'steal_abort': {
      if (!room || !room.started) return;
      const { uid } = data;
      if (!room.pendingClaims) break;
      const claim = room.pendingClaims[uid];
      if (!claim) break;
      delete room.pendingClaims[uid];
      // Return vehicle to its location pool
      if (!room.locationPools[claim.locId]) room.locationPools[claim.locId] = [];
      room.locationPools[claim.locId].push(claim.vehicle);
      broadcast(room, { type:'pool_update', locationPools: room.locationPools });
      break;
    }

    // ── race_challenge ─────────────────────────────────────────────────────
    // Player challenges another by playerId. Target receives a challenge message.
    case 'race_challenge': {
      if (!room || !room.started) return;
      const challenger = room.players.get(playerId);
      const target     = room.players.get(data.targetId);
      if (!target || !target.connected) {
        send(ws, { type:'error', msg:'Target player not available.' }); return;
      }
      room.pendingRace = { challengerId: playerId, targetId: data.targetId, vehicle: data.vehicle };
      send(target.ws, {
        type: 'race_challenge',
        fromId: playerId, fromName: challenger.name, vehicle: data.vehicle,
      });
      break;
    }

    // ── race_respond ───────────────────────────────────────────────────────
    // Target accepts or declines. On accept, both players get race_started.
    case 'race_respond': {
      if (!room || !room.pendingRace) return;
      const pr = room.pendingRace;
      if (pr.targetId !== playerId) return;
      if (!data.accept) {
        const challenger = room.players.get(pr.challengerId);
        if (challenger) send(challenger.ws, { type:'race_declined', by: playerId });
        room.pendingRace = null;
        return;
      }
      // Build race state for both players
      const challengerState = room.playerStates.get(pr.challengerId);
      const targetState     = room.playerStates.get(pr.targetId);
      const opponentVehicle = targetState.activeVehicle || pr.vehicle;
      logic.initRace(challengerState, pr.vehicle, opponentVehicle);
      logic.initRace(targetState, opponentVehicle, pr.vehicle);
      const challWs = room.players.get(pr.challengerId).ws;
      send(challWs, { type:'race_started', race: challengerState.currentRace });
      send(ws,      { type:'race_started', race: targetState.currentRace });
      room.pendingRace = null;
      break;
    }

    // ── race_turn ──────────────────────────────────────────────────────────
    // Client requests one race turn resolution.
    case 'race_turn': {
      if (!room || !room.started) return;
      const state  = room.playerStates.get(playerId);
      const result = logic.resolveRaceTurn(state);
      if (!result) return;
      if (result.finished) {
        if (result.winner === 'player') logic.resolveRaceWin(state);
        else                            logic.resolveRaceLoss(state);
      }
      send(ws, { type:'race_turn_result', result, state });
      break;
    }

    // ── sell_vehicle ───────────────────────────────────────────────────────
    case 'sell_vehicle': {
      if (!room || !room.started) return;
      const state = room.playerStates.get(playerId);
      const { uid, toDealer } = data;
      // Find in garage or active slot
      let vehicle = null;
      if (state.activeVehicle && state.activeVehicle.uid === uid) {
        vehicle = state.activeVehicle; state.activeVehicle = null;
      } else {
        const idx = (state.garage || []).findIndex(v => v.uid === uid);
        if (idx !== -1) { vehicle = state.garage[idx]; state.garage.splice(idx, 1); }
      }
      if (!vehicle) { send(ws, { type:'error', msg:'Vehicle not found.' }); return; }
      const salePrice = Math.floor(vehicle.price * ((vehicle.condition || 75) / 100));
      state.cash += salePrice;
      if (toDealer) { if (!state.dealerLot) state.dealerLot = []; state.dealerLot.push(vehicle); }
      send(ws, { type:'state_update', state });
      break;
    }

    // ── buy_item ───────────────────────────────────────────────────────────
    case 'buy_item': {
      if (!room || !room.started) return;
      const state = room.playerStates.get(playerId);
      const item  = logic.makeInventoryItem(data.index);
      if (!item) { send(ws, { type:'error', msg:'Unknown item.' }); return; }
      if (state.inventory.length >= 12) { send(ws, { type:'error', msg:'Backpack full.' }); return; }
      if (state.cash < item.buy) { send(ws, { type:'error', msg:'Not enough cash.' }); return; }
      state.cash -= item.buy;
      state.inventory.push(item);
      send(ws, { type:'state_update', state });
      break;
    }

    // ── sell_item ──────────────────────────────────────────────────────────
    case 'sell_item': {
      if (!room || !room.started) return;
      const state = room.playerStates.get(playerId);
      const idx   = state.inventory.findIndex(i => i.index === data.index);
      if (idx === -1) { send(ws, { type:'error', msg:'Item not in inventory.' }); return; }
      state.cash += state.inventory[idx].sell;
      state.inventory.splice(idx, 1);
      send(ws, { type:'state_update', state });
      break;
    }

    // ── get_players ────────────────────────────────────────────────────────
    // Client requests the current room's player roster.
    case 'get_players': {
      if (!room) return;
      send(ws, { type: 'players_list', players: playerList(room) });
      break;
    }

    // ── chat_message ───────────────────────────────────────────────────────
    // Client sends a chat message; server broadcasts it to all room players.
    case 'chat_message': {
      if (!room) return;
      const sender = room.players.get(playerId);
      if (!sender) return;
      const text = String(data.text || '').trim().slice(0, 120);
      if (!text) return;
      broadcast(room, { type: 'chat_message', fromId: playerId, fromName: sender.name, text });
      break;
    }

    // ── end_game ───────────────────────────────────────────────────────────
    // Player flies to airport and triggers end. Server broadcasts final scores.
    case 'end_game': {
      if (!room || !room.started) return;
      stopDayTimer(room);
      const scores = [];
      for (const [id, state] of room.playerStates) {
        const p     = room.players.get(id);
        const score = state.cash - state.debt;
        scores.push({ id, name: p.name, cash: state.cash, debt: state.debt, score });
      }
      scores.sort((a, b) => b.score - a.score);
      broadcast(room, { type:'game_over', scores, triggeredBy: playerId });
      console.log(`[${room.code}] Game over. Winner: ${scores[0]?.name}`);

      // Write career stats to Firestore for each player
      const fsdb = admin.firestore();
      for (const [id, state] of room.playerStates) {
        const p     = room.players.get(id);
        const score = state.cash - state.debt;
        if (!p?.uid) continue;
        const ref = fsdb.collection('players').doc(p.uid);
        ref.get().then(doc => {
          if (!doc.exists) return;
          const d = doc.data();
          return ref.update({
            gamesPlayed:   (d.gamesPlayed   || 0) + 1,
            totalEarnings: (d.totalEarnings || 0) + Math.max(0, state.cash),
            totalArrests:  (d.totalArrests  || 0) + (state.arrests || 0),
            bestScore:     Math.max(d.bestScore || 0, score),
          });
        }).catch(err => console.error(`Firestore write failed for ${p.uid}:`, err));
      }
      break;
    }

    default:
      send(ws, { type:'error', msg:`Unknown message type: ${data.type}` });
  }
}

// ---------------------------------------------------------------------------
// WEBSOCKET SERVER
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  // Each connection starts unregistered. The first message must be
  // create_room or join_room, which registers the player.
  let playerId = null;
  let roomCode = null;
  let verifiedUid = null;  // set after successful auth message

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { send(ws, { type:'error', msg:'Bad JSON.' }); return; }

    // ── get_room_list ──────────────────────────────────────────────────────
    if (data.type === 'get_room_list') {
      browsers.add(ws);
      const list = [...rooms.values()]
        .filter(r => !r.started && r.isPublic)
        .map(r => ({
          code:        r.code,
          roomName:    r.roomName,
          hostName:    [...r.players.values()][0]?.name || '?',
          playerCount: r.players.size,
        }));
      send(ws, { type: 'room_list', rooms: list });
      return;
    }

    // ── auth ───────────────────────────────────────────────────────────────
    // Client sends Firebase ID token; server verifies and stores uid.
    if (data.type === 'auth') {
      admin.auth().verifyIdToken(data.token)
        .then(decoded => {
          verifiedUid = decoded.uid;
          send(ws, { type:'auth_ok', uid: verifiedUid });
          console.log(`WS auth OK: ${verifiedUid}`);
        })
        .catch(() => {
          send(ws, { type:'error', msg:'Invalid auth token.' });
          ws.close();
        });
      return;
    }

    // ── create_room ────────────────────────────────────────────────────────
    if (data.type === 'create_room') {
      if (!verifiedUid) { send(ws, { type:'error', msg:'Not authenticated.' }); return; }
      playerId = makePlayerId();
      roomCode = makeRoomCode();
      // Ensure uniqueness (extremely unlikely collision, but handle it)
      while (rooms.has(roomCode)) roomCode = makeRoomCode();

      const room = {
        code: roomCode, hostId: playerId, started: false,
        day: 1, dayTimer: null,
        players:      new Map(),
        playerStates: new Map(),
        locationPools: {},
        pendingRace: null,
      };
      room.roomName = (data.roomName || 'Unnamed Room').trim().slice(0, 20);
      room.isPublic = data.isPublic !== false;
      room.players.set(playerId, {
        ws, name: data.name, portraitSrc: data.portraitSrc || '',
        profession: data.profession || 'thief', connected: true, uid: verifiedUid,
      });
      rooms.set(roomCode, room);
      browsers.delete(ws);
      send(ws, { type:'room_created', code: roomCode, playerId, roomName: room.roomName, players: playerList(room) });
      pushRoomList();
      console.log(`[${roomCode}] Created by ${data.name} (${playerId})`);
      return;
    }

    // ── join_room ──────────────────────────────────────────────────────────
    if (data.type === 'join_room') {
      if (!verifiedUid) { send(ws, { type:'error', msg:'Not authenticated.' }); return; }
      const room = rooms.get(data.code);
      if (!room) { send(ws, { type:'error', msg:'Room not found.' }); return; }
      if (room.started) { send(ws, { type:'error', msg:'Game already in progress.' }); return; }
      playerId = makePlayerId();
      roomCode = data.code;
      room.players.set(playerId, {
        ws, name: data.name, portraitSrc: data.portraitSrc || '',
        profession: data.profession || 'thief', connected: true, uid: verifiedUid,
      });
      browsers.delete(ws);
      send(ws, { type:'room_joined', code: roomCode, playerId, roomName: room.roomName, players: playerList(room) });
      broadcast(room, { type:'player_joined', player: { id:playerId, name:data.name } });
      pushRoomList();
      console.log(`[${roomCode}] ${data.name} (${playerId}) joined.`);
      return;
    }

    // ── reconnect ──────────────────────────────────────────────────────────
    if (data.type === 'reconnect') {
      const room = rooms.get(data.code);
      if (!room || !room.players.has(data.playerId)) {
        send(ws, { type:'error', msg:'Session not found.' }); return;
      }
      const p = room.players.get(data.playerId);
      // Verify the reconnecting user owns this slot
      if (p.uid && p.uid !== verifiedUid) {
        send(ws, { type:'error', msg:'Session does not belong to this account.' });
        ws.close(); return;
      }
      playerId = data.playerId;
      roomCode = data.code;
      p.ws = ws; p.connected = true;
      if (p._disconnectTimer) { clearTimeout(p._disconnectTimer); p._disconnectTimer = null; }
      const state = room.playerStates.get(playerId);
      send(ws, { type:'reconnected', state, locationPools: room.locationPools, players: playerList(room) });
      broadcast(room, { type:'player_reconnected', playerId });
      console.log(`[${roomCode}] ${p.name} reconnected.`);
      return;
    }

    // All other messages require a registered player in a room
    if (!playerId || !roomCode) {
      send(ws, { type:'error', msg:'Not in a room. Send create_room or join_room first.' });
      return;
    }

    handleMessage(ws, playerId, roomCode, data);
  });

  ws.on('close', () => {
    browsers.delete(ws);
    if (!playerId || !roomCode) { pushRoomList(); return; }
    const room = rooms.get(roomCode);
    if (!room) return;
    const p = room.players.get(playerId);
    if (p) { p.connected = false; p.ws = null; }
    broadcast(room, { type:'player_disconnected', playerId, gracePeriod: 60 });
    pushRoomList();
    console.log(`[${roomCode}] ${p?.name || playerId} disconnected — 60s grace period.`);

    // Grace period: give player 60s to reconnect before removing them from the room
    p._disconnectTimer = setTimeout(() => {
      const r = rooms.get(roomCode);
      if (!r) return;
      const pl = r.players.get(playerId);
      if (!pl || pl.connected) return; // reconnected in time
      r.players.delete(playerId);
      r.playerStates.delete(playerId);
      broadcast(r, { type:'player_removed', playerId, reason:'timeout' });
      console.log(`[${roomCode}] ${p.name} removed after grace period.`);
    }, 60_000);
    // If ALL players disconnected, clean up after 30 minutes
    const allGone = [...room.players.values()].every(pl => !pl.connected);
    if (allGone) {
      setTimeout(() => {
        if (rooms.has(roomCode)) {
          stopDayTimer(rooms.get(roomCode));
          rooms.delete(roomCode);
          console.log(`[${roomCode}] Room cleaned up (all players gone).`);
        }
      }, 30 * 60 * 1000);
    }
  });

  ws.on('error', (err) => console.error('WS error:', err.message));
});

// ---------------------------------------------------------------------------
// START
// ---------------------------------------------------------------------------
httpServer.listen(PORT, () => {
  console.log(`Car Thief Online server running on http://localhost:${PORT}`);
  console.log(`Day duration: ${DAY_DURATION / 60000} minutes`);
});
