// =============================================================================
// logic.js — Car Thief Online
// Pure game-logic functions for use by server.js.
// No DOM, no sessionStorage — safe to require() in Node.js.
//
// Keep in sync with the corresponding functions in game.js.
// When multiplayer is fully wired, game.js client functions that duplicate
// these will be removed; clients will receive resolved results from the server.
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------
const STARTING_CASH        = 500;
const STARTING_DEBT        = 10000;
const DAILY_COSTS          = 200;
const PROFESSION_BONUS_AMT = 15;

const PROFESSION_STAT = {
  actor:       'acting',
  shooter:     'shooting',
  thief:       'hiding',
  driver:      'driving',
  locksmith:   'locksmithing',
  electrician: 'electronics',
};

const BASE_STATS = {
  health:       { label:'Health',       val:100, max:100 },
  disguise:     { label:'Disguise',     val:100, max:100 },
  acting:       { label:'Acting',       val:12,  max:100 },
  shooting:     { label:'Shooting',     val:10,  max:100 },
  hiding:       { label:'Hiding',       val:18,  max:100 },
  driving:      { label:'Driving',      val:11,  max:100 },
  locksmithing: { label:'Locksmithing', val:20,  max:100 },
  electronics:  { label:'Electronics',  val:22,  max:100 },
};

const RACE_TOTAL_DIST  = 100;
const RACE_CHECKPOINTS = [33, 66];
const RACE_POLICE_RISE = [5, 8];

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------

function initState(playerName, portraitSrc, profession) {
  const stats = {};
  for (const [key, s] of Object.entries(BASE_STATS)) {
    stats[key] = { label: s.label, val: s.val, max: s.max };
  }
  const bonusStat = PROFESSION_STAT[profession];
  if (bonusStat && stats[bonusStat]) {
    stats[bonusStat].val = Math.min(stats[bonusStat].max,
                                    stats[bonusStat].val + PROFESSION_BONUS_AMT);
  }
  const state = {
    playerName,
    portraitSrc,
    profession,
    stats,
    cash:         STARTING_CASH,
    debt:         STARTING_DEBT,
    dailyCosts:   DAILY_COSTS,
    day:          1,
    wantedLevel:  0,
    inventory:    [],
    activeVehicle: null,
    garage:       [],
    dealerLot:    [],
    arrests:      0,
    shopStock:    [],
    currentRace:  null,
  };
  initShopStock(state);
  return state;
}

function advanceDay(state) {
  state.day  += 1;
  state.cash -= state.dailyCosts;
  initShopStock(state);
  return `Day ${state.day} begins. Daily costs: -$${state.dailyCosts}. Cash: $${state.cash}.`;
}

// ---------------------------------------------------------------------------
// SKILL CHECKS
// ---------------------------------------------------------------------------

function rollCheck(statVal, defenseStat = 0) {
  const chance = Math.max(5, Math.min(95, statVal - defenseStat));
  const roll   = Math.floor(Math.random() * 100) + 1;
  return { pass: roll <= chance, chance, roll };
}

function hasItem(state, itemKey) {
  const catAlias = { hammer: 'cutting', lockpick: 'lock_pick', wirecutter: 'wiring' };
  const resolvedCat = catAlias[itemKey];
  if (resolvedCat) return state.inventory.some(i => i.cat === resolvedCat);
  if (state.inventory.some(i => i.cat === itemKey)) return true;
  const idx = parseInt(itemKey);
  if (!isNaN(idx)) return state.inventory.some(i => i.index === idx);
  return state.inventory.some(i => i.key === itemKey);
}

function getToolBonus(inventory, type) {
  const pickBonuses   = { tryout_keys:5, lock_pick_set:10, snap_gun:20, pro_pick_set:25, ignition_decoder:30 };
  const wiringBonuses = { wire_cutter:5, wire_stripper:10, multimeter:15, probelight:20 };
  let best = 0;
  for (const item of (inventory || [])) {
    const id = item.id || '';
    if (type === 'pick'       && pickBonuses[id]    !== undefined) best = Math.max(best, pickBonuses[id]);
    if (type === 'wiring'     && wiringBonuses[id]  !== undefined) best = Math.max(best, wiringBonuses[id]);
    if (type === 'slim_jim'   && id === 'slim_jim')   best = 15;
    if (type === 'pump_wedge' && id === 'pump_wedge') best = 15;
  }
  return best;
}

function getBestActor(state, statKey, toolType, requireGun) {
  const GUN_IDS = ['pistol', 'shotgun', 'rifle'];
  function hasGunInInv(inv) {
    return (inv || []).some(i => i && GUN_IDS.includes((i.id || '').toLowerCase()));
  }
  const candidates = [];
  candidates.push({
    name:      state.playerName || 'You',
    isPlayer:  true,
    statVal:   (state.stats[statKey] && state.stats[statKey].val) || 0,
    inventory: state.inventory || [],
  });
  for (const c of (state.contacts || [])) {
    if (c.status !== 'hired') continue;
    if (c.assignedLocation !== null && c.assignedLocation !== undefined) continue;
    candidates.push({
      name:      c.name,
      isPlayer:  false,
      statVal:   (c.stats && c.stats[statKey] && c.stats[statKey].val) || 0,
      inventory: c.inventory || [],
    });
  }
  let pool = requireGun ? candidates.filter(c => hasGunInInv(c.inventory)) : candidates;
  if (pool.length === 0) return null;
  pool = pool.map(c => ({ ...c, toolBonus: toolType ? getToolBonus(c.inventory, toolType) : 0 }));
  if (toolType) {
    const maxBonus = Math.max(...pool.map(c => c.toolBonus));
    if (maxBonus > 0) pool = pool.filter(c => c.toolBonus === maxBonus);
  }
  pool.sort((a, b) => b.statVal - a.statVal);
  return pool[0];
}

function resolveAction(action, state, vehicle) {
  vehicle = vehicle || {};
  switch (action) {
    case 'case_the_area': {
      const actor = getBestActor(state, 'hiding');
      const r = rollCheck(actor.statVal, 0);
      const who = actor.isPlayer ? 'You case' : actor.name + ' cases';
      return r.pass
        ? { msg: who + ` the area carefully (${r.chance}% / rolled ${r.roll}). Police response slowed.`, cls:'good', policeRise:2, progress:'none', skillGain:'hiding' }
        : { msg: who + ` the area but feel exposed (${r.chance}% / rolled ${r.roll}).`, cls:'', policeRise:6, progress:'none' };
    }
    case 'smash_window':
      return { msg:'You smash the window. Alarm triggered!', cls:'bad', policeRise:20, progress:'none', doorOpen:true, alarmActive:true };
    case 'lockpick_door': {
      const actor = getBestActor(state, 'locksmithing', 'pick');
      const r = rollCheck(actor.statVal + actor.toolBonus, vehicle.lockDef || 0);
      const who = actor.isPlayer ? 'Lockpick' : actor.name + ' picks the lock';
      return r.pass
        ? { msg: who + ` successful (${r.chance}% / rolled ${r.roll}). Door open.`, cls:'good', policeRise:4, progress:'none', doorOpen:true, skillGain:'locksmithing' }
        : { msg: who + ` failed (${r.chance}% / rolled ${r.roll}).`, cls:'', policeRise:5, progress:'none' };
    }
    case 'slim_jim': {
      const actor = getBestActor(state, 'locksmithing', 'slim_jim');
      const r = rollCheck(actor.statVal + actor.toolBonus, vehicle.lockDef || 0);
      const who     = actor.isPlayer ? 'You slide' : actor.name + ' slides';
      const whoSlip = actor.isPlayer ? 'It slipped' : actor.name + ' slipped';
      return r.pass
        ? { msg: who + ` the slim jim in clean (${r.chance}% / rolled ${r.roll}). Door open.`, cls:'good', policeRise:3, progress:'none', doorOpen:true, skillGain:'locksmithing' }
        : { msg: whoSlip + ` (${r.chance}% / rolled ${r.roll}). Alarm triggered!`, cls:'bad', policeRise:15, progress:'none', doorOpen:true, alarmActive:true };
    }
    case 'door_opener': {
      const actor = getBestActor(state, 'locksmithing', 'pump_wedge');
      const r = rollCheck(actor.statVal + actor.toolBonus, vehicle.lockDef || 0);
      const who     = actor.isPlayer ? 'Pump wedge works' : actor.name + ' works the wedge';
      const whoFail = actor.isPlayer ? 'Pump wedge slipped' : actor.name + "'s wedge slipped";
      return r.pass
        ? { msg: who + ` (${r.chance}% / rolled ${r.roll}). Door open, no alarm.`, cls:'good', policeRise:3, progress:'none', doorOpen:true, skillGain:'locksmithing' }
        : { msg: whoFail + ` (${r.chance}% / rolled ${r.roll}). Try again.`, cls:'', policeRise:4, progress:'none' };
    }
    case 'disable_alarm': {
      const actor = getBestActor(state, 'electronics', 'wiring');
      const r = rollCheck(actor.statVal + actor.toolBonus, vehicle.elecDef || 0);
      const who     = actor.isPlayer ? 'Alarm disabled' : actor.name + ' disables the alarm';
      const whoFail = actor.isPlayer ? 'Failed to disable alarm' : actor.name + ' fails to disable the alarm';
      return r.pass
        ? { msg: who + ` (${r.chance}% / rolled ${r.roll}).`, cls:'good', policeRise:2, progress:'none', alarmDisabled:true, skillGain:'electronics' }
        : { msg: whoFail + ` (${r.chance}% / rolled ${r.roll}). It keeps wailing!`, cls:'bad', policeRise:12, progress:'none' };
    }
    case 'hotwire_engine': {
      const actor = getBestActor(state, 'electronics', 'wiring');
      const r = rollCheck(actor.statVal + actor.toolBonus, vehicle.elecDef || 0);
      const who     = actor.isPlayer ? 'Hotwire successful' : actor.name + ' hotwires it';
      const whoFail = actor.isPlayer ? 'Hotwire failed' : actor.name + "'s hotwire attempt failed";
      return r.pass
        ? { msg: who + ` (${r.chance}% / rolled ${r.roll}). Engine running!`, cls:'good', policeRise:5, progress:'none', engineStarted:true, skillGain:'electronics' }
        : { msg: whoFail + ` (${r.chance}% / rolled ${r.roll}). Try again.`, cls:'', policeRise:6, progress:'none' };
    }
    case 'pick_ignition': {
      const actor = getBestActor(state, 'locksmithing', 'pick');
      const r = rollCheck(actor.statVal + actor.toolBonus, vehicle.lockDef || 0);
      const who     = actor.isPlayer ? 'Ignition lock picked' : actor.name + ' picks the ignition lock';
      const whoFail = actor.isPlayer ? 'Ignition pick failed' : actor.name + "'s ignition pick failed";
      return r.pass
        ? { msg: who + ` (${r.chance}% / rolled ${r.roll}). Engine starts!`, cls:'good', policeRise:4, progress:'none', engineStarted:true, skillGain:'locksmithing' }
        : { msg: whoFail + ` (${r.chance}% / rolled ${r.roll}). Try again.`, cls:'', policeRise:5, progress:'none' };
    }
    case 'check_gps': {
      const actor = getBestActor(state, 'electronics');
      const r = rollCheck(actor.statVal, 0);
      const who = actor.isPlayer ? 'Electronics check done' : actor.name + ' checks for a tracker';
      return r.pass
        ? { msg: who + ` (${r.chance}% / rolled ${r.roll}). No tracker found.`, cls:'good', policeRise:2, progress:'none', gpsChecked:true, skillGain:'electronics' }
        : { msg: who + ` (${r.chance}% / rolled ${r.roll}). Tracker disabled.`, cls:'good', policeRise:3, progress:'none', gpsChecked:true, skillGain:'electronics' };
    }
    case 'skip_gps':
      return { msg:"You skip the GPS check.", cls:'sys', policeRise:0, progress:'none', gpsSkipped:true };
    case 'get_in_vehicle':
      return { msg:'You get in and prepare to drive. Here we go!', cls:'good', policeRise:2, progress:'success' };
    case 'approach_driver': {
      const actor = getBestActor(state, 'acting');
      const r = rollCheck(actor.statVal, 0);
      const who     = actor.isPlayer ? 'You approach' : actor.name + ' approaches';
      const whoSpook = actor.isPlayer ? 'Your approach' : actor.name + "'s approach";
      return r.pass
        ? { msg: who + ` the vehicle calmly (${r.chance}% / rolled ${r.roll}). The driver hasn't panicked.`, cls:'good', policeRise:3, progress:'none', approached:true, skillGain:'acting' }
        : { msg: whoSpook + ` spooked the driver (${r.chance}% / rolled ${r.roll}). They're on edge.`, cls:'', policeRise:4, progress:'none', approached:true };
    }
    case 'ask_to_go_out': {
      const actor = getBestActor(state, 'acting');
      const r = rollCheck(actor.statVal, 0);
      const who = actor.isPlayer ? 'You talk' : actor.name + ' talks';
      return r.pass
        ? { msg: who + ` the driver out of the car (${r.chance}% / rolled ${r.roll}). Keys in hand!`, cls:'good', policeRise:4, progress:'none', driverRemoved:true, skillGain:'acting' }
        : { msg: `Driver refuses (${r.chance}% / rolled ${r.roll}). Escalate or yank them out.`, cls:'bad', policeRise:6, progress:'none' };
    }
    case 'show_your_gun': {
      const actor = getBestActor(state, 'shooting', null, true);
      if (!actor) return { msg:"Nobody on the team is armed.", cls:'bad', policeRise:2, progress:'none' };
      const r = rollCheck(actor.statVal, 0);
      const who     = actor.isPlayer ? 'You show your weapon' : actor.name + ' draws their weapon';
      const whoFail = actor.isPlayer ? 'You fumble the draw' : actor.name + ' fumbles the draw';
      return r.pass
        ? { msg: who + ` (${r.chance}% / rolled ${r.roll}). The driver freezes.`, cls:'good', policeRise:10, progress:'none', gunShown:true, approached:true, skillGain:'shooting' }
        : { msg: whoFail + ` (${r.chance}% / rolled ${r.roll}). Driver starts screaming!`, cls:'bad', policeRise:10, progress:'none' };
    }
    case 'demand_keys': {
      const r = rollCheck(70, 0);
      return r.pass
        ? { msg:`The driver hands over the keys (rolled ${r.roll}). Get in!`, cls:'good', policeRise:6, progress:'none', driverRemoved:true }
        : { msg:`The driver refuses! (rolled ${r.roll}) They're calling for help.`, cls:'bad', policeRise:8, progress:'none' };
    }
    case 'force_out_of_vehicle': {
      const actor = getBestActor(state, 'shooting');
      const motoTypes = ['motorcycle','atv','dirt bike','moped','scooter'];
      const isMoto    = motoTypes.some(t => (vehicle.body || '').includes(t));
      const motoBonus = isMoto ? 30 : 0;
      const r = rollCheck(actor.statVal, -motoBonus);
      const who     = actor.isPlayer ? 'You force' : actor.name + ' forces';
      const whoFail = actor.isPlayer ? 'Struggle! Driver resists' : 'Struggle! ' + actor.name + " can't pull them out";
      return r.pass
        ? { msg: who + ` the driver out (${r.chance}% / rolled ${r.roll}). Vehicle is yours!`, cls:'good', policeRise:14, progress:'none', driverRemoved:true, skillGain:'shooting' }
        : { msg: whoFail + ` (${r.chance}% / rolled ${r.roll}). Witnesses watching.`, cls:'bad', policeRise:20, progress:'none' };
    }
    case 'shoot_driver': {
      const actor = getBestActor(state, 'shooting', null, true);
      if (!actor) return { msg:"Nobody on the team is armed.", cls:'bad', policeRise:2, progress:'none' };
      const who = actor.isPlayer ? 'You shoot' : actor.name + ' shoots';
      return { msg: who + ' the driver. They slump over — vehicle is yours. Police response surges!', cls:'bad', policeRise:35, progress:'none', driverRemoved:true };
    }
    case 'distract_owner': {
      const actor = getBestActor(state, 'acting');
      const r = rollCheck(actor.statVal, 0);
      const who     = actor.isPlayer ? 'You distract' : actor.name + ' distracts';
      const whoFail = actor.isPlayer ? 'The owner sees through you' : 'The owner sees through ' + actor.name;
      return r.pass
        ? { msg: who + ` the owner with a convincing story (${r.chance}% / rolled ${r.roll}).`, cls:'good', policeRise:3, progress:'none', ownerDistracted:true, driverRemoved:true, skillGain:'acting' }
        : { msg: whoFail + ` (${r.chance}% / rolled ${r.roll}). They're suspicious.`, cls:'', policeRise:8, progress:'none' };
    }
    case 'flee':
      return { msg:'You leave the scene empty-handed.', cls:'bad', policeRise:5, progress:'fled' };
    case 'skip_turn':
      return { msg:'You hold your position.', cls:'sys', policeRise:1, progress:'none' };
    default:
      return { msg:'Nothing happens.', cls:'', policeRise:3, progress:'none' };
  }
}

// ---------------------------------------------------------------------------
// ARREST PENALTIES
// ---------------------------------------------------------------------------

function applyArrestPenalties(state) {
  const priorArrests = (state.arrests || 0) - 1;
  const fine = Math.min(500 + priorArrests * 250, 5000);
  const seizeCount = priorArrests >= 2 ? 2 : 1;
  const seized = [];
  for (let i = 0; i < seizeCount; i++) {
    if (!state.inventory.length) break;
    const slot = Math.floor(Math.random() * state.inventory.length);
    seized.push(state.inventory[slot]);
    state.inventory.splice(slot, 1);
  }
  let debtIncrease = 0;
  state.cash -= fine;
  if (state.cash < 0) {
    debtIncrease = Math.abs(state.cash);
    state.debt  += debtIncrease;
    state.cash   = 0;
  }
  state.wantedLevel = Math.min((state.wantedLevel || 0) + 1, 5);
  return { fine, seized, debtIncrease };
}

// ---------------------------------------------------------------------------
// RACING
// ---------------------------------------------------------------------------

function initRace(state, playerVehicle, opponentVehicle) {
  state.currentRace = {
    playerVehicle, opponentVehicle,
    playerDist: 0, oppDist: 0,
    checkpointsPassed: 0,
    policeAwareness: 0, policeReadiness: 22,
    turn: 0, finished: false, winner: null,
  };
}

function resolveRaceTurn(state) {
  const race = state.currentRace;
  if (!race || race.finished) return null;
  const log = [];
  let checkpointHit = false, drivingGain = false;
  race.turn++;
  const drivingStat = state.stats.driving.val || 10;
  const playerGain  = 8 + Math.floor(Math.random() * 5) + Math.floor(drivingStat / 20);
  race.playerDist   = Math.min(RACE_TOTAL_DIST, race.playerDist + playerGain);
  const ov          = race.opponentVehicle;
  const oppSpeed    = Math.max(10, ov.speed || 50);
  const oppGain     = 6 + Math.floor(Math.random() * 5) + Math.floor(oppSpeed / 14);
  race.oppDist      = Math.min(RACE_TOTAL_DIST, race.oppDist + oppGain);
  const delta = race.playerDist - race.oppDist;
  log.push({ text: delta > 0 ? `You're ${delta} meters ahead.` : delta < 0 ? `Opponent is ${-delta} meters ahead.` : `Neck and neck.`, style: delta >= 0 ? 'good' : 'bad' });
  const nextCp = RACE_CHECKPOINTS[race.checkpointsPassed];
  if (nextCp !== undefined && race.playerDist >= nextCp) {
    race.checkpointsPassed++;
    checkpointHit = drivingGain = true;
    state.stats.driving.val = Math.min(state.stats.driving.max, state.stats.driving.val + 1);
    log.push({ text: `Checkpoint ${race.checkpointsPassed} — +1 Driving.`, style: 'good' });
  }
  const policeRise = RACE_POLICE_RISE[0] + Math.floor(Math.random() * (RACE_POLICE_RISE[1] - RACE_POLICE_RISE[0] + 1));
  race.policeAwareness = Math.min(100, race.policeAwareness + policeRise);
  if (race.playerDist >= RACE_TOTAL_DIST || race.oppDist >= RACE_TOTAL_DIST) {
    race.finished = true;
    race.winner = race.playerDist >= race.oppDist ? 'player' : 'opponent';
    log.push({ text: race.winner === 'player' ? `You win! ${ov.name} is yours.` : `You lose.`, style: race.winner === 'player' ? 'good' : 'bad' });
  }
  return { log, checkpointHit, drivingGain, finished: race.finished, winner: race.winner };
}

function resolveRaceWin(state) {
  if (!state.currentRace) return;
  const won = state.currentRace.opponentVehicle;
  if (!state.garage) state.garage = [];
  if (state.garage.length < 12) state.garage.push(won);
  state.currentRace = null;
}

function resolveRaceLoss(state) {
  if (!state.currentRace) return;
  const lost = state.activeVehicle;
  state.activeVehicle = null;
  if (lost && Math.random() < 0.25) {
    if (!state.dealerLot) state.dealerLot = [];
    state.dealerLot.push(lost);
  }
  state.currentRace = null;
}

// ---------------------------------------------------------------------------
// SHOP STOCK
// ---------------------------------------------------------------------------

const ITEMS_DATA = [
  { index:  1, name:'Beretta 92FS',            cat:'weapon',       slot:'weapon', buy:1200, sell:500  },
  { index:  2, name:'Magnum Baby Eagle',        cat:'weapon',       slot:'weapon', buy:1100, sell:450  },
  { index:  3, name:'Walther P99',              cat:'weapon',       slot:'weapon', buy:1000, sell:400  },
  { index:  4, name:'Remington 300',            cat:'weapon',       slot:'weapon', buy:2200, sell:900  },
  { index:  5, name:'Garmin Streetpilot c330',  cat:'navigation',   slot:'gps_map',buy: 400, sell:150  },
  { index:  6, name:'TomTom GO 910',            cat:'navigation',   slot:'gps_map',buy: 600, sell:250  },
  { index:  7, name:'Radio Scanner BC60XLT-1',  cat:'radio_scanner',slot:'tool',   buy: 500, sell:200  },
  { index:  8, name:'Radio Scanner IC-R3',      cat:'radio_scanner',slot:'tool',   buy: 800, sell:300  },
  { index:  9, name:'Electric Lock-Pick',       cat:'lock_pick',    slot:'tool',   buy: 600, sell:200  },
  { index: 10, name:'Advanced Code Grabber',    cat:'code_grabber', slot:'tool',   buy:2500, sell:1000 },
  { index: 11, name:'Screwdriver',              cat:'mechanic',     slot:'tool',   buy: 100, sell: 30  },
  { index: 12, name:'Tarpon Bay Combat Knife',  cat:'weapon',       slot:'weapon', buy: 400, sell:150  },
  { index: 13, name:'Defender II Knife',        cat:'weapon',       slot:'weapon', buy: 300, sell:100  },
  { index: 14, name:'21-inch Steel Baton',      cat:'weapon',       slot:'weapon', buy: 250, sell: 80  },
  { index: 15, name:'Brass Knuckles',           cat:'weapon',       slot:'weapon', buy: 200, sell: 60  },
  { index: 16, name:'Body Armor IIA',           cat:'armor',        slot:'armor',  buy:2500, sell:800  },
  { index: 17, name:'Genesis Body Armor IIIA',  cat:'armor',        slot:'armor',  buy:4000, sell:1500 },
  { index: 18, name:'Basic Code Grabber',       cat:'code_grabber', slot:'tool',   buy: 800, sell:300  },
  { index: 19, name:'Basic Code Grabber Mk2',   cat:'code_grabber', slot:'tool',   buy:1200, sell:450  },
  { index: 20, name:'Snap Gun',                 cat:'lock_pick',    slot:'tool',   buy: 500, sell:180  },
  { index: 21, name:'Lock Pick Set',            cat:'lock_pick',    slot:'tool',   buy: 250, sell: 80  },
  { index: 22, name:'Ignition Decoding System', cat:'lock_pick',    slot:'tool',   buy:3000, sell:1200 },
  { index: 23, name:'Tryout Key Set',           cat:'lock_pick',    slot:'tool',   buy: 150, sell: 50  },
  { index: 24, name:'Professional Pick Set',    cat:'lock_pick',    slot:'tool',   buy:1200, sell:400  },
  { index: 25, name:'Pump Wedge',               cat:'lock_pick',    slot:'tool',   buy: 350, sell:100  },
  { index: 26, name:'Slim Jim Kit',             cat:'lock_pick',    slot:'tool',   buy: 200, sell: 60  },
  { index: 27, name:'IMI Micro UZI',            cat:'weapon',       slot:'weapon', buy:3500, sell:1400 },
  { index: 28, name:'Glock 17',                 cat:'weapon',       slot:'weapon', buy: 900, sell:350  },
  { index: 29, name:'Stun Gun SM-625',          cat:'weapon',       slot:'weapon', buy: 600, sell:200  },
  { index: 30, name:'Stun Baton SM-500',        cat:'weapon',       slot:'weapon', buy: 500, sell:160  },
  { index: 31, name:'Air Taser Gun M18L',       cat:'weapon',       slot:'weapon', buy: 800, sell:300  },
  { index: 32, name:'The Buster',               cat:'cutting',      slot:'tool',   buy: 300, sell:100  },
  { index: 33, name:'Razor Blade',              cat:'other',        slot:'tool',   buy:  50, sell: 10  },
  { index: 34, name:'Wire Cutter',              cat:'wiring',       slot:'tool',   buy: 200, sell: 60  },
  { index: 35, name:'Wire Stripper and Cutter', cat:'wiring',       slot:'tool',   buy: 300, sell:100  },
  { index: 36, name:'Ball Bearing Nunchaku',    cat:'weapon',       slot:'weapon', buy: 300, sell:100  },
  { index: 37, name:'Halogen Probelight',       cat:'wiring',       slot:'tool',   buy: 450, sell:150  },
  { index: 38, name:'Digital Multimeter',       cat:'wiring',       slot:'tool',   buy: 350, sell:100  },
  { index: 39, name:'Utility Blade',            cat:'other',        slot:'tool',   buy:  50, sell: 10  },
  { index: 40, name:'RF Jammer',                cat:'gps_jammer',   slot:'jammer', buy:1500, sell:500  },
  { index: 41, name:'Radio Scanner',            cat:'radio_scanner',slot:'tool',   buy: 600, sell:200  },
  { index: 42, name:'M96 Recon Carbine',        cat:'weapon',       slot:'weapon', buy:4500, sell:1800 },
  { index: 43, name:'Mossberg 590 Cruiser',     cat:'weapon',       slot:'weapon', buy:1800, sell:700  },
  { index: 44, name:'Hammer',                   cat:'cutting',      slot:'tool',   buy: 150, sell: 40  },
];

function getItem(index) {
  return ITEMS_DATA.find(i => i.index === index) || null;
}

function makeInventoryItem(index) {
  const def = getItem(index);
  if (!def) return null;
  const n = String(index).padStart(2, '0');
  return { index, label:def.name, cat:def.cat, slot:def.slot, buy:def.buy, sell:def.sell,
           img:`Graphics/items_medium/STOOL${n}.bmp` };
}

function _generateShopStock() {
  const tickets = [];
  for (const item of ITEMS_DATA) {
    const w = item.buy <= 400 ? 3 : item.buy <= 1500 ? 2 : 1;
    for (let i = 0; i < w; i++) tickets.push(item.index);
  }
  const size = 15 + Math.floor(Math.random() * 6);
  const picked = new Set();
  for (const cat of ['lock_pick','wiring','cutting','weapon','armor']) {
    const c = ITEMS_DATA.filter(i => i.cat === cat);
    if (c.length) picked.add(c[Math.floor(Math.random() * c.length)].index);
  }
  let attempts = 0;
  while (picked.size < size && attempts++ < 500)
    picked.add(tickets[Math.floor(Math.random() * tickets.length)]);
  return _shuffle([...picked]);
}

function initShopStock(state) {
  state.shopStock = _generateShopStock();
}

function _shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function _randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

const MAP_SLOTS = [
  {x:12,y:12},{x:25,y:12},{x:40,y:12},{x:55,y:12},{x:70,y:12},{x:85,y:12},
  {x:12,y:26},{x:25,y:26},{x:40,y:26},{x:55,y:26},{x:70,y:26},{x:85,y:26},
  {x:12,y:40},{x:25,y:40},{x:40,y:40},{x:55,y:40},{x:70,y:40},{x:85,y:40},
  {x:12,y:54},{x:25,y:54},{x:40,y:54},{x:55,y:54},{x:70,y:54},{x:85,y:54},
  {x:12,y:68},{x:25,y:68},{x:40,y:68},{x:55,y:68},{x:70,y:68},{x:85,y:68},
  {x:12,y:82},{x:25,y:82},{x:40,y:82},{x:55,y:82},{x:70,y:82},{x:85,y:82},
];

const CITY_LOCATION_TEMPLATES = {
  highway:    { min:1, max:3, fixed:false, si:[1,1], label:'Highway',        desc:'Hijack a vehicle from a driver (confrontation).' },
  residential:{ min:2, max:5, fixed:false, si:[1,4], label:'Residential Area',desc:'Steal a parked vehicle quietly.' },
  busy:       { min:1, max:4, fixed:false, si:[1,3], label:'Busy Street',     desc:'Steal a parked vehicle. High risk — lots of witnesses.' },
  racing:     { min:0, max:2, fixed:false, si:[1,2], label:'Racing Area',     desc:'Steal a vehicle during or after a race event.' },
  shop:       { min:1, max:1, fixed:true,  si:[1,6], label:'Shop',            desc:'Buy equipment and tools.' },
  dealer:     { min:1, max:1, fixed:true,  si:[1,0], label:'Car Park',        desc:'Sell stolen vehicles.' },
  bank:       { min:1, max:1, fixed:true,  si:[1,5], label:'Bank',            desc:'Rob the bank.' },
  airport:    { min:1, max:1, fixed:true,  si:[2,5], label:'Airport',         desc:'Fly to another city or end the game.' },
  dealer_npc: { min:0, max:1, fixed:false, si:[2,6], label:'Drug Dealer',     desc:'Buy drug packages from a street contact.' },
};

function _generateCityLocations(cityId) {
  const stealableTypes = ['highway','residential','busy','racing'];
  const slots = _shuffle(MAP_SLOTS.slice());
  let slotIdx = 0;
  const locs = [];
  for (const [type, tpl] of Object.entries(CITY_LOCATION_TEMPLATES)) {
    const count = tpl.fixed ? 1 : _randInt(tpl.min, tpl.max);
    for (let i = 0; i < count; i++) {
      const pos = slots[slotIdx % slots.length];
      slotIdx++;
      locs.push({
        id:       stealableTypes.includes(type) ? `${type}_${i}` : null,
        type,
        x:        pos.x,
        y:        pos.y,
        si:       tpl.si,
        label:    tpl.label,
        desc:     tpl.desc,
        fixed:    !!tpl.fixed,
        lifespan: tpl.fixed ? null : _randInt(3, 7),
        age:      0,
        dealRisk: tpl.fixed ? 0 : _randInt(5, 35),
        hoeRisk:  tpl.fixed ? 0 : _randInt(8, 40),
      });
    }
  }
  return locs;
}

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------
module.exports = {
  initState, advanceDay, rollCheck, hasItem, resolveAction,
  applyArrestPenalties,
  initRace, resolveRaceTurn, resolveRaceWin, resolveRaceLoss,
  makeInventoryItem, getItem, initShopStock, ITEMS_DATA,
  _generateCityLocations,
};
