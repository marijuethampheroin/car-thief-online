# Car Thief Online — Development Status

_Last updated: 2026-05-14 (session 28)_

---

## Overview

A browser-based multiplayer adaptation of Car Thief 6 (Maxima Games).  
Players are novice car thieves competing to repay debt and accumulate cash.  
The game ends when a player flies to the airport. Highest score (cash minus debt) wins.

**Stack:** Plain HTML / CSS / JavaScript (no frameworks). Node.js + WebSocket for multiplayer.  
**Working directory:** `D:\GAMES - PC\multiplayer\car_thief_online\`

---

## File Structure

| File | Status | Description |
|---|---|---|
| `index.html` | ✅ Done | Multiplayer entry (was `start.html`) — Browse/Create/Solo tabs; live room list; auto-join via `?join=CODE`; routes to `game.html` |
| `classic.html` | ✅ Done | Singleplayer entry+main (was `index.html`+`main.html`) — name, portrait, profession, city picker; routes to `game.html` |
| `game.html` | ✅ Done | Multiplayer main screen (renamed from `main_v2.html`) |
| `crime.html` | ✅ Done | Crime scene — crew-aware action resolution; active team slots show crew portraits; `renderContactView()` on slot click |
| `race.html` | ✅ Done | Race scene screen (pink-slip one-on-one) |
| `arrested.html` | ✅ Done | Arrest screen (mugshot, charges, confiscated items) |
| `lobby.html` | ✅ Done | Multiplayer lobby — portrait picker, host start, starting city picker |
| `styles.css` | ✅ Done | Shared styles — jail badge, `.rp-slot.jailed`, portrait img sizing fixed |
| `game.js` | ✅ Done | `getBestActor()` helper; all `resolveAction()` cases use best-stat/tool actor; gun gate on shooting actions; `policeReadiness`; `jailContact()`; `resolveDriveAway()` |
| `logic.js` | ✅ Done | Server-side game logic — `getToolBonus()`, `getBestActor()`, full `resolveAction()` in sync with `game.js` |
| `server.js` | ✅ Done | Multiplayer backend (Node.js + WebSocket, room management, day timer) |
| `package.json` | ✅ Done | Node dependencies (ws) |
| `items.json` | ✅ Done | 44 items with name, category, slot, buy/sell prices |
| `auth.html` | ✅ Done | Firebase email/password login, register, forgot password |
| `leaderboard.html` | ✅ Done | Best score / total earnings / games played; top 20 per category from Firestore |
| `airport.html` | ✅ Done | Fly-to-city screen — USA map picker, $500 travel cost |

---

## Deployment

| Service | Status | Notes |
|---|---|---|
| GitHub Pages | ✅ Live | `https://marijuethampheroin.github.io/car-thief-online/` — static files |
| Railway | ✅ Live | `https://car-thief-online-production.up.railway.app` — Node/WebSocket server |
| Firebase Auth | ✅ Live | Email/password login; token passed to server on WS connect |

---


### index.html — Start New Game
| Feature | Status | Notes |
|---|---|---|
| Name input | ✅ | Passed to main via sessionStorage |
| Portrait picker | ✅ | 6 new high-quality portraits in `Graphics/portraits/`; contacts still use old `person01–28` pool |
| Profession selector (6 options) | ✅ | Applies +15 stat bonus |
| Starting city picker | ✅ | Clickable dots on `map_usa.bmp`; 7 cities; defaults to Las Vegas |
| Edit portrait (custom upload) | ❌ | Button present, no function yet |
| Cancel → lobby | ⚠️ | lobby.html exists but cancel not wired |

### lobby.html — Multiplayer Lobby
| Feature | Status | Notes |
|---|---|---|
| Portrait picker + profession selector | ✅ | Character creation before room join |
| Starting city picker | ✅ | Same map_usa.bmp dot UI as index.html |
| Create / Join Room | ✅ | 4-letter room code |
| Live player list | ✅ | Updates as players join/disconnect |
| Host Start Game | ✅ | Sends start_game; non-hosts see waiting message |

### main.html — Main Screen
| Feature | Status | Notes |
|---|---|---|
| HUD (day, cash, debt, daily costs) | ✅ | |
| Police Readiness meter | ✅ | Replaces old Wanted Level stars; 0–100 bar; `?` button opens explanation modal; decays 15/day |
| Wanted Level (hidden) | ✅ | Still tracked in `gs.wantedLevel`; used as heat multiplier in crime scenes |
| Character portrait + stats | ✅ | Portrait CSS fixed (`width/height 100%` on img); new portraits display correctly |
| Stat bars (8 stats) | ✅ | |
| Backpack grid (12 slots) | ✅ | |
| City map + location icons | ✅ | |
| Location click → panels | ✅ | steal / store / dealer / race all working |
| Vehicle panel dividers | ✅ | `<hr>` + label + grid wrapped in `margin-top:auto` block in all 3 panels |
| Active Team — crew portrait click | ✅ | Shows contact's full stats + backpack in left panel via `renderContactView()` |
| Jailed crew badge | ✅ | Greyscale portrait, red border, ⛓Xd overlay; not draggable while jailed |
| Jailed crew left panel | ✅ | Red "JAILED — X days remaining" banner; portrait greyscaled |
| Active Team drag-and-drop | ✅ | |
| Garage grid | ✅ | |
| Hideout panel | ✅ | |
| Skip day / fly buttons | ✅ | |
| MP WebSocket wiring | ✅ | steal_claim/ack/nack, day_advanced, pool_update, state_update, game_over, race_challenge |

### crime.html — Crime Scene
| Feature | Status | Notes |
|---|---|---|
| Scene setup / active team check | ✅ | Blocks if player at hideout with no crew |
| Location-aware activity menu | ✅ | Default action pre-selected on load |
| Police Readiness meter | ✅ | Loads from `gs.policeReadiness + 30`; saved back on all exits |
| Turn outcomes / skill checks | ✅ | Full `resolveAction()` — crew-aware; best actor by stat/tool/gun gate |
| Active team slots | ✅ | Crew portraits shown in slots 1–5; click shows `renderContactView()` |
| Yank Out motorcycle/ATV bonus | ✅ | `vehicle.body` checked; –30 difficulty if motorcycle/ATV/moped/scooter |
| Skill gain on success | ✅ | |
| Drive-away sequence | ✅ | `startDriveAway()` → `resolveDriveAway()`: 3 heat tiers, driving roll, vehicle speed bonus; staggered log messages |
| Bust → jail crew | ✅ | All active crew jailed for `2 + floor(wantedLevel/2)` days |
| MP WebSocket wiring | ✅ | do_action, arrest, steal_success wired |
| GPS tracker foil sequence | ❌ | Not started |

### race.html — Race Scene
| Feature | Status | Notes |
|---|---|---|
| Full race loop | ✅ | resolveRaceTurn/Win/Loss |
| Win/loss vehicle transfer | ✅ | |
| MP WebSocket wiring | ❌ | race_challenge / race_turn not yet wired |

### arrested.html — Arrest Screen
| Feature | Status | Notes |
|---|---|---|
| Mugshot, charges, confiscated items | ✅ | |
| MP WebSocket wiring | ❌ | arrest_result navigation not confirmed |

---

## Game Logic

| System | Status | Notes |
|---|---|---|
| Player stats + profession bonus | ✅ | |
| Turn-based crime resolution | ✅ | `resolveAction()` — crew-aware via `getBestActor()`; best stat/tool/gun gate across player + active crew |
| Police Readiness | ✅ | `gs.policeReadiness` (0–100); rises in crime scenes (+30 on entry); decays 15/day; persists across screens |
| Wanted Level | ✅ | `gs.wantedLevel` (0–5 stars); heat multiplier on police rise per turn |
| Drive-away sequence | ✅ | `resolveDriveAway()` in game.js; 3 tiers by heat; driving skill + vehicle speed factor |
| Cash / debt / daily costs | ✅ | |
| Inventory / items / backpack | ✅ | |
| Vehicle pool per location | ✅ | |
| Active vehicles | ✅ | |
| Arrest system | ✅ | Fine + seizure + wanted bump |
| Jailed contacts | ✅ | `jailContact()` helper; `advanceDay()` ticks down `jailDays`; auto-returns to `'hired'`; release logged in day message |
| Store (in-panel) | ✅ | |
| Car dealer (in-panel) | ✅ | |
| Racing | ✅ | |
| Party / contacts system | ✅ | Full stats + backpack shown in left panel when portrait clicked |
| Hideout / garage management | ✅ | |
| Bank | ⚠️ | Account tab ✅; Loan tab stub; Rob tab ✅ (full heist sequence in crime.html) |
| Pawn shop | ❌ | Not started |
| City travel | ✅ | |
| Win condition | ⚠️ | Travel ✅; end game trigger TBD |

---

## Multiplayer

| Feature | Status | Notes |
|---|---|---|
| server.js + logic.js | ✅ | |
| Deployment (GitHub Pages + Railway) | ✅ | Live and reachable |
| index.html (room browser/create) | ✅ | |
| Auth flow | ✅ | |
| Room create/join/start | ✅ | Two players tested successfully |
| Shared city map / location pools | ✅ | Server owns pools; `game.html` reads from `sessionStorage` on load; `reconnected` handler re-applies server pools on page refresh |
| Shared day timer | ⚠️ | Timer exists in server.js but day advancement not pushing to clients reliably |
| crime.html wiring | ✅ | do_action, arrest, steal_success wired |
| steal_claim conflict resolution | ⚠️ | pendingClaims exists in server but not fully tested |
| race.html wiring | ❌ | race_challenge / race_turn not yet wired |
| arrested.html wiring | ❌ | arrest_result navigation not confirmed |
| store buy_item message | ❌ | |
| sell_vehicle message | ❌ | |
| End-to-end testing | ⚠️ | Room start works; gameplay sync not tested |

---

## Assets

| Asset group | Status | Notes |
|---|---|---|
| Player portraits | ✅ | 18 PNGs in `Graphics/portraits/` — portraits 7–18 sliced from sheets by `slice_portraits.py` |
| Contact portraits | ✅ | `person01–28.bmp` — used by `generateContact()` only |
| City maps | ✅ | city01–07.bmp |
| Car images + sprite strips | ✅ | CAR01–107.BMP; pixel_cars/cars##.png |
| Map icon sprites | ✅ | 17 individual PNGs in `Graphics/map_icons/` sliced from mapgroups01–02.bmp by `slice_mapicons.py` |
| Crime scene backgrounds | ✅ | house01–60, HIGHWAY, bank01–10, store01–10 |
| Action button sprites | ✅ | activities.bmp (14 buttons) |
| Store/tool items | ✅ | STOOL01–44, TOOL01–44 |
| NPC portraits | ✅ | enemy, gang, dealer, crowd sets |
| UI background texture | ✅ | background.bmp |

---

## Known Bugs

| # | Area | Description |
|---|---|---|
| 1 | `crime.html` | ~~Active team check missing~~ — **Fixed session 17** |
| 2 | `main.html` | ~~Can't drag vehicles to garage~~ — **Fixed session 16** |
| 3 | `main.html` | ~~Can't sell vehicles~~ — **Fixed session 16** |
| 4 | `main.html` | ~~Map location icons overlap~~ — **Fixed session 16** |
| 5 | `main.html` | ~~Garage sell bug~~ — **Fixed session 17** |
| 6 | `styles.css` | ~~Player portrait blank in main.html with new portraits~~ — **Fixed session 18** (`width/height 100%` added to `.char-portrait img`) |

---

## Backlog / To-Do

- **Shared city map / location pools** — highest priority; server needs to own location pool state and push it to all clients on game start and after each steal
- **Shared day timer** — verify `day_advanced` message is reaching clients and updating HUD
- race.html and arrested.html MP WebSocket wiring
- store buy_item and sell_vehicle server messages
- steal_claim conflict resolution end-to-end testing
- Bank MP wiring — `bank_leave`/`bank_success` not yet handled in server or `mpHandleMsg`
- Bank loan tab (stub)
- Pawn shop not started
- Win condition (end game trigger) — design TBD
- GPS tracker foil sequence in crime.html
- Phase 2 — Drug Dealing (backend done; UI partial)
- Phase 3 — Prostitution
- Phase 4 — Polish (rename Acting → Charisma; wanted star redesign)
- BMP → PNG conversion for production
