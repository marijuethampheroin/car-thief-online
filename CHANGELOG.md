# Car Thief Online — Changelog

---

## Session 33 — 2026-05-15 — race.html MP wiring

### Changed — `race.html`
- Added MP detection (`IS_MP`, `MP_ID`, `MP_CODE`) and WS connection with reconnect on open
- Turn button now sends `race_turn` to server in MP instead of resolving locally
- Added `race_turn_result` handler: applies log, updates meters, applies server state; on finish calls `mpFinishRace()` — no local `resolveRaceWin/Loss` calls in MP
- Added `mpFinishRace()`: saves server state, shows Close button, dims opponent arrow on player win
- SP path entirely unchanged — all MP code gated behind `IS_MP`
- Countdown log text cleaned up ("His hand drops... GO!")

---

## Session 32 — 2026-05-15 — steal_claim conflict resolution + arrest navigation

### Changed — `crime.html`
- `mpWs.onopen` now sends `steal_claim` (locId + uid) immediately after reconnect, locking the target vehicle in the server's shared pool for the duration of the steal attempt
- Added `steal_ack` handler — silent no-op, proceed normally
- Added `steal_nack` handler — "Someone else just grabbed that one. Heading back..." → redirects to `game.html` after 2s
- `arrest_result` handler now navigates to `arrested.html` after saving state and storing penalties (was missing the redirect)
- `endScene("fled")` message improved: "You leave empty-handed." (was awkward original phrasing)
- `endScene("success")` message improved: "You drive away with the vehicle. Back to the city."
- Restored `startBankExit()` and `bank_success` end scene branch (were present in working version, missing from backup)

---

## Session 31 — 2026-05-15 — Day Timer Countdown

### Added — `server.js`
- `room.nextDayAt = Date.now() + DAY_DURATION` stored when `startDayTimer()` is called and reset on every tick
- `nextDayAt` included in `game_started`, `day_advanced`, and `reconnected` message payloads

### Added — `play.html`
- `nextDayAt` saved to `sessionStorage` in the `game_started` handler alongside `locationPools` and `locDefs`

### Added — `game.html`
- `⏱ MM:SS` countdown display in HUD row 1, between Day and Debt; hidden in singleplayer
- Turns red at ≤30 seconds remaining
- `startDayCountdown(nextDayAt)` — sets a 1s `setInterval` ticking against the server-provided Unix timestamp; clears any previous interval before starting
- Called from: `reconnected` handler, `day_advanced` handler, and MP init block (reads `nextDayAt` from sessionStorage on page load)
- Timer therefore syncs correctly on fresh join, mid-game page refresh, and day rollover

---

## v0.3.0 — Session 30 — 2026-05-15 — Players & Chat Modal

### Added — `game.html`
- **Players & Chat modal** — opens via 💬 HUD icon or `···` message strip button
  - Player roster bar at top: portrait thumbnail, name, online/away dot per player
  - Scrollable chat log with system entry on open
  - Input row with Send button and Enter-to-send keyboard shortcut
  - Singleplayer: input and Send button disabled with explanatory placeholder
  - Multiplayer: requests fresh player list from server (`get_players`) on every open; input focused automatically
- **Unread pulse** — 💬 icon turns gold and tooltip updates to "New message" when a chat message arrives while the modal is closed; clears on next open
- `_chatRoomPlayers` array tracks known room players; seeded from the `reconnected` message on WS connect, refreshed by `players_list` responses, and updated by `player_disconnected` events
- `esc()` helper added to game.html script (was previously only in `play.html`); its absence was silently preventing `openChatModal()` from completing

### Added — `server.js`
- `get_players` handler — responds to the requesting client with `playerList(room)` (name, portraitSrc, profession, connected per player)
- `chat_message` handler — strips/trims input to 120 chars, broadcasts `{ type:'chat_message', fromId, fromName, text }` to all room players (sender included; no optimistic rendering needed)

### Added/Changed — `game.html` `mpHandleMsg`
- `chat_message` case — appends chat entry to log; pulses 💬 icon if modal is closed
- `players_list` case — merges server roster into `_chatRoomPlayers`; re-renders player bar if modal is open
- `player_disconnected` — now also marks player as away in `_chatRoomPlayers` and re-renders bar if modal is open
- `reconnected` — now seeds `_chatRoomPlayers` from `msg.players`

### Fixed — `game.html`
- `esc()` was not defined in game.html scope; every call inside the chat functions threw a `ReferenceError`, silently preventing the modal from opening entirely

---

## Session 29 — 2026-05-15 — Shared Map Locations + Auth Token Refresh

### Fixed — `play.html`
- Added Firebase app-compat + auth-compat SDK to `<head>` and initialized Firebase
- `connectWs()`: replaced stale `sessionStorage.getItem('fbToken')` with `firebase.auth().currentUser.getIdToken()` — auto-refreshes expired tokens (Firebase ID tokens expire after 1 hour); falls back to sessionStorage value if `currentUser` is null; updates sessionStorage cache after refresh

### Fixed — `play.html`, `server.js`, `game.html`
**Problem:** Each client called `_generateCityLocations()` independently, producing different randomized icon positions despite matching location pool IDs.

**Solution:** Host generates locations once on `start_game`; server distributes them to all players; clients use server-provided locations.

- `play.html` `doCreate()`: saves `startCityId` to `sessionStorage` so it's available when the game starts
- `play.html` `startGame()`: replaced static `LOC_DEFS` constant with a live call to `_generateCityLocations(startCityId)` — host now generates the authoritative location list
- `play.html` `game_started` handler: saves `msg.locDefs` to `sessionStorage` alongside `locationPools`
- `server.js` `start_game` handler: includes `locDefs: room.locDefs` in the `game_started` message sent to each player
- `server.js` `reconnected` send: includes `locDefs: room.locDefs` so rejoining players also receive the correct map
- `game.html` MP init block: loads `locDefs` from `sessionStorage` into `gs.mpLocDefs`
- `game.html` `renderMapIcons()`: uses `gs.mpLocDefs` when `IS_MP` instead of calling `getCityLocations(gs)`; skips `initLocationPools` for missing locs in MP (server owns the pools)
- `game.html` `reconnected` handler: applies `msg.locDefs` to `gs.mpLocDefs` before calling `renderMapIcons()`

---

## Session 28 — 2026-05-14 — Shared City Map / Location Pools

### Fixed — `game.html`
- On load: server-assigned `locationPools` (saved to `sessionStorage` by `index.html` on `game_started`) are now injected into `gs.locationPools` before `renderMapIcons()` is called, replacing the previous behaviour where each client generated independent pools
- Added `case 'reconnected'` to `mpHandleMsg`: restores `gs` from server state and applies `msg.locationPools`; calls `renderHUD()` and `renderMapIcons()` so a page-refresh re-syncs correctly
- `day_advanced` handler: removed dead `if (msg.state.locationPools)` block (server state never carries `locationPools`); added `renderMapIcons()` call so the map refreshes after a day tick

## Session 27 — 2026-05-14 — Equipment Shop Fixes

### Bug Fixes
- `game.html` `renderStoreDetail()`: fixed large item image path extension `.bmp` → `.png` (files in `Graphics/items_full/` are PNGs)
- `game.js` `_generateShopStock()`: excluded `cat === 'drug'` items from equipment shop stock; drugs are only available from the drug dealer NPC

---

## Session 26 — 2026-05-13 — Deployment + File Renames

### Deployment
- Game is now live: static files on GitHub Pages (`https://marijuethampheroin.github.io/car-thief-online/`), Node/WebSocket server on Railway (`https://car-thief-online-production.up.railway.app`)
- `server.js` — `SERVICE_ACCOUNT_KEY` env var replaces `require('./serviceAccountKey.json')`; falls back to local file for dev
- `server.js` — `PORT` reads from `process.env.PORT || 8080` for Railway compatibility
- `.gitignore` created — excludes `serviceAccountKey.json`, `node_modules`, archives, spec docs, utility scripts, `backup/`, `toolkit_b/`, `ct5 bank robbery/`

### File Renames
- `start.html` → `index.html` (multiplayer entry point)
- `main.html` → `classic.html` (singleplayer screen, kept for reference)
- `index.html` (old singleplayer entry) removed from active use

### Changed — WS URLs
- `index.html` (×2) + `game.html` (×1) — WS URLs now auto-switch: `ws://localhost:8080` locally, `wss://car-thief-online-production.up.railway.app` when deployed

### Changed — Redirects
- All files updated: `start.html` → `index.html`, `lobby.html` → `index.html`, `main.html` → `game.html` throughout `auth.html`, `classic.html`, `crime.html`, `drive.html`, `game.html`, `index.html`, `main.html`, `sw.js`
- `sw.js` PRECACHE list updated to `classic.html` in place of `main.html`

### Fixed — GitHub Pages path compatibility
- `manifest.json` and `sw.js` references changed from absolute (`/manifest.json`) to relative (`manifest.json`) in `index.html` and `game.html` to work under the `/car-thief-online/` subfolder

---

## Session 23 — [2026-05-09] start.html + Live Room List

### Created — `start.html`
- Unified entry point replacing the two-page `index.html` / `lobby.html` flow
- Three tabs: **Browse** (live public room list + join by code), **Create** (host a room), **Solo** (local play)
- Browse tab opens a pre-auth WebSocket (`get_room_list`) and polls every 5s; renders room rows with name, host, player count, and Join button
- Join by code input in Browse footer; validates 4-letter code before attempting
- `joinRoom(code)` — redirects to `auth.html?then=start.html&join=CODE` if not authenticated; re-joins automatically on return via `?join` param on load
- Create tab — Room Name (20 char), Public/Private toggle, Profession picker, city map, all wired to `doCreate()`; requires auth
- Solo tab — Name, portrait, Profession picker, city map, Theme picker (Classic → `main.html`, Modern → `main_v2.html`); no auth required
- Single shared portrait picker (`picIdx`/`picPaths`) drives both Create and Solo tab portrait images simultaneously
- `buildCityMap(wrapId)` — reusable city dot builder called for both Create and Solo map wraps
- Room panel — shown after `room_created` / `room_joined`; displays room name, code, player list; host sees Start Game button, non-host sees waiting message
- `handleMsg` — full message handler: `room_created`, `room_joined`, `player_joined`, `player_disconnected`, `player_reconnected`, `game_started`, `error`
- Auto-join on load: reads `?join=CODE` from URL (set by auth.html redirect); calls `joinRoom(code)` immediately

### Edited — `server.js`
- `const browsers = new Set()` — tracks pre-auth WS connections browsing the room list
- `pushRoomList()` helper — broadcasts filtered public, unstarted room list to all browsers
- `get_room_list` handler — whitelisted before the auth gate; adds ws to `browsers`, sends current list immediately
- `create_room` — added `room.roomName` and `room.isPublic`; `browsers.delete(ws)`; `pushRoomList()` after creation; `roomName` added to `room_created` response
- `join_room` — `browsers.delete(ws)`; `pushRoomList()` after join; `roomName` added to `room_joined` response; `pushRoomList()` after `player_joined` broadcast
- `start_game` — `pushRoomList()` after all `game_started` sends (room disappears from public list)
- `ws.on('close')` — `browsers.delete(ws)` first; `pushRoomList()` after disconnect handling

### Edited — `auth.html`
- `doLogin` redirect — replaced `window.location.href = 'lobby.html'` with `?then`/`?join` passthrough logic
- `doRegister` redirect — same change; preserves join code through registration flow



## Session 22 — [2026-05-09] Gun ID Fix + Getaway Balance

### Fixed — `items.json` + `game.js`
- Added `id` field to the 8 firearms in both `items.json` and the inline `ITEMS_DATA` array in `game.js`; `getValidActions` / `hasGun` check in `crime.html` reads `i.id` against `['pistol','shotgun','rifle']` — without these fields the check always returned false and gun options never appeared even when armed
- Pistols (id `'pistol'`): Beretta 92FS (1), Magnum Baby Eagle (2), Walther P99 (3), Glock 17 (28)
- Rifles (id `'rifle'`): Remington 300 (4), IMI Micro UZI (27), M96 Recon Carbine (42)
- Shotguns (id `'shotgun'`): Mossberg 590 Cruiser (43)
- Non-gun weapons (knives, batons, tasers, stun guns) intentionally left without `id` — they do not qualify for gun actions
- `makeInventoryItem` — added `id: def.id` to the returned object; without this, no inventory item carried the `id` field regardless of ITEMS_DATA, so the `hasGun` check always failed even after the ITEMS_DATA fix
- `hasItem` in `game.js` — added `i.id === itemKey` check alongside the legacy `i.key` fallback; `resolveAction`'s `show_your_gun` guard calls `hasItem(state,'pistol')` etc., which previously never matched since `hasItem` had no `id` lookup path

### Balanced — `resolveDriveAway` in `game.js`
- Raised clean-escape threshold from police level 40 → 55; short/clean jobs now reliably escape without a roll
- Lowered mid-pursuit roll difficulty from 15 → 5 (police 55–69); a driving-11 starter goes from ~5% to ~6%, a driving-26 driver goes from ~11% to ~21%
- Lowered heavy-pursuit roll difficulty from 30 → 15 (police 70+); previously near-impossible for non-driver builds
- Net effect: clean jobs escape cleanly, messy jobs are still risky but not automatic death sentences for non-driver characters

### Added — Tool System (`items.json`, `game.js`, `crime.html`)
- Added `id` fields to all theft tools in `items.json` and `game.js` ITEMS_DATA: `snap_gun`, `lock_pick_set`, `ignition_decoder`, `tryout_keys`, `pro_pick_set`, `pump_wedge`, `slim_jim`, `wire_cutter`, `wire_stripper`, `probelight`, `multimeter`
- Added `getToolBonus(inventory, type)` helper in `game.js` — returns best bonus from held tools; pick tools: tryout_keys+5, lock_pick_set+10, snap_gun+20, pro_pick_set+25, ignition_decoder+30; wiring tools: wire_cutter+5, wire_stripper+10, multimeter+15, probelight+20; slim_jim/pump_wedge: flat +15
- All `resolveAction` covert cases now use tool bonuses: `lockpick_door` and `pick_ignition` add pick bonus; `door_opener` adds pump_wedge bonus; `disable_alarm` and `hotwire_engine` add wiring bonus
- Added `slim_jim` as a new `resolveAction` case — succeeds cleanly but failure triggers alarm (distinct risk profile vs lockpick)
- `smash_window` no longer requires a hammer — always available as a last resort
- `getValidActions` in `crime.html` now gates tool actions by inventory: lockpick requires any pick tool; slim_jim requires slim_jim; door_opener requires pump_wedge; disable_alarm/hotwire require wiring tool; pick_ignition requires pick tool; smash_window always shown
- Added `slim_jim` to `actDefs`; updated `door_opener` label to "Use Pump Wedge"

---

## Session 20 — [2026-05-08] Phase 2 Steps 3–9 (Drug Dealing Complete)

### Added — `game.js`
- `dealer_npc` entry in `CITY_LOCATION_TEMPLATES` — non-fixed, min:0 max:1, `si:[2,6]` (mapgroups02 phone icon), lifespan 3–7 days; swept by `advanceCityLocations` automatically
- `DEALER_NPC_POOL` — 7 named dealer NPCs, one per city: Slick (LV), Cortez (LA), Twitchy (KC), Rooster (Houston), Lito (Miami), Murph (Boston), Dozer (Philly); ENEMY01–07.BMP portraits (placeholder)
- `initDealerNPCs(state)` — seeds `state.dealerNPCs[]` from pool; old-save safe (skips if already populated); called from `initState()` after `initCities()`
- `getDealerStock(state, dealerNpcId)` — generates 3–6 stock slots daily; favor gates tiers (0–30: weed/ecstasy/shrooms; 31–60: +cocaine; 61+: +heroin); price = `buy * rngMark * favorDiscount`
- `dealRisk: _randInt(5,35)` and `hoeRisk: _randInt(8,40)` added to location objects in both `_generateCityLocations` and `advanceCityLocations` spawn block; fixed locations get 0
- `assignToDealing(state, contactId, locId)` — assigns hired contact or player to a location for dealing; guards hired status, no double-assign, loc exists
- `recallFromDealing(state, contactId)` — removes dealing assignment, clears `assignedLocation`
- `resolveDealingIncome(state)` — nightly resolution: robbery check (solo, 60% of dealRisk), ~50% sell chance per package, charmMod + groupBonus income, arrest check (dealRisk ×1.4 if group); 3-strike prison for contacts; `threeStrikeFlag` on player; returns log array
- `haggleWithDealer(state, dealerNpcId, packageIndex, offeredPrice)` — success chance = acting + favorBonus clamped [10,75]; success → favor +2
- `buyDrugs(state, dealerNpcId, itemIndex, price)` — cash/space guards; adds to inventory; favor +1
- `resolveDealingIncome` hooked into `advanceDay()` after `initShopStock`; `state.casinoWinnings = 0` reset added
- `makeInventoryItem` — drug items (`cat === 'drug'`) now derive `img` from item name: `Graphics/drugs/name_size.png` (e.g. `weed_small.png`)

### Added — `main.html`
- HUD "Wanted:" label → "Priors:"; display changed from 5 gold stars to 3 brown circles (●●○); `wantedLevel` clamped to 3
- Status bar help text updated to reference "Priors / rap sheet" instead of "Wanted Level"
- `case 'dealer_npc'` added to `renderLeftPanel` switch
- `dealer_npc` map icon click wired → `renderLeftPanel({ type:'dealer_npc', data:{ic} })`
- `renderDealerNpcPanel(ic)` — portrait + name + favor bar (Cold/Neutral/Friendly/Trusted) + scrollable stock list; package click shows item image + haggle/buy detail zone
- "Assign" tab added to contacts modal
- `renderAssignmentsTab(body)` — lists hired crew with current assignment status, location dropdown (dealRisk > 0 locs), Assign/Recall buttons wired to `assignToDealing`/`recallFromDealing`

---

## Session 19 — [2026-05-07] Travel Fixes + Phase 2 Steps 1 & 2

### Fixed
- `game.js` `driveToCity()` — was checking `state.activeVehicle` (legacy singular field, no longer exists); corrected to `state.activeVehicles[0]`; "You need an active vehicle to drive" no longer fires falsely when a vehicle is present
- `drive.html` — left-panel vehicle thumb and label were reading `gs.activeVehicle` (same legacy ref); corrected to `gs.activeVehicles[0]`; vehicle now displays correctly on the drive screen

### Added
- `main.html` `renderAirportPanel()` — new left-panel renderer for the Airport location; shows city name, map thumbnail, two travel buttons: **Fly To City — $500** (→ `airport.html`) and **Drive To City — Free** (→ `drive.html`); Drive button is greyed out with explanatory note when no active vehicle is present
- `main.html` `renderLeftPanel()` — added `case 'airport': renderAirportPanel()`

### Changed
- `main.html` — Airport map icon click now calls `renderLeftPanel({ type: 'airport' })` instead of navigating directly to `airport.html`; consistent with how all other location types open a left panel first
- `main.html` — ✈ nav button (top-right HUD) now calls `renderLeftPanel({ type: 'airport' })` instead of navigating directly to `airport.html`
- `drive.html` — Menu button upgraded from bare stub to a working dropdown matching `main.html`; wired `toggleMenu()`, `initMenu()`, and outside-click-to-close behaviour; Menu → New Game / Back to Lobby depending on `IS_MP`

### Phase 2 — Step 1: Drug Items
- `items.json` — 10 drug package items added (indices 45–54): Weed S/L, Ecstasy S/L, Shrooms S/L, Cocaine S/L, Heroin S/L; each has `cat:'drug'`, `slot:'drug'`, buy/sell prices, and `sellMid` (spec midpoint value used in overnight income calculation)
- `game.js` `ITEMS_DATA` — same 10 entries mirrored into the inline array

### Phase 2 — Step 2: State Shape
- `game.js` `initState()` — three new state fields: `dealerNPCs: []` (7 persistent city dealer NPCs), `drugDealing: []` (assignment records `{ contactId, locId, role }`), `casinoWinnings: 0` (daily cap tracker for Phase bonus)
- `game.js` `generateContact()` — added `strikes: 0` to every new contact object (cumulative arrest count; 3 = prison)
- `main.html` — four old-save guards added on load: `dealerNPCs`, `drugDealing`, `casinoWinnings` defaulted if missing; all existing contacts patched with `strikes: 0` if absent

---

## Session 16 — [2026-05-05] Hideout Panel

### Added
- `game.js` — `assignToHideout(state, contactId)`: sets `c.assignedLocation = 'hideout'` on a hired contact; guards against non-hired and already-assigned; saves state; returns `{ ok, msg }`
- `game.js` — `recallFromHideout(state, contactId)`: clears `c.assignedLocation`; enforces 3-crew active cap before allowing recall; saves state; returns `{ ok, msg }`
- `main.html` — `gs.playerAtHideout` state flag; old-save guard initialises it to `false` on load
- `main.html` — `renderHideout()`: slot 0 = dedicated player slot (portrait visible when `gs.playerAtHideout`; inactive otherwise); slots 1–4 = hired crew assigned to hideout; all slots rendered as `rp-slot` matching existing panel style
- `main.html` — Hideout drag-and-drop: crew slots in Active Team are now `draggable`; dragging a crew portrait onto any hideout slot calls `assignToHideout()`; dragging a hideout crew portrait onto an Active Team crew slot calls `recallFromHideout()` (blocked + logged if team full)
- `main.html` — Player hideout drag-and-drop: player portrait in Active Team is `draggable` (`type:'player'`); dropping onto hideout slot 0 sets `gs.playerAtHideout = true`; dragging hideout slot 0 (`type:'hideout-player'`) back onto Active Team player slot clears the flag; no crew cap check for player recall

### Changed
- `main.html` — `dragSrc` comment updated to document all types: `'activeVehicle' | 'garage' | 'crew' | 'hideout' | 'player' | 'hideout-player'`
- `main.html` — Player slot in `renderActiveTeam()`: renders inactive when `gs.playerAtHideout` is true; draggable and clickable otherwise
- `main.html` — `renderHideout()` called on load and after every assign/recall drag action

### Known Bugs Logged
1. `crime.html` — Can commit to activity with no active team; hideout/inactive members not excluded from resolution
2. `main.html` — ~~Can't drag vehicles to garage~~ — Fixed: `dragSrc.idx` → `dragSrc.avIdx` in garage drop handler; stale `gs.activeVehicle` ref replaced
3. `main.html` — ~~Can't sell vehicles~~ — Fixed: `sellActiveVehicle(avIdx)` reads correct slot
4. `main.html` — ~~Map location icons overlap~~ — Fixed: `MAP_SLOTS` slot system replacing zone-based random placement
5. `main.html` — ~~Garage cap wrong~~ — Fixed: same root cause as #2
6. `game.js` — `_randInt` accidentally deleted during MAP_SLOTS edit; restored; new game broken briefly

---

## Session — [2026-04-30] session 9 — Racing

### Added
- `game.js` — `RACE_TOTAL_DIST` (100), `RACE_CHECKPOINTS` ([33,66]), `RACE_POLICE_RISE` ([5,8]) constants
- `game.js` — `initRace(state, playerVehicle, opponentVehicle)`: builds `gs.currentRace` object (playerDist, oppDist, checkpointsPassed, policeAwareness, policeReadiness=22, turn, finished, winner); saves state
- `game.js` — `resolveRaceTurn(state)`: one turn of racing; player gain = 8–12 + Driving/20; opponent gain = 6–10 + speed/14; checkpoint detection at 33 and 66 (+1 Driving on pass); finish detection at 100 (player wins ties); police awareness rises 5–8/turn; returns `{ log, checkpointHit, drivingGain, finished, winner }`
- `game.js` — `resolveRaceWin(state)`: pushes opponent vehicle to `gs.garage` (cap 12); clears `gs.currentRace`
- `game.js` — `resolveRaceLoss(state)`: removes `gs.activeVehicle`; 25% chance lost vehicle appears in `gs.dealerLot`; clears `gs.currentRace`
- `game.js` `initState()` — added `currentRace: null` to state shape
- `main.html` — `renderRacePanel(data)`: no-opponent state shows CT6-canon location description + bet warning; opponent-selected state shows car sprite, speed bar, bet/prize info, Race button (disabled without active vehicle)
- `main.html` — `goToRace()`: calls `initRace()`, reloads state, navigates to `race.html`
- `main.html` `renderLeftPanel()` — added `case 'race': renderRacePanel(ctx.data)`
- `race.html` — new screen: Player Groups / Enemy Groups header (car slots + portrait slots); scrolling race log with color-coded entries (dim/skill/good/bad/neutral); Police Awareness + Police Readiness meters in status bar; Turn button → resolves one race turn, appends log; on finish, Turn replaced by Close button; Close calls `resolveRaceWin` or `resolveRaceLoss` then returns to `main.html`; countdown log fires 400ms after load for atmosphere; random NPC portrait (`enemy##.bmp`) in opponent portrait slot

### Changed
- `main.html` map click handler — `racing` type split out of `stealTypes`; racing area click sets `data-is-race` on right-panel slots and calls `renderLeftPanel({ type:'race', data:null })`
- `main.html` right-context slot click handler — checks `slot.dataset.isRace`; if set, routes to `renderRacePanel({ opponent: v })` instead of `renderVehicleView`

---

## Session — [2026-04-30] continued (4)

### Changed
- `main.html` `renderDealerPanel()` — complete rewrite: fixed-height info zone (`flex:0 0 162px`) above a 12-slot grid (was 6); grid uses exact backpack slot sizing (31×31px, 4-col `bp-grid`); panel no longer overflows
- `main.html` `renderDealerDetail(v, mode)` — new function; updates only the info zone in-place (car sprite, name, price/spec, Cond/Lock/Elec bars, action button); grid stays visible; moves `.selected` highlight to clicked slot; clicking a different slot updates info without rebuilding the panel
- `main.html` left panel click handler — dealer slot click now calls `renderDealerDetail()` instead of replacing `leftPanel.innerHTML`
- `main.html` `renderGarage()` garage slot click (dealer mode) — now calls `renderDealerDetail(v, 'garage')` instead of inline innerHTML replacement

---

## Session — [2026-04-30] continued (3)

### Added
- `main.html` `renderActiveTeam()` — replaces inline active team loop; now a callable function so it can re-render after drag-and-drop operations
- `main.html` — drag-and-drop between Active Team slot 1 and Garage slots (HTML5 drag API); occupied slots are `draggable`; empty slots are valid drop targets; drag highlight via `outline` on `dragover`; swap logic: if destination occupied, vehicles exchange slots; if empty, vehicle moves; `gs.garage` normalised with `.filter(Boolean)` after each swap
- `main.html` — `dragSrc` module-level var (`{ type, idx }`) tracks drag origin

### Changed
- `main.html` `sellActiveVehicle()` — now calls `renderActiveTeam()` instead of manually clearing slot 1 innerHTML

---

### Added
- `game.js` `initState()` — added `dealerLot: []` to state shape (persisted array of vehicles sold to dealer)
- `main.html` `renderDealerPanel()` — left panel view: single "Dealer Lot" grid (`gs.dealerLot[]`); same `.bp-slot`/`.inv-grid` styles and 0.5× sprite thumbnails as garage render; "Your Garage" section removed (redundant with right-panel garage)
- `main.html` `sellToDealer()` — sells selected garage vehicle at `price × (condition/100)`; moves vehicle from `gs.garage` to `gs.dealerLot`; updates cash, HUD, garage render
- `main.html` `buyBackFromDealer()` — buys back selected lot vehicle at sell price × 1.10; guarded by cash and garage cap (12); moves vehicle from `gs.dealerLot` to `gs.garage`
- `main.html` — dealer lot slot click delegation in left panel listener; clicking an occupied lot slot sets `dealerVehicle`/`dealerMode` and renders vehicle detail + Buy Back button
- `main.html` `renderGarage()` — garage slots now context-aware on click: if dealer panel is open, shows vehicle detail + Sell button; otherwise shows owned vehicle detail as before
- `main.html` — `dealerVehicle` and `dealerMode` module-level vars added
- `main.html` — dealer slots given class `dealer-slot`; backpack item click handler guards against `dealer-slot` to prevent item popup firing on dealer grid

### Changed
- `main.html` `renderLeftPanel()` — added `case 'dealer': renderDealerPanel()`
- `main.html` map click handler — `ic.type === 'dealer'` now routes to `renderLeftPanel({ type: 'dealer' })`

### Fixed
- Clicking dealer lot grid slots was triggering the backpack item popup; fixed by `dealer-slot` class guard in bp-slot handler
- `sellActiveVehicle()` — now pushes sold vehicle to `gs.dealerLot` so it appears in the Dealer Lot panel; refreshes dealer panel if open
- `sellToDealer()` / `buyBackFromDealer()` — vehicle removal from arrays now uses `uid` comparison instead of reference equality; reference equality silently failed after JSON serialize/deserialize round-trip via `saveState`/`loadState`

---

## Session — [2026-04-30] continued

### Changed
- `game.js` `initState()` — `garage: null` → `garage: []` (proper array for multi-vehicle storage)
- `crime.html` `endScene('success')` — routing logic: if `gs.activeVehicle` is null, stolen vehicle becomes active vehicle (existing behaviour); otherwise pushed to `gs.garage` (capped at 6; guards against non-array on old saves)
- `main.html` — static garage slot HTML replaced with `renderGarage()` function; reads `gs.garage[]`, renders sprite thumbnails (same scale/style as Active Team slot 1) for occupied slots; empty `rp-slot inactive` for remainder; called on load

---

## Session — [2026-04-30]

### Added
- `game.js` — `applyArrestPenalties(state)`: calculates fine (`$500 base + $250/prior arrest`, capped `$5,000`), seizes 1 random inventory item (2 if arrests ≥ 3), deducts fine from cash (overflow added to debt), bumps `wantedLevel` by 1 (max 5). Returns `{ fine, seized, debtIncrease }`.
- `game.js` — `_generateShopStock()`: builds weighted 15–20 item index list (cheap items 3× tickets, mid 2×, expensive 1×); guarantees at least 1 item from: lock_pick, wiring, cutting, weapon, armor categories.
- `game.js` — `initShopStock(state)`: wraps `_generateShopStock()`; called by `initState()` and `advanceDay()`.
- `arrested.html` — New screen: greyscale-tinted portrait with "ARREST #N" badge, BUSTED header, charges table (fine, debt overflow if applicable, cash remaining), confiscated items list with STOOL images, 5-star wanted level display, Back to City button.
- `store.html` — New screen: rotating stock from `gs.shopStock`; left panel (portrait, backpack grid, day); center 4-column item card grid with filter tabs (All / Lock Picks / Wiring / Cutting / Mechanic / Code / Weapons / Armor / Other); right detail panel (TOOL image, buy/sell prices, slot, status, Buy button); bottom bar with live cash and Leave Shop.

### Changed
- `game.js` `initState()` — added `shopStock: []` to state shape; calls `initShopStock(state)` on new game.
- `game.js` `advanceDay()` — calls `initShopStock(state)` to refresh shop stock each day.
- `crime.html` `endScene("busted")` — now calls `applyArrestPenalties(gs)`, stores result in `sessionStorage('arrestResult')`, redirects to `arrested.html` after 1.8s delay (previously just incremented arrest counter and froze).
- `crime.html` `doTurn()` — `policeRise` now multiplied by `(1 + gs.wantedLevel * 0.1)` before `addPolice()` call; higher wanted level = faster police escalation.
- `main.html` HUD — second row now includes wanted star display (`★★☆☆☆`); `renderHUD()` updates it from `gs.wantedLevel`.
- `main.html` map click handler — `type:'shop'` now routes to `store.html`.

---

## Session — [2026-04-29] continued (5)

### Fixed
- `styles.css` `.rp-slot img` — changed `object-fit: cover` → `object-fit: contain; object-position: top`; character portrait in Active Team slot no longer crops to torso
- `main.html` Active Team slot 1 vehicle sprite — replaced fixed 42×32 div with a slot-filling div scaled to 0.625× (fits 30px slot height); vehicle image no longer offset/clipped
- `main.html` right context panel vehicle thumbnails — same sprite scaling fix applied

---

## Session — [2026-04-29] continued (4)

### Added
- `main.html` `sellActiveVehicle()` — sells `gs.activeVehicle` at `price × (condition/100)`, adds cash, clears slot, saves state
- `main.html` `driveToCity()` — stub (TODO: city travel screen)
- `main.html` Active Team slot 1 click — opens vehicle detail view in left panel when an active vehicle is present

### Changed
- `main.html` `renderVehicleView()` — accepts `data.mode === 'owned'`; swaps Steal button for Sell (with condition-based price) + Drive to... (disabled stub) buttons

---

## Session — [2026-04-29] continued (3)

### Fixed
- Stolen vehicles were disappearing after a successful crime instead of appearing in the Active Team panel

### Changed
- `game.js` `initState()` — added `activeVehicle: null` to state shape (separate from `garage`)
- `crime.html` `endScene('success')` — saves stolen vehicle to `gs.activeVehicle` instead of `gs.garage`
- `main.html` Active Team render — slot 1 now renders `gs.activeVehicle` as a sprite strip thumbnail if present

---

## Session — [2026-04-29] continued (2)

### Removed
- `store.html` — deleted; store is now an in-panel view, not a separate screen

### Added
- `main.html` `renderStorePanel()` — renders store into the left panel; shows "General Info" intro state on open, swaps to "Item Info" when an item is selected
- `main.html` `renderStoreDetail()` — top section of store panel: item image, price, name, description, slot, Buy button; shows Favor bar in general info state
- `main.html` `renderStoreGrid()` — bottom section: 3-col `STOOL##.bmp` grid of `gs.shopStock` items; dims unaffordable items; fills trailing empty slots
- `styles.css` — store left panel styles: `.store-lp`, `.lp-divider-lbl`, `.store-detail-top`, `.store-general-img`, `.store-item-img`, `.store-desc`, `.store-buy-btn`, `.store-bp-grid`, `.store-grid-slot`

### Changed
- `main.html` `renderLeftPanel()` — added `case 'store': renderStorePanel()`
- `main.html` left panel click delegation — added store grid item click handler (sets `storeSelectedIndex`, updates label to "Item Info", calls `renderStoreDetail()`)
- `main.html` shop map icon click — replaced `window.location.href='store.html'` with `renderLeftPanel({ type: 'store' })`

---

## Session — [2026-04-29] continued

### Added
- `store.html` — new full-page store screen matching existing window chrome:
  - Left panel: player portrait, name, backpack grid (read-only, 12 slots), day counter
  - Center: filter tabs (All / Lock Picks / Wiring / Cutting / Mechanic / Code / Weapons / Armor / Other) + 4-column scrollable item card grid with `STOOL##.bmp` images, item name, price; cards dim when unaffordable
  - Right panel: selected item detail with full `TOOL##.bmp` image, buy/sell prices, slot type, status message (can't afford / backpack full), Buy button
  - Bottom bar: live cash display, Leave Shop button (returns to `main.html`)
- `game.js` — `_generateShopStock()`: builds weighted 15–20 item index list (cheap items 3× weight, mid 2×, expensive 1×); guarantees at least one item from lock picks, wiring, cutting, weapons, and armor categories
- `game.js` — `initShopStock(state)`: sets `gs.shopStock`; called by both `initState()` and `advanceDay()` so stock refreshes on new game and each new day

### Changed
- `game.js` `initState()` — added `shopStock: []` to state shape; calls `initShopStock(state)` on init
- `game.js` `advanceDay()` — now also calls `initShopStock(state)` to rotate stock daily
- `main.html` — shop map icon click now routes to `store.html` (was wired to nothing)

---

## Session — [2026-04-29]

### Added
- `game.js` — 8 new functions in a `PERSISTENT VEHICLE POOLS` section between `_shuffle` and `ITEMS`:
  - `_mkUid()` — generates a short random unique ID for each vehicle instance
  - `_stealableVehicles()` — returns `VEHICLES_DATA` filtered to price > 0
  - `_filterByLocType(all, locType)` — filters vehicle list by location type (racing/residential/busy/highway)
  - `_enrichVehicle(v, locId)` — enriches a raw vehicle entry with `uid`, `locId`, `condition`, `img`, `frameX`, `spec`
  - `_generatePool(locId, locType, count)` — builds an array of enriched instances for one location
  - `initLocationPools(state, locDefs)` — populates `gs.locationPools` for all stealable locations; called once on new game
  - `refreshLocationPools(state, locDefs)` — daily turnover: 20% chance each vehicle leaves; locations below 2 vehicles restock with 1–2 new ones
  - `removeVehicleFromPool(state, locId, uid)` — removes one stolen vehicle from its location; called by `crime.html` on success
- `game.js` `advanceDay()` — now accepts `locDefs` parameter and calls `refreshLocationPools` when provided

### Changed
- `main.html` `mapIcons` — all 10 stealable entries given stable `id` fields (`highway_0`, `highway_1`, `residential_0`–`2`, `busy_0`–`2`, `racing_0`–`1`)
- `main.html` — `stealableLocDefs` array derived from `mapIcons` (placed after array declaration to avoid ReferenceError)
- `main.html` — pools initialised on load via `initLocationPools` if `gs.locationPools` is missing
- `main.html` — location click handler now reads from `gs.locationPools[ic.id]` synchronously; removed async `buildLocationPool()` call
- `main.html` `goToCrime()` — `targetLocation` sessionStorage now includes `locId` and `vehicle.uid`
- `main.html` skip-day button — `advanceDay()` call updated to pass `stealableLocDefs`
- `crime.html` `endScene('success')` — calls `removeVehicleFromPool(gs, loc.locId, vehData.uid)` before redirect; falls back to plain `saveState` if either field is absent

### Fixed
- `main.html` — `stealableLocDefs` was originally inserted before `mapIcons` declaration, causing a `ReferenceError` that prevented all map icons from rendering; moved to after the array closes

---

## Session — [2026-04-22] continued (7)

### Fixed
- `styles.css` — `.char-info .bp-slot` set to `width:33px; height:33px` — exact fixed pixel size matching rp-slots
- `styles.css` — `.char-portrait` height increased 65px → 120px; added `.char-portrait img { object-fit:contain; object-position:center }` so full-body portrait is fully visible
- `styles.css` — added `.char-portrait img` override rule scoped to char portrait only; rp-slot portraits unaffected

### Known issues / next session
- Overall UI needs a visual polish pass — see plan below

### Visual polish plan (next session)
1. Map icons — remove circular badge style; render sprite directly on map, smaller (24px), subtle drop shadow only
2. Left panel — add thin dark divider strips between portrait / stats / backpack sections
3. Stat rows — tighten name column (58px), add alternating row background banding
4. Right panel r-lbl — darker background strip to distinguish label from slots
5. Verify window background texture is rendering correctly

---

## Session — [2026-04-22] continued (6)

### Fixed
- `main.html` — city map image path corrected: `Images (CT6)/city01.bmp` → `Graphics/UI_elements/city01.bmp`; map background now renders
- `styles.css` — window background texture path corrected: `Images (CT6)/background.bmp` → `Graphics/UI_elements/background.bmp`

---

## Session — [2026-04-22] continued (5)

### Added
- `game.js` `resolveAction()` — all successful skill-based actions now return a `skillGain` field naming the stat to increment (`hiding`, `locksmithing`, `electronics`, `acting`, `shooting`)
- `crime.html` `doTurn()` — on successful action, increments the relevant `gs.stats[skillGain].val` by 1 (capped at max), saves state, logs `"[Stat] improved to N."` in the crime log, and re-renders the char panel in the left column if it is currently open

---

## Session — [2026-04-22] continued (4)

### Fixed
- `main.html` — sell handler called `renderLeftPanel({ type: 'char' })` (no-op); corrected to `'character'` — panel no longer goes blank after selling an item
- `crime.html` — backpack item "Use" popup highlighted action rows via `row.dataset.act` (undefined); corrected to `row.dataset.key` — selected row now visually highlights correctly
- `game.js` `resolveAction()` — added missing `door_opener` case (Locksmithing+10 vs lockDef, low police rise, resolves to `partial`)
- `game.js` `resolveAction()` — added missing `pick_ignition` case (Locksmithing vs lockDef, resolves to `success`)
- `game.js` `resolveAction()` — added missing `ask_to_go_out` case (Acting vs 0, resolves to `success` — player talks driver out)
- `styles.css` — added `.ctx-action-btn` rule; Steal/Hijack and Go Here buttons in left panel were unstyled

---

## Session — [2026-04-22] continued (3)

### Changed
- `main.html` `renderVehicleView()` — vehicle detail image scaled to 2× (128×96, background-size 1280×96)
- `main.html` `renderRightContext()` — thumbnail sprites tuned to 42×32 (background-size 420×32) to fit within existing rp-slots without cropping

---

## Session — [2026-04-22] continued (2)

### Changed
- `game.js` `buildLocationPool()` — switched vehicle image from individual BMP (`Graphics/cars/individuals/CAR##.BMP`) to pixel-art PNG sprite strips (`Graphics/pixel_cars/cars##.png`). Each strip is 640×48, 10 frames at 64px wide. Added `frameX` property (0-576) alongside `img`.
- `main.html` `renderVehicleView()` — replaced `<img src>` with a 64×48 sprite `<div>` using `background-position`
- `main.html` `renderRightContext()` — thumbnail slots now use sprite divs; `thumbImgs` array changed from `[src, ...]` to `[{img, frameX}, ...]`

---



### Fixed
- `styles.css` — reduced `.char-info .bp-slot` height 34→26px; set `.char-info .bp-grid` gap to 1px
- `main.html` / `crime.html` — removed `?` help buttons from skill stat rows in `renderCharView`; buttons were setting flex row height to 13px each, adding ~24px total overflow

---



### Fixed
- `styles.css` — added `object-position: top` to `.portrait img`; full-body portraits now show head/face instead of torso
- `styles.css` — reduced `.char-portrait` height 90px → 65px
- `styles.css` — tightened all `.char-info` scoped rules: padding 5→4px, stat-row margin-bottom 0, stat-track height 10→8px, stat-name font-size 11→10px, char-name font-size 13→12px with tighter margins, stats-area margin 4→2px, backpack-lbl margin 2→1px
- `styles.css` — added `.char-info .bp-slot { height: 34px; aspect-ratio: unset }` so 12-slot (3×4) backpack fits without scrolling
- `main.html` — backpack slot loop capped at 12 (was 15)
- `crime.html` — backpack Array size capped at 12 (was 15)

### Result
Character panel (both screens) now fits within panel height with no scrolling. Portrait shows face.

---

## Session — [2026-04-21] continued

### Fixed
- `main.html` — map icon click was navigating immediately to crime.html; removed confirm() and direct navigation from click handler
- `game.js` — vehicles.json inlined as JS array (fetch() fails on file:// protocol)
- `game.js` — buildLocationPool() now enriches every vehicle in the pool with img, condition, spec (was only done by pickVehicle, leaving pool thumbnails without images)
- `main.html` — gameBody click handler was eating rp-slot clicks and blanking left panel; added .rp-slot and .r-section to exclusion list

### Changed
- `main.html` — map click flow rebuilt: click location → right panel populates with vehicle pool thumbnails → click thumbnail → left panel shows vehicle details + Steal/Hijack button → button navigates to crime.html
- `main.html` — added currentPool, currentLocation, selectedVehicle module-level state; goToCrime() handles navigation
- `main.html` — renderVehicleView() fully implemented with car image, price, name, spec, stat bars, crime button
- `crime.html` — action bar rebuilt as radio-style rows using Graphics/UI_elements/activities.bmp (CT6 large buttons)
- `crime.html` — all actions visible at once (CT5 freedom, no locked escalation)
- `crime.html` — activitySets updated: case_the_area removed (burglary not yet built); door entry split into lockpick_door, door_opener, smash_window; pick_ignition added
- `crime.html` — selected action persists after Turn (not cleared each turn)
- `crime.html` — action row height reduced to 22px, no scroll needed for 6 items
- `crime.html` — icon indices verified against user reference: approach=11, ask=2, show gun=12, yank=2, door/pick=1, hotwire/GPS=4, drive away/leave=10, skip=0, give up=13

### Assets
- `Graphics/UI_elements/activities.bmp` — CT6 large action buttons (14 buttons, 1 row) added by user

---

## Session — [2026-04-21]

### Added
- `vehicles.json` — full vehicle database extracted from CT6 binary (`UserData/userdata.dat` + `autosave.sav`); 125 vehicles, 111 stealable (price > 0); fields: `name`, `body`, `seats`, `price`, `speed`, `lockDef`, `elecDef`, `engine`, `isMoto`, `isTruck`, `isRaceWorthy`, `imgIdx`
- `game.js` — `loadVehicles()`: fetches and caches `vehicles.json`, filters non-stealable (price=0) entries
- `game.js` — `buildLocationPool(locationType)`: returns 3–5 randomly selected vehicles filtered by location type (racing=speed≥80 cars only; residential=cars price≤$40k; busy=all cars; highway=cars+motos)
- `game.js` — `pickVehicle(pool)`: picks one vehicle at random, adds `condition` (30–95), `img` path, and `spec` string
- `game.js` — `_shuffle()`: Fisher-Yates utility used by pool builder

### Changed
- `main.html` — location click handler now calls `buildLocationPool` + `pickVehicle` before navigating to `crime.html`; selected vehicle packed into `targetLocation` sessionStorage alongside location data
- `crime.html` — `vehData` now reads from `targetLocation.vehicle` (real vehicle from pool); hardcoded placeholder removed; fallback for direct navigation retained
- `crime.html` — `endScene('success')` now saves full vehicle object to `gs.garage` (was just `{name}`)

---

## Session — [2026-04-20] continued

### Changed — crime.html (full visual rewrite)
- Titlebar removed
- Window background: `background_crime.bmp`
- Left panel now starts blank; populates on: vehicle slot click (vehicle info), player slot click (char info), NPC slot click (NPC info)
- Scene strip added inside center panel (105px, swaps by location type: group_house, group_road, group_ground, group_office, HIGHWAY)
- Action dropdown replaced with sprite icon buttons (activities01s.bmp, 33px each) + selected action label below
- Right panel restructured: Crime Target, Your Target, Active Team, Reserve always visible; Police Patrol hidden until policeLevel ≥ 60
- Turn button restyled, prominent bottom-right
- Leave Scene button moved to bottom bar alongside Turn
- Log text colors adjusted for parchment background (dark red/green/brown on light bg)
- `renderVehicleView()`, `renderNpcView()`, `renderCharView()` defined locally in crime.html

### Notes
- Action icon sprite positions (spriteIdx) need visual verification against activities01s.bmp
- Vehicle data still placeholder (vehData object) — will be replaced by vehicle pool system

---



### Changed
- `main.html` — left panel now starts blank; populates with character info only when player clicks their portrait slot in Active Team (was rendering on load)
- `main.html` — Active Team slot 0 click listener added to trigger `renderLeftPanel({ type: 'character' })`
- `main.html` — HUD label `Daily:` → `Daily Costs:` to match CT6
- `main.html` — Debt value span given class `debt-val` for red coloring
- `styles.css` — `.debt-val { color: var(--bar-red) }` added
- `styles.css` — `#rightCtxSection { min-height: 85px }` — context section now holds space when empty, preventing layout shift

---

## Session 3 — [2026-04-16]

### Changed
- `main.html` character portrait height increased to 178px (was 138px); image now fills frame with `object-fit:cover`
- Portrait path updated to `Graphics/character_portraits_full/person##.bmp` in both `index.html` and `main.html` (was pointing to small `Images/` sprites)
- Map panel: removed fixed `max-height:300px` — map now stretches to fill game body height naturally
- Map icons replaced from emoji badges to sprite sheet clips from `Graphics/UI_elements/mapgroups01.bmp` (10 icons) and `mapgroups02.bmp` (7 icons)
- Each location type now mapped to its correct sprite: Highway→idx1, Residential→idx4, Busy Street→idx3, Racing→idx2, Bank→idx5, Airport→sheet2 idx5, etc.
- Added `.sprite` CSS class for `background-image` + `background-position` sprite clipping (33px wide per icon, scaled to 33px height)



## Session 3 — [2026-04-14]

### Added
- `game.js` — central game logic and state layer (stubs `sessionStorage` now; clearly marked TODOs for WebSocket replacement)
  - `initState(profession)` — creates fresh game state: cash $500, debt $10,000, daily costs $200, day 1, inventory, garage, arrests
  - `saveState(state)` / `loadState()` — persist/retrieve state (sessionStorage stub)
  - `advanceDay(state)` — deducts daily costs, increments day counter (test-only; server will own this in multiplayer)
  - `rollCheck(statVal, defenseStat)` — core % chance roll: `chance = playerStat - vehicleDef`, clamped 5–95%, roll 1d100
  - `hasItem(state, itemKey)` — inventory check
  - `resolveAction(action, state, vehicle)` — full action resolution for all crime-scene actions (see below)

### Changed
- `index.html` — removed Difficulty and Mode selectors (multiplayer = one standard ruleset); `startGame()` now calls `initState()` from `game.js`
- `main.html` — HUD (Day, Debt, Cash, Daily Costs) now reads live from `gameState`; Skip Day button wired (test stub, clearly marked for removal when server-side)
- `crime.html` — full skill-check wiring via `resolveAction()`:
  - **Lockpick Door** → Locksmithing vs vehicle Locksmithing Defense
  - **Hotwire Engine** → Electronics vs vehicle Electronic Defense
  - **Disable Alarm** → Electronics vs vehicle Electronic Defense (lower police rise on success)
  - **Case the Area** → Hiding (reduces police rise this turn on success)
  - **Approach Driver** → Acting
  - **Show Your Gun** → Shooting
  - **Demand Keys** → flat 80% (prior steps implied)
  - **Force Out of Vehicle** → Shooting (heavy police rise)
  - **Distract Owner** → Acting (racing area)
  - **Smash Window** → no skill check; requires hammer/blunt tool in inventory; fails with message if missing
  - **Flee** → always succeeds, small police rise, returns to main
  - Log messages include `chance%` and `rolled N` for transparency
  - `endScene()` handles success (garage updated, return to map), busted (arrest count incremented), fled

### UI
- `main.html` — removed window titlebar (minimize/maximize/close buttons) — unnecessary for browser play
- `main.html` — removed body padding so HUD sits flush at top of viewport, matching CT6 reference layout
- `main.html` — map height reduced to 300px (was 420px min with no ceiling) to better fit screen

### Architecture
- `game.js` is designed as a drop-in WebSocket client stub: all `saveState`/`loadState` calls will be replaced with `ws.send`/`ws.onmessage` when `server.js` is built; no logic changes needed in the HTML files

---

## Session 2 — [2026-04-14]

### Changed
- Removed individual vehicle icons from the city map
- Vehicles are no longer selectable map objects; they are found at location types
- Map icon array replaced with location-type icons only

### Added
- **Highway / Intersection** locations (×2) — hijacking only; player confronts the driver
- **Residential Area** locations (×3) — stealth theft of parked vehicles
- **Busy Street** locations (×3) — stealth theft, higher police presence
- **Racing Area** locations (×2) — opportunity-based theft during/after race events
- Crime scene activity menu is now context-sensitive:
  - Highway: Approach Driver, Show Your Gun, Demand Keys, Force Out of Vehicle, Flee
  - Residential / Busy: Case the Area, Smash Window, Lockpick Door, Hotwire Engine, Disable Alarm, Flee
  - Racing: Case the Area, Distract Owner, Smash Window, Hotwire Engine, Flee
- Crime scene title reflects method: "Hijacking on the Highway" vs "Stealing from Residential Area"
- Highway crime scenes use `HIGHWAY.BMP` background; others use random `house01–18.bmp`
- Opening log message is now neutral ("Scout for a target vehicle") rather than pre-scripted
- Location `desc` field added to all map icons; shown in message strip on click

### Fixed
- Map icon sprite sheet issue — `*s.bmp` files are sprite sheets, not individual icons; replaced with emoji badges for non-vehicle locations
- Click handler cleaned up to handle both `img` and `emoji` icon types
- `targetLocation` session key replaces old `targetCar` key for crime scene routing

---

## Session 1 — [2026-04-14]

### Added
- `styles.css` — shared stylesheet: color palette, window chrome, panels, buttons, stat bars, inventory grids, portrait boxes, text inputs, log area, meter/readiness bars
- `index.html` — Start New Game screen
  - Player name input
  - Portrait picker cycling through `person01–28.bmp` (28 portraits)
  - Profession selector: Actor, Shooter, Thief, Driver, Locksmith, Electrician
  - Difficulty selector: Easy, Normal, Hard, Impossible
  - Mode selector: Simple, Advanced
  - Go! passes selections to `main.html` via `sessionStorage`
  - `background.bmp` applied as window texture
- `main.html` — Main game screen shell
  - HUD bar: Day, Debt, Cash, Daily Costs, quest log / contacts / message archive icons, Menu button
  - Left panel: character portrait, name, 8 stat bars (Health, Disguise, Acting, Shooting, Hiding, Driving, Locksmithing, Electronics), 12-slot backpack grid
  - Center: city map using `city01.bmp`; 20+ clickable location icons
  - Right panel: Active Team (6 slots), Hide-out (4 slots), Garage slot
  - Bottom bar: Wanted Level meter, city name, fly/skip-day buttons
  - Message log strip
  - `background.bmp` applied as window texture
  - Profession bonus (+15) applied to relevant stat on load
  - Player portrait and name carried from `index.html` via `sessionStorage`
- `crime.html` — Crime scene screen shell
  - Left panel: vehicle image, price, name, spec, condition/defense stats, vehicle inventory (6 slots)
  - Center: scrolling action log, activity selector, Turn button (advances turn counter + police readiness)
  - Right column: Police Patrol, Your Target, Active Team, Hideout portrait slot panels
  - Bottom: Police Readiness meter (fills each turn; triggers "BUSTED" at 100)
  - Leave Crime Scene / Abandon Target button with confirmation

### Notes
- All image assets are `.bmp` files located in `Images/`
- `*s.bmp` files are sprite sheets — not suitable for direct use as icons
- Individual car images: `CAR01–107.BMP`
- Character portraits: `person01–28.bmp`
- City maps: `city01–07.bmp`
- No game logic, multiplayer, or server-side code yet — layout/shell only

---

## Session 21 — [2026-05-08]

### Fixed
- `main.html` — `?` button while viewing hired crew panel showed player info instead of crew member info. Fixed by embedding `data-contact-id` on the button in `renderContactView`; click handler now branches on presence of that attribute and shows crew member name/profession/tier/pay/health/disguise/skills (with jail banner if jailed).
- `main.html` — `initMenu()` was called before `gs` was loaded, causing `Uncaught ReferenceError: Cannot access 'gs' before initialization` which broke all buttons and panel rendering. Fixed by extracting drag label init into `initMenuDragToggle()`, called after `gs` is loaded and guarded.

### Added — `game.js`
- `initState()`: `vehicleStorage: new Array(6).fill(null)` and `itemDragSwap: false` added to state.

### Added — `main.html`
- **Vehicle Storage** — right panel top section (formerly context-only) permanently labeled "Vehicle Storage"; 6 slots backed by `gs.vehicleStorage[]`; items draggable in/out.
- `renderVehicleStorage()` — renders storage slots with draggable items; called on page init and after any item transfer.
- `renderRightContext(null)` now restores Vehicle Storage instead of clearing the label.
- **Item drag+drop system** — `itemDragSrc` variable; `firstEmptySlot()`, `getInventory()`, `transferItem()` helpers; global `dragstart/dragover/dragleave/drop/dragend` listeners scoped to `.bp-slot` and `.vs-slot`.
- `bp-slot` divs in `renderCharView()` and `renderContactView()` now have `draggable`, `data-owner`, `data-contact-id`, `data-slot` attributes.
- Crew portrait slots and player portrait slot accept item drops (moves item to that character's first empty inventory slot).
- **Menu toggle** — "→ Item drag: Move / ↔ Item drag: Swap" option added to Menu dropdown; toggles `gs.itemDragSwap`.
- Old-save guards added for `vehicleStorage` and `itemDragSwap`.


---

## Session 21 (continued) — Crime screen sequence overhaul

### game.js — resolveAction rewrite
- Signature updated to `resolveAction(action, state, vehicle, sceneState)`
- All cases now return `stateUpdate` (merged patch object) alongside existing fields
- `progress` field removed from individual step outcomes — only `get_in_vehicle` triggers `'success'`; `flee` triggers `'fled'`
- New actions added: `skip_gps`, `shoot_driver`, `demand_keys`
- Hijack actions now read `sceneState` for conditional bonuses (approached, gunShown)
- Hotwire/ignition take alarm penalty if alarm active and not disabled
- `show_your_gun` now checks inventory for gun items before allowing intimidation
- `distract_owner` (racing) sets both `ownerDistracted` and `driverRemoved`

### crime.html — dynamic action bar
- `sceneState` object added at init (all flags false)
- Static `activitySets` replaced by `getValidActions(locType, ss, playerGs)`
  - Hijack: approach → ask/gun/yank (escalation ladder) → GPS check/skip → get in
  - Covert: door entry → alarm handling → engine → GPS → get in
  - Racing: distract owner → covert path from door open
- `buildActionBar()` now calls `getValidActions` each time; auto-selects first valid action
- Stale `if (acts.length) selectAction(acts[0])` call removed
- `_applyTurnResult` merges `outcome.stateUpdate` into `sceneState`, sets `gs.pendingTrackerCheck` if `pendingTracker` flag set, calls `buildActionBar()` after every non-terminal turn
- `resolveAction` called with `sceneState` as 4th argument
- `actDefs` updated: added `skip_gps`, `shoot_driver`, `demand_keys`

---

## Session 24 — 2026-05-10

### Fixed — `styles_v2.css`
- `.map-wrap::after` — `rgba(0,0,0,0.45)` dark overlay added over city map background; `pointer-events:none` so clicks pass through
- `.map-icon` — `z-index:3` added so icons render above overlay

### Fixed — `main_v2.html`
- Airport panel USA map — added `rgba(0,0,0,0.45)` overlay div inside wrapper to match city map tint
- `spriteIcon()` rewritten to reference individual PNG files (`Graphics/map_icons/icon_01_XX.png`) instead of broken sprite sheet offset math (old stride was 33px; correct cell size is 100px)

### Fixed — `start.html`
- Portrait `<img>` on both Create and Solo tabs: `object-fit:cover` → `object-fit:contain`, `object-position:top` → `object-position:center` (full body now visible)
- `image-rendering:pixelated` removed from both portrait imgs (replaced with browser default `auto`)
- `mix-blend-mode:lighten` added to both portrait imgs (black background blends away against dark UI)

### Added — utility scripts
- `zip_cto.py` — zips all game files listed in `project_structure.md` into a dated build archive
- `slice_mapicons.py` — slices `mapgroups01/02.bmp` into 17 individual PNGs → `Graphics/map_icons/`
- `slice_portraits.py` — slices 3×2 portrait sheets into individual PNGs → `Graphics/portraits/portrait_7–18.png`

### Updated — `project_structure.md`
- Date + session number bumped to session 24
- `mapgroups01/02.bmp` entries corrected (source sheets, not direct references)
- Portraits updated to `1–18`
- Three utility scripts added to source files table
- Map icons section updated with correct description

---

## Session 25 — 2026-05-13

### Added — `game.js`
- `getBestActor(state, statKey, toolType, requireGun)` — new helper that selects the best performer for a crime action across the player and all unassigned hired crew (status `'hired'`, `assignedLocation === null`). Priority: gun gate (hard filter) → highest tool bonus → highest relevant stat; player wins ties.

### Changed — `game.js` — `resolveAction()`
- All 15 action cases now call `getBestActor()` instead of reading `state.stats[x].val` directly
- Log messages name the acting crew member when it isn't the player (e.g. *"Marco picks the lock (62% / rolled 48). Door open."*)
- `show_your_gun`, `force_out_of_vehicle`, `shoot_driver` — gun gate now checks all eligible crew, not just player inventory; returns "Nobody on the team is armed." if no one qualifies

### Changed — `crime.html`
- `getValidActions()` — `hasGun` and all tool helpers now scan team inventories (player + unassigned hired crew), not just player's
- Team slots 1–5 populated on load with portraits of unassigned hired crew; inactive CSS class removed for filled slots; `title` set to contact name
- Clicking a crew portrait in the team slots calls `renderCrimeLeft({type:'contact', data:c})`
- Added `renderContactView(c)` — renders contact portrait, tier/profession, stat bars, and backpack into the left panel (mirrors `renderCharView()`)
- `renderCrimeLeft()` extended with `contact` branch

### Added/Changed — `logic.js`
- Added `getToolBonus()` and `getBestActor()` (identical logic to `game.js`, no DOM references)
- Replaced `resolveAction()` entirely — now crew-aware, in sync with `game.js`; added missing cases: `slim_jim`, `check_gps`, `skip_gps`, `get_in_vehicle`, `shoot_driver`, `skip_turn`; gun gate on `show_your_gun` and `shoot_driver`

---

## Session 26 — 2026-05-13

### Added — `game.js` — bank robbery action cases
New cases added to `resolveAction()`:
- `bank_give_note` — Acting check; success: teller_complied + low rise; fail: alarm_triggered + larger rise
- `bank_announce` — Shooting check (gun required); success: teller_complied + medium rise; fail: alarm_triggered + large rise
- `bank_demand_teller` — No check; pays $1500–$8000; sets teller_cash_taken
- `bank_find_manager` — No check; sets manager_found; medium rise
- `bank_lead_to_vault` — Acting check (gun required); success: manager_complied; fail: rise spike
- `bank_demand_vault` — Rolls both shooting + acting (gun required); pass if either passes; success: vault_open
- `bank_fill_bag` — No check; pays $500–$2000 per bag; decrements bags_remaining; rise per bag
- `bank_leave` — Returns `progress:'bank_leave'`; triggers drive-away exit

### Added — `crime.html`
- Bank sceneState fields added to initial `sceneState` object: `teller_approached`, `teller_complied`, `alarm_triggered`, `teller_cash_taken`, `manager_found`, `manager_complied`, `vault_open`, `bags_remaining` (2–4 random), `bags_taken`
- `locType === 'bank'` branch added to `getValidActions()` — full action ladder with gun gates and state progression
- Bank action defs added to `actDefs`: all 8 bank actions with appropriate button image indices
- `bank` added to `sceneImgs` map → `Graphics/UI_elements/group_office.bmp`
- `progress:'bank_leave'` handled in `_applyTurnResult` → calls `startBankExit()`
- `startBankExit()` added — reuses `resolveDriveAway()` at speed 70; success → `endScene('bank_success')`
- `endScene('bank_success')` added — saves state, logs exit message, redirects to `game.html`
- Vehicle slot click guarded: `if(vehData)` check prevents null error when no vehicle (bank scene)

### Changed — `game.html` + `main.html`
- `goBankRob()` wired in both files: writes `{type:'bank', label:'Bank'}` to sessionStorage and navigates to `crime.html` (was "coming soon" stub)

### Added — `Graphics/UI_elements/`
- `group_office.bmp`, `group_house.bmp`, `group_road.bmp`, `group_ground.bmp` — copied from `backup/graphics/UI_elements/` (were missing from working directory)

## Session 29 — Landing page + play.html split

### Changes
- **`index.html`** — Rebuilt as landing page. Shows title, description, live multiplayer stats (rooms/players via WS), Sign In/Out in auth bar, Play Multiplayer button (requires login → `play.html`), Play Solo button (→ `classic.html`, stub), Leaderboard link.
- **`play.html`** — New file, copied from old `index.html`. Solo tab removed entirely. Login gate added on page load (redirects to `auth.html?then=play.html` if no token). `doSolo()` removed. `auth.html` redirect targets updated from `index.html` → `play.html`.

## Session 30 — Inline MP panel

### Changes — `game.html`
- Restructured center column: `.map-wrap` is now a flex column containing a new `.map-canvas` div (the map image and injected icons) and a new `.mp-inline` div below it (players list + chat)
- `renderMapIcons()` updated: `mapWrap` → `mapCanvas` for icon injection target
- `renderChatPlayers()` updated: now mirrors player list into `#mpPlayerList` as `.mp-player-entry` rows with portrait, name, profession, and status dot
- `appendChatEntry()` updated: now appends to both `#chatLog` (modal) and `#mpChatLog` (inline panel) using a shared `makeEntry()` factory
- Added `sendChatMsgInline()` function wired to `#mpChatSendBtn` click and `#mpChatInput` Enter key

### Changes — `styles_v2.css`
- `.map-wrap` changed from `position:relative` container to `display:flex; flex-direction:column`
- `.map-canvas` added: takes `flex:1`, carries the overlay `::after` and `position:relative/overflow:hidden` that `.map-wrap` previously had
- Added inline MP panel CSS block: `.mp-inline`, `.mp-players`, `.mp-player-entry`, `.mp-player-name`, `.mp-player-status`, `.mp-status-dot`, `.mp-chat`, `.mp-log`, `.mp-chat-input-row`, `.mp-chat-input`, `.mp-chat-send`
