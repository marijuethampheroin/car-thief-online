# Car Thief Online — Classic Mode Overview

Classic mode is the single-player version of Car Thief Online. The player
starts with $500 cash, $10,000 debt, and a chosen profession. The goal is
to earn money, pay off the debt, and avoid accumulating too many arrests.
All state lives in sessionStorage and is managed entirely on the client.

---

## File Map

| File | Role |
|------|------|
| classic.html | New game setup (name, portrait, profession, starting city) |
| main.html | Core game hub — map, HUD, all panels and sub-renderers |
| classic_crime.html | Turn-based crime scene (steal / hijack / bank rob) |
| classic_arrested.html | Post-arrest summary screen |
| classic_airport.html | Fly to another city ($500) |
| classic_drive.html | Drive to another city (free, requires active vehicle) |
| classic_race.html | Street race scene (turn-based, vehicle vs vehicle) |
| game.js | All game logic, data, state init/load/save |

---

## Game Flow

```
classic.html
  └─ initState() → sessionStorage
       └─ main.html  (hub — all roads lead back here)
            ├─ classic_crime.html  → classic_arrested.html (if busted)
            ├─ classic_race.html
            ├─ classic_airport.html
            └─ classic_drive.html
```

---

## State (game.js — initState / loadState / saveState)

The full game state is a single JS object serialized to sessionStorage under
the key `gameState`. Key fields:

| Field | Type | Notes |
|-------|------|-------|
| playerName | string | Set at new game |
| portraitSrc | string | Path to portrait image |
| profession | string | One of 6 profession keys |
| stats | object | health, disguise, acting, shooting, hiding, driving, locksmithing, electronics — each { label, val, max } |
| cash | number | Current liquid cash |
| debt | number | Loan-shark debt (starts $10,000) |
| bankBalance | number | Money in bank (earns 0.5%/day interest) |
| bankLoan | number | Bank loan balance (system in development) |
| day | number | Current in-game day |
| wantedLevel | number | 0–3 priors stars |
| policeReadiness | number | 0–100; rises during crimes, decays 15/day |
| arrests | number | Total arrest count |
| crimesCommitted | number | Total crime scene entries |
| inventory | array | Up to 12 items; player backpack |
| activeVehicles | array | [primary, secondary] — vehicles on active team |
| garage | array | Stored vehicles (up to 6) |
| dealerLot | array | Vehicles sold to dealer; can be bought back at +10% |
| vehicleStorage | array | 6-slot shared item stash (right panel) |
| contacts | array | All known contacts (available / hired / jailed) |
| currentCity | string | City id (e.g. 'las_vegas') |
| cities | object | Per-city location + pool data |
| locationPools | object | { locId: [vehicle, ...] } persistent stealable pools |
| dealerNPCs | array | One drug dealer NPC per city |
| drugDealing | array | Active dealing assignments |
| shopStock | array | Item indices in current shop rotation |
| currentRace | object | Active race data (null when not racing) |
| itemDragSwap | boolean | false=move, true=swap for item drag |
| playerAtHideout | boolean | Whether player is assigned to hideout |

---

## Professions

Six professions, each granting +15 to one starting stat:

| Profession | Stat bonus |
|-----------|-----------|
| Actor | Acting |
| Shooter | Shooting |
| Thief | Hiding |
| Driver | Driving |
| Locksmith | Locksmithing |
| Electrician | Electronics |

Base starting stats (before bonus): Acting 12, Shooting 10, Hiding 18,
Driving 11, Locksmithing 20, Electronics 22. Health and Disguise always
start at 100.

---

## Cities

7 playable cities (Las Vegas, Los Angeles, Kansas City, Houston, Miami,
Boston, Philadelphia). Each has its own map image (city01–07.bmp) and a
unique set of location icons generated at game start. The player starts in
the chosen city and can travel via airport ($500) or drive (free, requires
active vehicle).

Travelling does NOT reset the day or police readiness.

---

## Map Locations (per city)

Locations are generated once per city via initCities() and stored in
gs.cities. Fixed locations (shop, dealer, bank, airport) always appear
exactly once. Dynamic locations (highways, residential, busy streets,
racing areas) are rolled within min/max counts and placed using zone
constraints to avoid clustering.

| Type | Icon | Count | Notes |
|------|------|-------|-------|
| Highway | Sheet1[1] | 1–3 | Hijack — confrontational |
| Residential | Sheet1[4] | 2–5 | Quiet steal |
| Busy Street | Sheet1[3] | 1–4 | Steal, higher police rise |
| Racing Area | Sheet1[2] | 0–2 | Steal during race event |
| Shop | Sheet1[6] | 1 (fixed) | Buy tools/equipment |
| Car Park / Dealer | Sheet1[0] | 1 (fixed) | Sell vehicles |
| Bank | Sheet1[5] | 1 (fixed) | Rob for cash |
| Airport | Sheet2[5] | 1 (fixed) | Travel hub |
| Drug Dealer NPC | Sheet2[6] | 0–1 | Buy drug packages |

Dynamic locations have a lifespan (days). When they expire, advanceCityLocations()
removes them and replaces them with new ones. Fixed locations never expire.

---

## Vehicle Pools

Each stealable location has a persistent pool of 3–5 vehicles stored in
gs.locationPools[locId]. Pools are generated by initLocationPools() on first
visit and refreshed on day advance via refreshLocationPools().

Vehicle selection by location type:
- Highway: all non-trucks
- Residential: non-moto, non-truck, price ≤ $40,000
- Busy: non-moto, non-truck (any price)
- Racing: isRaceWorthy, non-moto, non-truck

108 vehicles in VEHICLES_DATA (game.js). Each instance gets a uid, condition
(30–95), sprite sheet coordinates, and a spec string.

Sell price = price × (condition / 100). Dealer buy-back = sell price × 1.10.

---

## Crime Scene (classic_crime.html)

Turn-based. Each turn the player selects an action; hitting "Turn" calls
resolveAction() → result applied → police meter updated → action bar rebuilt.

### Core mechanic — rollCheck()

```
chance = clamp(playerStat - vehicleDefense, 5, 95)
roll   = random 1–100
pass   = roll <= chance
```

### Actor selection — getBestActor()

Before each roll the game picks the best team member for the job:
- Selects from player + all unassigned hired crew
- If a tool type is required (e.g. 'pick'), highest tool bonus wins; falls
  back to highest stat if nobody has the tool
- If a gun is required (show_your_gun, bank_announce, etc.), only armed
  candidates qualify; returns null if nobody is armed
- Player wins ties (listed first in candidate array)

### Scene types and action flows

**Residential / Busy Street (covert steal):**
Case Area → pick/slim jim/pump wedge/smash window (door open)
→ disable alarm if triggered → hotwire / pick ignition (engine started)
→ check/skip GPS → Get in Vehicle → drive-away roll

**Highway (hijack):**
Approach Driver → ask to leave / show gun / demand keys / force out / shoot
→ GPS check → Get in Vehicle → drive-away roll

**Racing Area (racing steal):**
Distract Owner → door entry (same as covert) → engine start → GPS → Get in

**Bank robbery:**
Give note / Announce (requires gun) → Demand teller cash ($1,500–$8,000)
→ Find manager → Lead to vault → Demand vault open → Fill bags ($500–$2,000
each, 2–4 bags) → Leave

### Police readiness

Starts at gs.policeReadiness + 20 on scene entry. Each action adds
policeRise × (1 + wantedLevel × 0.1). Reaches 100 → instant bust.
At 60+ the police patrol section becomes visible.

### Drive-away (resolveDriveAway)

Called on success. Uses best driving stat on team + vehicle speed bonus
(+1 per 5 speed above 60).

| Police level | Outcome |
|-------------|---------|
| < 55 | Clean escape, no roll |
| 55–69 | Pursuit — driving roll vs difficulty 5 |
| 70+ | Heavy pursuit — driving roll vs difficulty 15 |

### Skill gains

Passing certain rolls grants +1 to the relevant skill:
case_the_area → hiding, lockpick_door → locksmithing, distract_owner → acting,
bank_give_note → acting, bank_announce → shooting, etc.

### Bust consequences (applyArrestPenalties)

Fine levied; if cash insufficient, remainder added to debt. Some inventory
items seized. wantedLevel incremented (capped at 3). Active crew jailed for
2 + floor(wantedLevel/2) days.

---

## Day Advance (advanceDay)

Triggered by the skip-day button in main.html.

1. day += 1
2. Deduct daily crew costs from cash
3. Apply bank interest (0.5% on bankBalance, floored)
4. Police readiness decays by 15 (min 0)
5. Refresh stealable location vehicle pools
6. Advance city location lifespans (remove expired, add new)
7. Regenerate shop stock
8. Resolve drug dealing income for all assigned contacts
9. Reset casinoWinnings to 0
10. 25% chance a new contact becomes available
11. Tick down jailed crew (release at 0 days)

---

## Crew / Contacts

Contacts are generated by generateContact() and stored in gs.contacts.
Each has a name, portrait (person01–28.png), profession, tier, stats,
inventory, and pay rate.

Tiers: Novice (stats 8–22), Skilled (20–45), Expert (40–70).
Pay rates: Novice $15–35/day, Skilled $35–65/day, Expert $60–100/day.

Status lifecycle: available → hired → jailed → hired (on release)

Active team: player + up to 3 hired crew (not assigned to hideout or dealing).
Hideout: player and/or crew can be stashed here; they don't participate in
crimes but still draw daily pay.
Dealing assignment: crew (or player) can be assigned to a location to deal
drugs overnight (see Drug Dealing below).

---

## Items & Shop

Items defined in ITEMS_DATA (game.js). Categories:

| Category | Crime use |
|----------|-----------|
| lock_pick | lockpick_door |
| wiring | disable_alarm, hotwire_engine |
| cutting | smash_window |
| weapon | show_your_gun, bank_announce |
| armor | (passive, no direct action) |
| navigation | (no direct action) |
| other | varies |
| drug | drug dealing income |

Shop stock is 15–20 items, weighted toward cheaper items, refreshed each day.
Player right-clicks a backpack slot to sell items to a fence at sell price.

Tool bonus system: lock pick tools add 5–30 to locksmithing rolls; wiring
tools add 5–20 to electronics rolls. getBestActor() selects the team member
with the best tool for each action.

---

## Bank

- Deposit / withdraw cash ↔ bankBalance
- Interest: 0.5%/day on bankBalance (floored, applied on day advance)
- Rob the bank: treated as a crime scene of type 'bank'
- Bank loan system: planned, not yet implemented

---

## Street Racing (classic_race.html)

The player bets their primary active vehicle against an opponent's vehicle.
Win → gain opponent's vehicle (goes to garage). Lose → lose primary vehicle
(25% chance it ends up in dealer lot).

Turn-based. Each turn calls resolveRaceTurn():
- Player and opponent each roll a speed-based distance gain + randomness
- Checkpoints passed grant +1 driving skill
- Police awareness rises each turn
- First to reach RACE_TOTAL_DIST wins; player wins ties

---

## Drug Dealing

Crew (or player) can be assigned to a location via the Contacts → Assign tab.
Each day advance runs resolveDealingIncome():
- ~50% chance each drug package sells per night
- Income = sellMid × charmMod (based on acting) × groupBonus × rngMod
- Solo dealers risk robbery (loses all drugs, no income)
- Group dealers get income bonus but higher arrest risk
- Arrest → contact jailed; robbery → drugs lost

---

## Known Issues / To-Do

See status - classic.md for the current issue list and change log.
