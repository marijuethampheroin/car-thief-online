# Car Thief Online — Project Structure & Assets
_Last updated: 2026-05-10 (session 24)_

---

## Source Files

| File | Role |
|---|---|
| `start.html` | Unified entry point — Browse/Create/Solo tabs, live room list, auto-join via `?join=CODE` |
| `index.html` | Legacy solo start screen (still functional) |
| `lobby.html` | Legacy multiplayer lobby (still functional) |
| `main.html` | Singleplayer main screen — HUD, city map, panels, contacts modal, vehicle storage, item drag+drop |
| `game.html` | Multiplayer main screen (renamed from `main_v2.html`) |
| `crime.html` | Crime scene — dynamic action bar, sceneState flags, drive-away sequence, police readiness |
| `race.html` | Race scene — turn-based, pink-slip stakes |
| `arrested.html` | Arrest screen — mugshot, charges, confiscation list |
| `drive.html` | Drive-to-city screen |
| `airport.html` | Fly-to-city screen — USA map picker, $500 fare |
| `auth.html` | Firebase login / register / forgot password; `?then` + `?join` redirect passthrough |
| `leaderboard.html` | Firestore top-20 leaderboard (best score / total earnings / games played) |
| `styles.css` | Shared stylesheet |
| `styles_v2.css` | Multiplayer/modern theme stylesheet (`game.html`) |
| `game.js` | Client-side state + all game logic |
| `logic.js` | Server-side mirror of game logic (no DOM) |
| `server.js` | Node.js + WebSocket multiplayer backend; room management, day timer, room list push |
| `items.json` | 54 item definitions (indices 1–44 tools/weapons/armor, 45–54 drug packages) |
| `vehicles.json` | 125 vehicle definitions (name, body, stats, imgIdx) |
| `package.json` | Node dependencies (ws, firebase-admin) |
| `sw.js` | Service worker (PWA offline support) |
| `manifest.json` | PWA manifest |

---

## Active Graphics — Referenced in Code

### UI / Backgrounds
| Path | Used by |
|---|---|
| `Graphics/UI_elements/background.bmp` | start.html, index.html, lobby.html, main.html (panel bg) |
| `Graphics/UI_elements/background_crime.bmp` | crime.html (window bg) |
| `Graphics/UI_elements/city01–07.bmp` | main.html (`applyCityMap`) |
| `Graphics/UI_elements/HIGHWAY.BMP` | crime.html (highway scene bg) |
| `Graphics/UI_elements/activities.bmp` | crime.html (action button sprite strip, 14 buttons) |
| `Graphics/UI_elements/map_usa.bmp` | start.html, index.html, lobby.html, airport.html (city picker) |
| `Graphics/UI_elements/mapgroups01.bmp` | Source sheet — sliced into `Graphics/map_icons/` by `slice_mapicons.py` |
| `Graphics/UI_elements/mapgroups02.bmp` | Source sheet — sliced into `Graphics/map_icons/` by `slice_mapicons.py` |
| `Graphics/houses01.png` | crime.html (residential scene bg) |
| `Graphics/houses02.png` | crime.html (residential scene bg) |
| `Graphics/pixel_ui/mapgroups01.png` | main.html (sprite icons, alternate path) |
| `Graphics/pixel_ui/mapgroups02.png` | main.html (sprite icons, alternate path) |

### Portraits
| Path | Used by |
|---|---|
| `Graphics/portraits/portrait_1–18.png` | start.html, index.html, lobby.html (player portrait picker); portraits 7–18 sliced from sheets by `slice_portraits.py` |
| `Graphics/character_portraits_full/person01–28.png` | game.js (`generateContact`), contacts modal; converted from BMP by `convert_portraits.py` |

### Vehicles
| Path | Used by |
|---|---|
| `Graphics/pixel_cars/cars01–13.png` | game.js / logic.js / server.js (`_enrichVehicle`); main.html garage/team/storage slots; race.html |

### Items
| Path | Used by |
|---|---|
| `Graphics/items_medium/STOOL01–44.bmp` | main.html backpack/store grid, arrested.html confiscation list |
| `Graphics/items_full/TOOL01–44.png` | main.html store panel (selected item detail view) |

### Drugs
| Path | Used by |
|---|---|
| `Graphics/drugs/weed_small.png`, `weed_large.png` | main.html dealer panel inventory |
| `Graphics/drugs/cocaine_small.png`, `cocaine_large.png` | main.html dealer panel inventory |
| `Graphics/drugs/ecstasy_small.png`, `ecstasy_large.png` | main.html dealer panel inventory |
| `Graphics/drugs/shrooms_small.png`, `shrooms_large.png` | main.html dealer panel inventory |
| `Graphics/drugs/heroin_small.png` | main.html dealer panel inventory |

### NPC Portraits
| Path | Used by |
|---|---|
| `Graphics/dealers/dealer01–07.png` | main.html (dealer NPC portraits) |

### Map Icons
| Path | Used by |
|---|---|
| `Graphics/map_icons/icon_01_00–09.png` | game.html (`spriteIcon()`) — sheet 1: Car Park, Highway, Racing, Busy Street, Residential, Bank, Shop, Gang, Lender, Doctor |
| `Graphics/map_icons/icon_02_00–06.png` | game.html (`spriteIcon()`) — sheet 2: Skill Trainer, Pawnshop, Hideout, Mechanic, Police/Bribe, Airport, Informer |
| _Source: sliced from `mapgroups01/02.bmp` by `slice_mapicons.py`_ | |

---

## Data Shape Reference

### gameState (gs)
```js
{
  playerName, portraitSrc, profession,
  stats: { health, disguise, acting, shooting, hiding, driving, locksmithing, electronics },
  cash, debt, dailyCosts,
  day,
  wantedLevel,       // 0–3 (displayed as "Priors" — 3 brown circles)
  policeReadiness,   // 0–100; rises in crime scenes, decays 15/day
  arrests, crimesCommitted,
  inventory: [],     // max 12 slots
  activeVehicles: [], // max 2: [primary, secondary]
  vehicleStorage: [], // 6-slot right-panel vehicle storage
  garage: [],
  dealerLot: [],
  shopStock: [],
  contacts: [],      // all contacts — filter by .status
  dealerNPCs: [],    // 7 persistent city dealer NPCs (one per city)
  drugDealing: [],   // assignment records { contactId, locId, role }
  casinoWinnings: 0, // daily cap tracker
  currentRace: null,
  bankBalance, bankLoan,
  currentCity,
  cities: {},
  locationPools: {},
  playerAtHideout: false,
  itemDragSwap: false,
  pendingTrackerCheck: false,
}
```

### Contact object
```js
{
  id, name, portrait,
  profession,
  tierLabel,         // 'novice' | 'skilled' | 'expert'
  stats: { ...same 8 as player... },
  inventory: [],
  payType,           // 'daily' | 'share'
  payAmount,
  status,            // 'available' | 'hired' | 'jailed' | 'prison'
  jailDays,          // countdown; auto-returns to 'hired' at 0
  strikes,           // cumulative arrest count; 3 = prison
  assignedLocation,  // location id or null (= active team)
}
```

### Vehicle object
```js
{
  uid,
  name, body, seats, engine,
  speed, lockDef, elecDef, price,
  isMoto, isTruck, isRaceWorthy,
  imgIdx,            // 1-based; determines pixel_cars sheet + frameX
  img,               // e.g. 'Graphics/pixel_cars/cars02.png'
  frameX,            // CSS background-position-x (64px per frame)
  condition,         // 30–95
  spec,              // display string
  locId,             // location it was generated at
}
```

### Dealer NPC object
```js
{
  id, name, city,
  portrait,          // e.g. 'Graphics/dealers/dealer01.png'
  favor,             // 0–100 (Cold / Neutral / Friendly / Trusted)
}
```

### Room object (server-side)
```js
{
  code, hostId,
  roomName,          // up to 20 chars
  isPublic,          // boolean; false = private (not in room list)
  started,
  day, dayTimer,
  players:      Map<id, { ws, name, portraitSrc, profession, connected, uid }>,
  playerStates: Map<id, gameState>,
  locationPools: {},
  locDefs: [],
  pendingClaims: {},
  pendingRace: null,
}
```

---

## Key Constants (game.js)

| Constant | Value | Notes |
|---|---|---|
| `CITIES` | 7 entries | Las Vegas, Los Angeles, Kansas City, Houston, Miami, Boston, Philadelphia |
| `CITY_LOCATION_TEMPLATES` | ~10 types | highway, residential, busy, racing, bank, airport, store, dealer_npc, etc. |
| `DEALER_NPC_POOL` | 7 entries | One named dealer per city; ENEMY01–07 portraits |
| `RACE_TOTAL_DIST` | 100 | Race distance units |
| `RACE_CHECKPOINTS` | [33, 66] | +1 Driving on pass |
| Police readiness decay | 15/day | Applied in `advanceDay()` |
| Police readiness crime entry | +30 | Applied on entering crime.html |
| Jail duration | `2 + floor(wantedLevel/2)` days | Applied on bust |
| Contact three-strike prison | 3 arrests | `strikes` field on contact |
| Garage cap | 12 | `gs.garage` array |
| Vehicle storage cap | 6 | `gs.vehicleStorage` array |
| Backpack cap | 12 | `gs.inventory` array |
| Shop stock size | 15–20 items | Refreshed daily |
| Day duration (server) | 5 minutes | `DAY_DURATION` in server.js |
