// =============================================================================
// game.js — Car Thief Online
// Central game state and logic layer.
//
// Currently uses sessionStorage as a single-player stub.
// TODO (MULTIPLAYER): Replace load/save with WebSocket send/receive.
//   - initState()   → send "join" message to server; receive authoritative state
//   - saveState()   → send "update" message to server
//   - loadState()   → receive state broadcast from server
//   All game logic (skill checks, day advance) will move to server.js.
//   Client becomes a thin renderer + input forwarder.
// =============================================================================

'use strict';

// Suppress browser context menu game-wide
document.addEventListener('contextmenu', e => e.preventDefault());

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------
const STARTING_CASH        = 500;
const STARTING_DEBT        = 10000;
const PROFESSION_BONUS_AMT = 15;

const PROFESSION_STAT = {
  actor:       'acting',
  shooter:     'shooting',
  thief:       'hiding',
  driver:      'driving',
  locksmith:   'locksmithing',
  electrician: 'electronics',
};

// ---------------------------------------------------------------------------
// CITIES
// ---------------------------------------------------------------------------

/**
 * The 7 playable cities, matching city01–07.bmp map images.
 * dotX/dotY are percentage positions on map_usa.png for the city picker.
 * Sprite icon for the airport uses sheet2 idx5 (same as existing airport icon).
 */
const CITIES = [
  { id:'las_vegas',    name:'Las Vegas, NV',    mapImg:1, dotX:17, dotY:55 },
  { id:'los_angeles',  name:'Los Angeles, CA',  mapImg:2, dotX:13, dotY:63 },
  { id:'kansas_city',  name:'Kansas City, MO',  mapImg:3, dotX:51, dotY:48 },
  { id:'houston',      name:'Houston, TX',      mapImg:4, dotX:47, dotY:73 },
  { id:'miami',        name:'Miami, FL',        mapImg:5, dotX:66, dotY:80 },
  { id:'boston',       name:'Boston, MA',       mapImg:6, dotX:79, dotY:30 },
  { id:'philadelphia', name:'Philadelphia, PA', mapImg:7, dotX:74, dotY:38 },
];

/**
 * Per-type location rules.
 * min/max: how many of this type a city can have (rolled at game start).
 * zones: array of {x:[min,max], y:[min,max]} regions (% of map) where icons
 *        of this type may be placed. Prevents all icons clustering in one spot.
 * fixed: if true, always exactly 1, no lifespan turnover.
 * si: sprite sheet icon [sheet, index] — same values used in main.html.
 * label/descFn: used when building the icon array for main.html.
 */
const CITY_LOCATION_TEMPLATES = {
  highway: {
    min:1, max:3, fixed:false,
    si:[1,1], label:'Highway',
    desc:'Hijack a vehicle from a driver (confrontation).',
    zones:[{x:[55,90],y:[10,40]},{x:[60,95],y:[45,70]}],
  },
  residential: {
    min:2, max:5, fixed:false,
    si:[1,4], label:'Residential Area',
    desc:'Steal a parked vehicle quietly.',
    zones:[{x:[10,45],y:[20,50]},{x:[40,75],y:[50,80]},{x:[15,55],y:[55,85]}],
  },
  busy: {
    min:1, max:4, fixed:false,
    si:[1,3], label:'Busy Street',
    desc:'Steal a parked vehicle. High risk — lots of witnesses.',
    zones:[{x:[35,70],y:[25,55]},{x:[20,60],y:[55,80]},{x:[60,90],y:[30,65]}],
  },
  racing: {
    min:0, max:2, fixed:false,
    si:[1,2], label:'Racing Area',
    desc:'Steal a vehicle during or after a race event.',
    zones:[{x:[15,45],y:[60,85]},{x:[70,92],y:[55,80]}],
  },
  shop:   { min:1, max:1, fixed:true,  si:[1,6], label:'Shop',        desc:'Buy equipment and tools.',        zones:[{x:[40,65],y:[35,60]}] },
  dealer: { min:1, max:1, fixed:true,  si:[1,0], label:'Car Park',    desc:'Sell stolen vehicles.',           zones:[{x:[15,40],y:[45,70]}] },
  bank:   { min:1, max:1, fixed:true,  si:[1,5], label:'Bank',        desc:'Rob the bank.',                   zones:[{x:[55,80],y:[40,65]}] },
  airport:    { min:1, max:1, fixed:true,  si:[2,5], label:'Airport',     desc:'Fly to another city or end the game.', zones:[{x:[30,60],y:[70,90]}] },
  dealer_npc: { min:0, max:1, fixed:false, si:[2,6], label:'Drug Dealer', desc:'Buy drug packages from a street contact.', zones:[{x:[20,80],y:[20,80]}] },
};

// ---------------------------------------------------------------------------
// PARTY / CONTACTS
// ---------------------------------------------------------------------------

const CONTACT_NAMES = [
  'Aaron','Adam','Alex','Andre','Angelo','Anthony','Anton','Armando',
  'Barry','Ben','Billy','Bobby','Brandon','Brian','Bruno',
  'Calvin','Carlos','Charlie','Chris','Cole','Connor',
  'Dana','Danny','Darren','David','Dean','Derek','Diego','Dominic','Donnie',
  'Eddie','Eli','Eric','Ethan',
  'Felix','Frankie','Fred',
  'Gary','George','Glen','Greg',
  'Hank','Harry','Henry','Hugo',
  'Ivan',
  'Jack','Jake','James','Jason','Jesse','Jimmy','Joe','John','Jon','Jorge','Jose','Josh','Julian',
  'Karl','Keith','Ken','Kevin','Kyle',
  'Lance','Larry','Lee','Leon','Lewis','Luis','Luke',
  'Marco','Marcus','Mario','Mark','Matt','Max','Michael','Miguel','Mike','Miles',
  'Nathan','Neil','Nick','Noah',
  'Omar','Oscar','Owen',
  'Pablo','Pat','Paul','Pete','Phil',
  'Ramon','Randy','Ray','Ricardo','Rick','Rob','Roland','Ron','Roy','Ruben','Ryan',
  'Sam','Scott','Sean','Sergio','Shane','Simon','Stan','Steve',
  'Terry','Tim','Todd','Tom','Tony','Travis','Trevor','Tyler',
  'Victor','Vince',
  'Walter','Wayne','Wesley','Will',
  'Xavier',
  'Zack',
];

const CONTACT_TIER_RANGES = {
  novice:  { min: 8,  max: 22 },
  skilled: { min: 20, max: 45 },
  expert:  { min: 40, max: 70 },
};

/**
 * computeDailyCosts(state)
 * Returns the current total daily costs: sum of daily-pay party members only.
 * Share-pay members are deducted at point of income instead.
 */
function computeDailyCosts(state) {
  if (!state.contacts) return 0;
  return state.contacts
    .filter(c => c.status === 'hired' && c.payType === 'daily')
    .reduce((sum, c) => sum + (c.payAmount || 0), 0);
}

/**
 * generateContact(state)
 * Creates one new hireable contact and pushes it into state.contacts.
 * Portrait is random from person01–28.bmp, optionally excluding the player's.
 */
function generateContact(state) {
  const playerPortrait = state.portraitSrc || '';
  // Build portrait pool — exclude player's portrait if trivially parseable
  const allPortraits = Array.from({length: 28}, (_, i) =>
    `Graphics/character_portraits_full/person${String(i+1).padStart(2,'0')}.png`
  );
  const pool = allPortraits.filter(p => !playerPortrait.includes(p.split('/').pop()));
  const portrait = pool[Math.floor(Math.random() * pool.length)];

  const name = CONTACT_NAMES[Math.floor(Math.random() * CONTACT_NAMES.length)];
  const professions = Object.keys(PROFESSION_STAT);
  const profession  = professions[Math.floor(Math.random() * professions.length)];
  const tiers       = ['novice', 'skilled', 'expert'];
  const tierWeights = [0.5, 0.35, 0.15]; // novice most common
  const roll = Math.random();
  let tierLabel = 'novice';
  let acc = 0;
  for (let i = 0; i < tiers.length; i++) {
    acc += tierWeights[i];
    if (roll < acc) { tierLabel = tiers[i]; break; }
  }

  const range = CONTACT_TIER_RANGES[tierLabel];
  const randStat = () => Math.round(range.min + Math.random() * (range.max - range.min));

  const stats = {};
  for (const [key, s] of Object.entries(BASE_STATS)) {
    stats[key] = { label: s.label, val: randStat(), max: s.max };
  }
  // Clamp health/disguise to full (they aren't skill stats)
  stats.health.val  = 100;
  stats.disguise.val = 100;
  // Apply profession bonus
  const bonusStat = PROFESSION_STAT[profession];
  if (bonusStat && stats[bonusStat]) {
    stats[bonusStat].val = Math.min(stats[bonusStat].max, stats[bonusStat].val + PROFESSION_BONUS_AMT);
  }

  // Pay: daily rate scaled loosely to tier
  const payRanges = { novice: [15,35], skilled: [35,65], expert: [60,100] };
  const [pMin, pMax] = payRanges[tierLabel];
  const payAmount = Math.round(pMin + Math.random() * (pMax - pMin));

  const id = 'contact_' + Math.random().toString(36).slice(2, 9);

  const contact = {
    id,
    name,
    portrait,
    profession,
    tierLabel,
    stats,
    inventory: [],
    payType: 'daily',
    payAmount,
    status: 'available',
    assignedLocation: null,
    strikes: 0,   // cumulative arrest count; 3 = prison (Phase 2)
  };

  if (!state.contacts) state.contacts = [];
  state.contacts.push(contact);
  return contact;
}

/**
 * hireContact(state, contactId)
 * Flips a contact's status to 'hired'. Contact stays in contacts[].
 * Returns { ok, msg }.
 */
function hireContact(state, contactId) {
  const c = (state.contacts || []).find(c => c.id === contactId);
  if (!c) return { ok: false, msg: 'Contact not found.' };
  if (c.status !== 'available') return { ok: false, msg: `${c.name} is not available.` };
  c.status = 'hired';
  saveState(state);
  return { ok: true, msg: `${c.name} joined your crew.` };
}

// Base stat values before profession bonus
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

/**
 * assignToHideout(state, contactId)
 * Moves a hired crew member to the hideout.
 * Sets assignedLocation = 'hideout'; removes them from active team slots.
 * Returns { ok, msg }.
 */
function assignToHideout(state, contactId) {
  const c = (state.contacts || []).find(c => c.id === contactId);
  if (!c) return { ok: false, msg: 'Contact not found.' };
  if (c.status !== 'hired') return { ok: false, msg: `${c.name} is not hired.` };
  if (c.assignedLocation === 'hideout') return { ok: false, msg: `${c.name} is already at the hideout.` };
  c.assignedLocation = 'hideout';
  saveState(state);
  return { ok: true, msg: `${c.name} sent to hideout.` };
}

/**
 * jailContact(state, contactId, days)
 * Puts a hired crew member in jail for `days` days.
 * Sets status:'jailed', jailDays, clears them from active team slots.
 */
function jailContact(state, contactId, days) {
  const c = (state.contacts || []).find(c => c.id === contactId);
  if (!c) return;
  c.status   = 'jailed';
  c.jailDays = days || 3;
  // Remove from active team so the slot is freed
  state.activeTeam = (state.activeTeam || []).filter(id => id !== contactId);
}

/**
 * recallFromHideout(state, contactId)
 * Recalls a crew member from the hideout back to the active team.
 * Enforces 3-crew cap (player excluded).
 * Returns { ok, msg }.
 */
function recallFromHideout(state, contactId) {
  const c = (state.contacts || []).find(c => c.id === contactId);
  if (!c) return { ok: false, msg: 'Contact not found.' };
  if (c.assignedLocation !== 'hideout') return { ok: false, msg: `${c.name} is not at the hideout.` };
  const activeCrew = (state.contacts || []).filter(x => x.status === 'hired' && !x.assignedLocation).length;
  if (activeCrew >= 3) return { ok: false, msg: `Active team is full (3 crew max). Send someone to the hideout first.` };
  c.assignedLocation = null;
  saveState(state);
  return { ok: true, msg: `${c.name} recalled to active team.` };
}

// ---------------------------------------------------------------------------
// STATE — init / load / save
// ---------------------------------------------------------------------------

/**
 * initState(profession)
 * Called once from index.html on new game start.
 * Creates a fresh game state and persists it.
 */
function initState(profession, startCityId) {
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
    playerName:  sessionStorage.getItem('playerName') || 'Player',
    portraitSrc: sessionStorage.getItem('portraitSrc') || '',
    profession,
    stats,
    cash:        STARTING_CASH,
    debt:        STARTING_DEBT,
    dailyCosts:  0,   // starts at $0; grows as party members are hired
    contacts:    [],  // all known contacts (available, hired, jailed, prison)
    day:         1,
    wantedLevel: 0,
    policeReadiness: 0,   // 0–100; rises during crimes, decays each day
    inventory:   [                        // TODO: remove test items before release
      makeInventoryItem(21),             // Lock Pick Set
      makeInventoryItem(34),             // Wire Cutter
      makeInventoryItem(28),             // Glock 17
    ].filter(Boolean),  // backpack items
    activeVehicles: [],   // up to 2 vehicles in active team [primary, secondary]
    garage:        [],    // vehicles stored but not yet sold (up to 6)
    dealerLot:     [],    // vehicles sold to dealer; available for buy-back at +10%
    arrests:       0,
    crimesCommitted: 0,  // total crime attempts (incremented on each crime scene entry)
    shopStock:    [],
    currentRace:  null,
    bankBalance:   0,     // money deposited in bank (earns daily interest)
    bankLoan:      0,     // outstanding bank loan balance (separate from loan-shark debt)
    currentCity:  startCityId || 'las_vegas',
    cities:       {},
    dealerNPCs:    [],   // 7 persistent dealer NPCs — one per city; name, portrait, cityId, favor
    drugDealing:   [],   // assignment records: { contactId, locId, role: 'deal' | 'hoe' }
    casinoWinnings: 0,   // daily winnings tracker; reset each advanceDay (Phase bonus cap)
    vehicleStorage: new Array(6).fill(null),  // shared item stash (right panel top section)
    itemDragSwap:   false,                    // false = move, true = swap on item drag+drop
  };

  initCities(state);
  initDealerNPCs(state);
  initShopStock(state);
  saveState(state);
  return state;
}

/** saveState — persist to sessionStorage (stub for server sync) */
function saveState(state) {
  // TODO (MULTIPLAYER): ws.send(JSON.stringify({ type:'state_update', payload: state }));
  sessionStorage.setItem('gameState', JSON.stringify(state));
}

/** loadState — retrieve from sessionStorage (stub for server broadcast) */
function loadState() {
  // TODO (MULTIPLAYER): return last state received from server via ws.onmessage
  const raw = sessionStorage.getItem('gameState');
  return raw ? JSON.parse(raw) : null;
}

// ---------------------------------------------------------------------------
// DAY ADVANCE  (test-only stub; server controls this in multiplayer)
// ---------------------------------------------------------------------------

/**
 * advanceDay(state)
 * Deducts daily costs, increments day counter.
 * TODO (MULTIPLAYER): Remove — server advances the day for all players simultaneously.
 * @returns {object} { state, log } updated state + message for the log strip
 */
function advanceDay(state, locDefs) {
  state.day += 1;
  const costs = computeDailyCosts(state);
  state.dailyCosts = costs; // keep stored value in sync for MP/server use
  state.cash -= costs;
  applyBankInterest(state);
  // Police readiness decays 15 pts per day (heat cools down when lying low)
  state.policeReadiness = Math.max(0, (state.policeReadiness || 0) - 15);
  if (locDefs) refreshLocationPools(state, locDefs);
  if (locDefs) refreshHousePools(state, locDefs);
  advanceCityLocations(state);
  initShopStock(state);
  const dealLog = resolveDealingIncome(state);
  state.casinoWinnings = 0; // reset daily cap
  // ~25% chance a new contact becomes available each day
  if (Math.random() < 0.25) generateContact(state);
  // Tick down jailed contacts
  const released = [];
  (state.contacts || []).forEach(c => {
    if (c.status === 'jailed') {
      c.jailDays = Math.max(0, (c.jailDays || 1) - 1);
      if (c.jailDays === 0) { c.status = 'hired'; released.push(c.name); }
    }
  });
  const releaseMsg = released.length ? ' ' + released.map(n => `${n} is out of jail.`).join(' ') : '';
  const dealMsg    = dealLog.length   ? ' ' + dealLog.join(' ') : '';
  const msg = costs > 0
    ? `Day ${state.day} begins. Daily costs: -$${costs}. Cash: $${state.cash}.${releaseMsg}${dealMsg}`
    : `Day ${state.day} begins. Cash: $${state.cash}.${releaseMsg}${dealMsg}`;
  saveState(state);
  return { state, msg };
}

// ---------------------------------------------------------------------------
// BANK
// ---------------------------------------------------------------------------

const BANK_INTEREST_RATE = 0.005; // 0.5% daily on bankBalance

/**
 * applyBankInterest(state)
 * Called each day advance. Adds interest to bankBalance (floored to whole dollars).
 */
function applyBankInterest(state) {
  if (!state.bankBalance) return;
  const interest = Math.floor(state.bankBalance * BANK_INTEREST_RATE);
  if (interest > 0) state.bankBalance += interest;
}

/**
 * bankDeposit(state, amount)
 * Moves cash → bankBalance. Returns { ok, msg }.
 */
function bankDeposit(state, amount) {
  amount = Math.floor(amount);
  if (amount <= 0)         return { ok: false, msg: 'Invalid amount.' };
  if (amount > state.cash) return { ok: false, msg: "You don't have that much cash." };
  state.cash        -= amount;
  state.bankBalance += amount;
  saveState(state);
  return { ok: true, msg: `Deposited $${amount.toLocaleString()}. Balance: $${state.bankBalance.toLocaleString()}.` };
}

/**
 * bankWithdraw(state, amount)
 * Moves bankBalance → cash. Returns { ok, msg }.
 */
function bankWithdraw(state, amount) {
  amount = Math.floor(amount);
  if (amount <= 0)                return { ok: false, msg: 'Invalid amount.' };
  if (amount > state.bankBalance) return { ok: false, msg: 'Insufficient funds.' };
  state.bankBalance -= amount;
  state.cash        += amount;
  saveState(state);
  return { ok: true, msg: `Withdrew $${amount.toLocaleString()}. Balance: $${state.bankBalance.toLocaleString()}.` };
}

// ---------------------------------------------------------------------------
// SKILL CHECKS
// ---------------------------------------------------------------------------

/**
 * rollCheck(statVal, defenseStat)
 * Core % chance roll used for all skill-based crime actions.
 *
 * chance = playerStat - vehicleDefense, clamped to [5, 95]
 * Roll a d100 — pass if roll < chance.
 *
 * @param {number} statVal     — player's relevant stat (0–100)
 * @param {number} defenseStat — vehicle's relevant defense (0–100), 0 if N/A
 * @returns {{ pass:boolean, chance:number, roll:number }}
 */
function rollCheck(statVal, defenseStat = 0) {
  const chance = Math.max(5, Math.min(95, statVal - defenseStat));
  const roll   = Math.floor(Math.random() * 100) + 1; // 1–100
  return { pass: roll <= chance, chance, roll };
}

/**
 * hasItem(state, itemKey)
 * Check if a specific item is in the player's inventory.
 * Supports:
 *   - Legacy string key: 'hammer', 'lockpick', etc.
 *   - Category check: 'cutting' matches any item with cat === 'cutting'
 *   - Index check: numeric or numeric string matches item.index
 */
function hasItem(state, itemKey) {
  // Legacy string shorthand aliases
  const catAlias = { hammer: 'cutting', lockpick: 'lock_pick', wirecutter: 'wiring' };
  const resolvedCat = catAlias[itemKey];
  if (resolvedCat) return state.inventory.some(i => i.cat === resolvedCat);
  // Direct category match
  if (state.inventory.some(i => i.cat === itemKey)) return true;
  // Index match
  const idx = parseInt(itemKey);
  if (!isNaN(idx)) return state.inventory.some(i => i.index === idx);
  // Legacy .key field (old format)
  return state.inventory.some(i => i.key === itemKey || i.id === itemKey);
}

/**
 * ITEM_ACTION_MAP
 * Maps item category to the most relevant crime action key.
 * Used by the crime screen "Use item" popup.
 */
const ITEM_ACTION_MAP = {
  lock_pick:     'lockpick_door',
  wiring:        'disable_alarm',
  cutting:       'smash_window',
  mechanic:      'hotwire_engine',
  code_grabber:  'hotwire_engine',
  weapon:        'show_your_gun',
  armor:         null,
  navigation:    null,
  radio_scanner: null,
  gps_jammer:    null,
  other:         null,
};

// ---------------------------------------------------------------------------
// CRIME ACTION RESOLUTION
// ---------------------------------------------------------------------------

/**
 * resolveAction(action, state, vehicle)
 * Resolves one crime-scene action against player stats and vehicle defenses.
 *
 * @param {string} action   — action key (see activitySets in crime.html)
 * @param {object} state    — full game state
 * @param {object} vehicle  — { lockDef, elecDef, ... } vehicle stats
 * @returns {{
 *   msg:          string,   // message to append to crime log
 *   cls:          string,   // 'good' | 'bad' | 'sys' | ''
 *   policeRise:   number,   // how much to add to police readiness this turn
 *   progress:     string,   // 'none' | 'partial' | 'success' | 'fled' | 'busted'
 * }}
 */
/**
 * resolveDriveAway(state, policeLevel, vehicleSpeed)
 * Called after a successful vehicle acquisition to determine if the player
 * escapes cleanly or gets caught during the getaway.
 *
 * Returns { result: 'escaped'|'caught', msgs: [{text, cls, delay}] }
 */
function resolveDriveAway(state, policeLevel, vehicleSpeed) {
  // Best driver on the team (player or highest-driving crew member)
  const drivingVal = state.stats.driving.val;
  const crewMax = (state.contacts || [])
    .filter(c => (state.activeTeam || []).includes(c.id) && c.status === 'hired')
    .reduce((best, c) => Math.max(best, (c.stats?.driving?.val || 0)), 0);
  const effectiveDriving = Math.max(drivingVal, crewMax);

  // Difficulty scales with police level; fast vehicles help
  const speedBonus = Math.round(((vehicleSpeed || 60) - 60) / 5); // +1 per 5 speed above avg
  const difficulty = policeLevel >= 70 ? 15
                   : policeLevel >= 55 ? 5
                   : 0;
  const r = rollCheck(effectiveDriving, difficulty - speedBonus);

  const msgs = [];
  msgs.push({ text: 'You slip behind the wheel and floor it.', cls: 'sys', delay: 0 });

  if (policeLevel < 55) {
    // Clean — no pursuit
    msgs.push({ text: 'The street is clear. You drive away uncontested.', cls: 'good', delay: 700 });
    return { result: 'escaped', msgs };
  }

  if (policeLevel < 70) {
    msgs.push({ text: 'A patrol car clocks you pulling out — pursuit begins!', cls: 'bad', delay: 700 });
    if (r.pass) {
      msgs.push({ text: `You lose them in traffic. (${r.chance}% / rolled ${r.roll}) Getaway successful.`, cls: 'good', delay: 1500 });
      return { result: 'escaped', msgs };
    } else {
      msgs.push({ text: `They cut you off — no escape. (${r.chance}% / rolled ${r.roll})`, cls: 'bad', delay: 1500 });
      return { result: 'caught', msgs };
    }
  }

  // Heavy pursuit
  msgs.push({ text: 'Police units swarm the area — heavy pursuit!', cls: 'bad', delay: 700 });
  if (r.pass) {
    msgs.push({ text: `Incredible driving — you shake them! (${r.chance}% / rolled ${r.roll})`, cls: 'good', delay: 1500 });
    return { result: 'escaped', msgs };
  } else {
    msgs.push({ text: `Roadblock ahead. You\'re trapped. (${r.chance}% / rolled ${r.roll})`, cls: 'bad', delay: 1500 });
    return { result: 'caught', msgs };
  }
}


/**
 * getToolBonus(inventory, type)
 * Returns the best skill bonus from tools in inventory for a given type.
 * type: 'pick' | 'wiring' | 'slim_jim' | 'pump_wedge'
 */
function getToolBonus(inventory, type) {
  const pickBonuses   = { tryout_keys:5, lock_pick_set:10, snap_gun:20, pro_pick_set:25, ignition_decoder:30 };
  const wiringBonuses = { wire_cutter:5, wire_stripper:10, multimeter:15, probelight:20 };
  let best = 0;
  for (const item of inventory) {
    const id = item.id || '';
    if (type === 'pick'       && pickBonuses[id]   !== undefined) best = Math.max(best, pickBonuses[id]);
    if (type === 'wiring'     && wiringBonuses[id]  !== undefined) best = Math.max(best, wiringBonuses[id]);
    if (type === 'slim_jim'   && id === 'slim_jim')  best = 15;
    if (type === 'pump_wedge' && id === 'pump_wedge') best = 15;
  }
  return best;
}

/**
 * getBestActor(state, statKey, toolType, requireGun)
 * Returns the team member best suited to perform an action.
 *
 * Eligible: player + contacts where status==='hired' && assignedLocation===null
 *
 * Selection priority:
 *   - If requireGun: only candidates with a firearm qualify; returns null if none.
 *   - If toolType set: highest getToolBonus wins; ties broken by statKey.
 *     If nobody has the tool (bonus===0) falls back to highest statKey.
 *   - Otherwise: highest statKey; player wins ties (listed first).
 *
 * Returns { name, isPlayer, contactId, statVal, inventory, toolBonus } | null
 */
function getBestActor(state, statKey, toolType, requireGun) {
  const GUN_IDS = ['pistol', 'shotgun', 'rifle'];
  function hasGunInInv(inv) {
    return (inv || []).some(i => i && GUN_IDS.includes((i.id || '').toLowerCase()));
  }

  // Player first (wins ties), then unassigned hired crew
  const candidates = [];
  candidates.push({
    name:      state.playerName || 'You',
    isPlayer:  true,
    contactId: null,
    statVal:   (state.stats[statKey] && state.stats[statKey].val) || 0,
    inventory: state.inventory || [],
  });
  for (const c of (state.contacts || [])) {
    if (c.status !== 'hired') continue;
    if (c.assignedLocation !== null && c.assignedLocation !== undefined) continue;
    candidates.push({
      name:      c.name,
      isPlayer:  false,
      contactId: c.id,
      statVal:   (c.stats && c.stats[statKey] && c.stats[statKey].val) || 0,
      inventory: c.inventory || [],
    });
  }

  // Hard gun gate
  let pool = requireGun ? candidates.filter(c => hasGunInInv(c.inventory)) : candidates;
  if (pool.length === 0) return null;

  // Attach tool bonus
  pool = pool.map(c => ({ ...c, toolBonus: toolType ? getToolBonus(c.inventory, toolType) : 0 }));

  if (toolType) {
    const maxBonus = Math.max(...pool.map(c => c.toolBonus));
    if (maxBonus > 0) pool = pool.filter(c => c.toolBonus === maxBonus);
    // maxBonus===0: nobody has the tool — select by stat only
  }

  // Highest stat wins; player already first so wins ties naturally
  pool.sort((a, b) => b.statVal - a.statVal);
  return pool[0];
}

function resolveAction(action, state, vehicle, sceneState) {
  const stats = state.stats;
  sceneState = sceneState || {};
  function upd(patch) { return Object.assign({}, sceneState, patch); }

  switch (action) {

    // ── UNIVERSAL ─────────────────────────────────────────────────────────

    case 'case_the_area': {
      const actor = getBestActor(state, 'hiding');
      const r = rollCheck(actor.statVal, 0);
      const who = actor.isPlayer ? 'You case' : actor.name + ' cases';
      return r.pass
        ? { msg: who + ' the area carefully (' + r.chance + '% / rolled ' + r.roll + '). Police response slowed.',
            cls:'good', policeRise: 2, progress:'none', skillGain: 'hiding',
            stateUpdate: upd({}) }
        : { msg: who + ' the area but feel exposed (' + r.chance + '% / rolled ' + r.roll + ').',
            cls:'', policeRise: 6, progress:'none', stateUpdate: upd({}) };
    }

    case 'flee': {
      return { msg:'You leave the scene empty-handed.',
               cls:'bad', policeRise: 5, progress:'fled', stateUpdate: upd({}) };
    }

    case 'skip_turn': {
      return { msg:'You hold your position.',
               cls:'sys', policeRise: 1, progress:'none', stateUpdate: upd({}) };
    }

    // ── COVERT STEAL — ENTRY ──────────────────────────────────────────────

    case 'smash_window': {
      return { msg:'You smash the window. Alarm triggered!',
               cls:'bad', policeRise: 20, progress:'none',
               stateUpdate: upd({ doorOpen: true, alarmActive: true }) };
    }

    case 'lockpick_door': {
      const actor = getBestActor(state, 'locksmithing', 'pick');
      const tb = actor.toolBonus;
      const r = rollCheck(actor.statVal + tb, vehicle.lockDef);
      const who    = actor.isPlayer ? 'Lockpick' : actor.name + ' picks the lock';
      const whoFail= actor.isPlayer ? 'Lockpick' : actor.name + ' picks the lock';
      return r.pass
        ? { msg: who + ' successful (' + r.chance + '% / rolled ' + r.roll + '). Door open.',
            cls:'good', policeRise: 4, progress:'none', skillGain: 'locksmithing',
            stateUpdate: upd({ doorOpen: true }) }
        : { msg: whoFail + ' failed (' + r.chance + '% / rolled ' + r.roll + '). Try again.',
            cls:'', policeRise: 5, progress:'none', stateUpdate: upd({}) };
    }

    case 'slim_jim': {
      const actor = getBestActor(state, 'locksmithing', 'slim_jim');
      const tb = actor.toolBonus;
      const r = rollCheck(actor.statVal + tb, vehicle.lockDef);
      const who     = actor.isPlayer ? 'You slide' : actor.name + ' slides';
      const whoSlip = actor.isPlayer ? 'It slipped' : actor.name + ' slipped';
      return r.pass
        ? { msg: who + ' the slim jim in clean (' + r.chance + '% / rolled ' + r.roll + '). Door open.',
            cls:'good', policeRise: 3, progress:'none', skillGain: 'locksmithing',
            stateUpdate: upd({ doorOpen: true }) }
        : { msg: whoSlip + ' (' + r.chance + '% / rolled ' + r.roll + '). Alarm triggered!',
            cls:'bad', policeRise: 15, progress:'none',
            stateUpdate: upd({ doorOpen: true, alarmActive: true }) };
    }

    case 'door_opener': {
      const actor = getBestActor(state, 'locksmithing', 'pump_wedge');
      const tb = actor.toolBonus;
      const r = rollCheck(actor.statVal + tb, vehicle.lockDef);
      const who     = actor.isPlayer ? 'Pump wedge works' : actor.name + ' works the wedge';
      const whoFail = actor.isPlayer ? 'Pump wedge slipped' : actor.name + "'s wedge slipped";
      return r.pass
        ? { msg: who + ' (' + r.chance + '% / rolled ' + r.roll + '). Door open, no alarm.',
            cls:'good', policeRise: 3, progress:'none', skillGain: 'locksmithing',
            stateUpdate: upd({ doorOpen: true }) }
        : { msg: whoFail + ' (' + r.chance + '% / rolled ' + r.roll + '). Try again.',
            cls:'', policeRise: 4, progress:'none', stateUpdate: upd({}) };
    }

    // ── COVERT STEAL — AFTER DOOR OPEN ───────────────────────────────────

    case 'disable_alarm': {
      const actor = getBestActor(state, 'electronics', 'wiring');
      const tb = actor.toolBonus;
      const r = rollCheck(actor.statVal + tb, vehicle.elecDef);
      const who     = actor.isPlayer ? 'Alarm disabled' : actor.name + ' disables the alarm';
      const whoFail = actor.isPlayer ? 'Failed to disable alarm' : actor.name + ' fails to disable the alarm';
      return r.pass
        ? { msg: who + ' (' + r.chance + '% / rolled ' + r.roll + ').',
            cls:'good', policeRise: 2, progress:'none', skillGain: 'electronics',
            stateUpdate: upd({ alarmDisabled: true }) }
        : { msg: whoFail + ' (' + r.chance + '% / rolled ' + r.roll + '). It keeps wailing!',
            cls:'bad', policeRise: 12, progress:'none', stateUpdate: upd({}) };
    }

    case 'hotwire_engine': {
      const alarmPenalty = (sceneState.alarmActive && !sceneState.alarmDisabled) ? 10 : 0;
      const actor = getBestActor(state, 'electronics', 'wiring');
      const tb = actor.toolBonus;
      const r = rollCheck(actor.statVal + tb, vehicle.elecDef);
      const who     = actor.isPlayer ? 'Hotwire successful' : actor.name + ' hotwires it';
      const whoFail = actor.isPlayer ? 'Hotwire failed' : actor.name + "'s hotwire attempt failed";
      return r.pass
        ? { msg: who + ' (' + r.chance + '% / rolled ' + r.roll + '). Engine running!',
            cls:'good', policeRise: 5 + alarmPenalty, progress:'none', skillGain: 'electronics',
            stateUpdate: upd({ engineStarted: true }) }
        : { msg: whoFail + ' (' + r.chance + '% / rolled ' + r.roll + '). Try again.',
            cls:'', policeRise: 6 + alarmPenalty, progress:'none', stateUpdate: upd({}) };
    }

    case 'pick_ignition': {
      const alarmPenalty = (sceneState.alarmActive && !sceneState.alarmDisabled) ? 10 : 0;
      const actor = getBestActor(state, 'locksmithing', 'pick');
      const tb = actor.toolBonus;
      const r = rollCheck(actor.statVal + tb, vehicle.lockDef);
      const who     = actor.isPlayer ? 'Ignition lock picked' : actor.name + ' picks the ignition lock';
      const whoFail = actor.isPlayer ? 'Ignition pick failed' : actor.name + "'s ignition pick failed";
      return r.pass
        ? { msg: who + ' (' + r.chance + '% / rolled ' + r.roll + '). Engine starts!',
            cls:'good', policeRise: 4 + alarmPenalty, progress:'none', skillGain: 'locksmithing',
            stateUpdate: upd({ engineStarted: true }) }
        : { msg: whoFail + ' (' + r.chance + '% / rolled ' + r.roll + '). Try again.',
            cls:'', policeRise: 5 + alarmPenalty, progress:'none', stateUpdate: upd({}) };
    }

    // ── GPS CHECK (shared) ────────────────────────────────────────────────

    case 'check_gps': {
      const actor = getBestActor(state, 'electronics');
      const r = rollCheck(actor.statVal, 0);
      const who = actor.isPlayer ? 'Electronics check done' : actor.name + ' checks for a tracker';
      return r.pass
        ? { msg: who + ' (' + r.chance + '% / rolled ' + r.roll + '). No tracker found.',
            cls:'good', policeRise: 2, progress:'none', skillGain: 'electronics',
            stateUpdate: upd({ gpsChecked: true }) }
        : { msg: who + ' (' + r.chance + '% / rolled ' + r.roll + '). Tracker disabled.',
            cls:'good', policeRise: 3, progress:'none', skillGain: 'electronics',
            stateUpdate: upd({ gpsChecked: true }) };
    }

    case 'skip_gps': {
      return { msg:"You skip the GPS check. Hope there's no tracker on this thing.",
               cls:'sys', policeRise: 0, progress:'none',
               stateUpdate: upd({ gpsSkipped: true }),
               pendingTracker: true };
    }

    // ── GET IN ────────────────────────────────────────────────────────────

    case 'get_in_vehicle': {
      return { msg:'You get in and prepare to drive. Here we go!',
               cls:'good', policeRise: 2, progress:'success',
               stateUpdate: upd({}) };
    }

    // ── HIJACK SEQUENCE ───────────────────────────────────────────────────

    case 'approach_driver': {
      const actor = getBestActor(state, 'acting');
      const r = rollCheck(actor.statVal, 0);
      const who     = actor.isPlayer ? 'You approach' : actor.name + ' approaches';
      const whoSpook= actor.isPlayer ? 'Your approach' : actor.name + "'s approach";
      return r.pass
        ? { msg: who + " the vehicle calmly (" + r.chance + "% / rolled " + r.roll + "). The driver hasn't panicked.",
            cls:'good', policeRise: 3, progress:'none', skillGain: 'acting',
            stateUpdate: upd({ approached: true }) }
        : { msg: whoSpook + " spooked the driver (" + r.chance + "% / rolled " + r.roll + "). They're on edge.",
            cls:'', policeRise: 4, progress:'none',
            stateUpdate: upd({ approached: true }) };
    }

    case 'ask_to_go_out': {
      const actor = getBestActor(state, 'acting');
      const bonus = sceneState.approached ? 10 : 0;
      const r = rollCheck(actor.statVal + bonus, 0);
      const who = actor.isPlayer ? 'You talk' : actor.name + ' talks';
      return r.pass
        ? { msg: who + ' the driver out of the car (' + r.chance + '% / rolled ' + r.roll + '). Keys in hand!',
            cls:'good', policeRise: 4, progress:'none', skillGain: 'acting',
            stateUpdate: upd({ driverRemoved: true }) }
        : { msg:'Driver refuses (' + r.chance + '% / rolled ' + r.roll + '). Escalate or yank them out.',
            cls:'bad', policeRise: 6, progress:'none',
            stateUpdate: upd({ approached: true, escalationFailed: true }) };
    }

    case 'show_your_gun': {
      const actor = getBestActor(state, 'shooting', null, true);
      if (!actor) {
        return { msg:"Nobody on the team is armed.",
                 cls:'bad', policeRise: 2, progress:'none', stateUpdate: upd({}) };
      }
      const r = rollCheck(actor.statVal, 0);
      const who     = actor.isPlayer ? 'You show your weapon' : actor.name + ' draws their weapon';
      const whoFail = actor.isPlayer ? 'You fumble the draw' : actor.name + ' fumbles the draw';
      return r.pass
        ? { msg: who + ' (' + r.chance + '% / rolled ' + r.roll + '). The driver freezes.',
            cls:'good', policeRise: 10, progress:'none', skillGain: 'shooting',
            stateUpdate: upd({ gunShown: true, approached: true }) }
        : { msg: whoFail + ' (' + r.chance + '% / rolled ' + r.roll + '). Driver starts screaming!',
            cls:'bad', policeRise: 10, progress:'none',
            stateUpdate: upd({ approached: true, escalationFailed: true }) };
    }

    case 'demand_keys': {
      if (!sceneState.gunShown) {
        return { msg:"The driver won't hand over the keys — you need more leverage.",
                 cls:'bad', policeRise: 2, progress:'none', stateUpdate: upd({}) };
      }
      const bonus = sceneState.approached ? 15 : 0;
      const r = rollCheck(70 + bonus, 0);
      return r.pass
        ? { msg:'The driver hands over the keys (rolled ' + r.roll + '). Get in!',
            cls:'good', policeRise: 6, progress:'none',
            stateUpdate: upd({ driverRemoved: true }) }
        : { msg:"The driver refuses! (rolled " + r.roll + ") They're calling for help.",
            cls:'bad', policeRise: 8, progress:'none', stateUpdate: upd({}) };
    }

    case 'force_out_of_vehicle': {
      const actor = sceneState.gunShown
        ? (getBestActor(state, 'shooting', null, true) || getBestActor(state, 'shooting'))
        : getBestActor(state, 'shooting');
      const motoTypes = ['motorcycle','atv','dirt bike','moped','scooter'];
      const isMoto = motoTypes.some(t => (vehicle.body || '').includes(t));
      const motoBonus = isMoto ? 30 : 0;
      const gunBonus  = sceneState.gunShown ? 20 : 0;
      const r = rollCheck(actor.statVal + gunBonus, -motoBonus);
      const motoNote  = isMoto ? ' (Easy — no door to fight through!)' : '';
      const who     = actor.isPlayer ? 'You force' : actor.name + ' forces';
      const whoFail = actor.isPlayer ? 'Struggle! Driver resists' : 'Struggle! ' + actor.name + " can't pull them out";
      return r.pass
        ? { msg: who + ' the driver out (' + r.chance + '% / rolled ' + r.roll + ').' + motoNote + ' Vehicle is yours!',
            cls:'good', policeRise: 14, progress:'none', skillGain: 'shooting',
            stateUpdate: upd({ driverRemoved: true }) }
        : { msg: whoFail + ' (' + r.chance + '% / rolled ' + r.roll + '). Witnesses watching.',
            cls:'bad', policeRise: 10, progress:'none',
            stateUpdate: upd({ approached: true }) };
    }

    case 'shoot_driver': {
      const actor = getBestActor(state, 'shooting', null, true);
      if (!actor) {
        return { msg:"Nobody on the team is armed.",
                 cls:'bad', policeRise: 2, progress:'none', stateUpdate: upd({}) };
      }
      const who = actor.isPlayer ? 'You shoot' : actor.name + ' shoots';
      return { msg: who + ' the driver. They slump over — the vehicle is yours. Police response surges!',
               cls:'bad', policeRise: 35, progress:'none',
               stateUpdate: upd({ driverRemoved: true, approached: true }) };
    }

    // ── RACING AREA ───────────────────────────────────────────────────────

    case 'distract_owner': {
      const actor = getBestActor(state, 'acting');
      const r = rollCheck(actor.statVal, 0);
      const who     = actor.isPlayer ? 'You distract' : actor.name + ' distracts';
      const whoFail = actor.isPlayer ? 'The owner sees through you' : 'The owner sees through ' + actor.name;
      return r.pass
        ? { msg: who + ' the owner with a convincing story (' + r.chance + '% / rolled ' + r.roll + ').',
            cls:'good', policeRise: 3, progress:'none', skillGain: 'acting',
            stateUpdate: upd({ ownerDistracted: true, driverRemoved: true }) }
        : { msg: whoFail + " (" + r.chance + "% / rolled " + r.roll + "). They're suspicious.",
            cls:'', policeRise: 8, progress:'none', stateUpdate: upd({}) };
    }

    // ── BANK ROBBERY ──────────────────────────────────────────────────────

    case 'bank_give_note': {
      const actor = getBestActor(state, 'acting');
      const r = rollCheck(actor.statVal, 0);
      const who     = actor.isPlayer ? 'You slide the note' : actor.name + ' slides the note';
      const whoFail = actor.isPlayer ? 'Your note' : actor.name + "'s note";
      return r.pass
        ? { msg: who + ' across the counter (' + r.chance + '% / rolled ' + r.roll + '). The teller freezes.',
            cls:'good', policeRise: 4, progress:'none', skillGain: 'acting',
            stateUpdate: upd({ teller_approached: true, teller_complied: true }) }
        : { msg: whoFail + ' spooked the teller (' + r.chance + '% / rolled ' + r.roll + '). Alarm triggered!',
            cls:'bad', policeRise: 18, progress:'none',
            stateUpdate: upd({ teller_approached: true, teller_complied: false, alarm_triggered: true }) };
    }

    case 'bank_announce': {
      const actor = getBestActor(state, 'shooting', null, true);
      if (!actor) {
        return { msg:'Nobody on the team is armed.',
                 cls:'bad', policeRise: 2, progress:'none', stateUpdate: upd({}) };
      }
      const r = rollCheck(actor.statVal, 0);
      const who     = actor.isPlayer ? 'You fire a shot into the ceiling' : actor.name + ' fires a shot into the ceiling';
      const whoFail = actor.isPlayer ? 'Your announcement' : actor.name + "'s announcement";
      return r.pass
        ? { msg: who + ' (' + r.chance + '% / rolled ' + r.roll + '). Everyone hits the floor.',
            cls:'good', policeRise: 22, progress:'none', skillGain: 'shooting',
            stateUpdate: upd({ teller_approached: true, teller_complied: true }) }
        : { msg: whoFail + ' caused panic (' + r.chance + '% / rolled ' + r.roll + '). Teller hit the alarm!',
            cls:'bad', policeRise: 28, progress:'none',
            stateUpdate: upd({ teller_approached: true, teller_complied: false, alarm_triggered: true }) };
    }

    case 'bank_demand_teller': {
      const payout = 1500 + Math.floor(Math.random() * 6501); // $1500–$8000
      state.cash += payout;
      saveState(state);
      const who = 'Teller';
      return { msg: who + ' hands over $' + payout.toLocaleString() + '. Cash in hand.',
               cls:'good', policeRise: 6, progress:'none',
               stateUpdate: upd({ teller_cash_taken: true }) };
    }

    case 'bank_find_manager': {
      return { msg:'You locate the bank manager in the back office.',
               cls:'good', policeRise: 10, progress:'none',
               stateUpdate: upd({ manager_found: true }) };
    }

    case 'bank_lead_to_vault': {
      const actor = getBestActor(state, 'acting');
      const r = rollCheck(actor.statVal, 0);
      const who     = actor.isPlayer ? 'You march the manager' : actor.name + ' marches the manager';
      const whoFail = actor.isPlayer ? 'The manager resists your grip' : 'The manager resists ' + actor.name;
      return r.pass
        ? { msg: who + ' to the vault (' + r.chance + '% / rolled ' + r.roll + '). They\'re complying.',
            cls:'good', policeRise: 6, progress:'none', skillGain: 'acting',
            stateUpdate: upd({ manager_complied: true }) }
        : { msg: whoFail + ' (' + r.chance + '% / rolled ' + r.roll + '). They\'re stalling.',
            cls:'bad', policeRise: 14, progress:'none',
            stateUpdate: upd({}) };
    }

    case 'bank_demand_vault': {
      const actorShoot = getBestActor(state, 'shooting', null, true);
      const actorAct   = getBestActor(state, 'acting');
      if (!actorShoot) {
        return { msg:'You need a gun to threaten the manager.',
                 cls:'bad', policeRise: 2, progress:'none', stateUpdate: upd({}) };
      }
      const rShoot = rollCheck(actorShoot.statVal, 0);
      const rAct   = rollCheck(actorAct.statVal, 0);
      const pass   = rShoot.pass || rAct.pass;
      const bestRoll = rShoot.roll >= rAct.roll ? rShoot : rAct;
      return pass
        ? { msg:'Under pressure the manager opens the vault (' + bestRoll.chance + '% / rolled ' + bestRoll.roll + '). You\'re in.',
            cls:'good', policeRise: 8, progress:'none',
            stateUpdate: upd({ vault_open: true }) }
        : { msg:'The manager is holding out (' + bestRoll.chance + '% / rolled ' + bestRoll.roll + '). Police are getting closer.',
            cls:'bad', policeRise: 16, progress:'none',
            stateUpdate: upd({}) };
    }

    case 'bank_fill_bag': {
      const payout = 500 + Math.floor(Math.random() * 1501); // $500–$2000
      state.cash += payout;
      saveState(state);
      const bagsLeft = (sceneState.bags_remaining || 1) - 1;
      const bagsTaken = (sceneState.bags_taken || 0) + 1;
      return { msg:'You fill a bag — $' + payout.toLocaleString() + ' in cash. ' + (bagsLeft > 0 ? bagsLeft + ' bag(s) left in the vault.' : 'Vault is empty.'),
               cls:'good', policeRise: 8, progress:'none',
               stateUpdate: upd({ bags_remaining: bagsLeft, bags_taken: bagsTaken }) };
    }

    case 'bank_leave': {
      return { msg:'You head for the exit. Time to move.',
               cls:'sys', policeRise: 4, progress:'bank_leave',
               stateUpdate: upd({}) };
    }

    default:
      return { msg:'Nothing happens.', cls:'', policeRise: 3, progress:'none',
               stateUpdate: upd({}) };
  }
}


// ---------------------------------------------------------------------------
// VEHICLE POOL
// ---------------------------------------------------------------------------

/** Cached vehicle list - loaded once per session */
let _vehicleCache = null;

/**
 * loadVehicles()
 * Returns stealable vehicles (price > 0) from inline data.
 * No fetch required — works on file:// protocol.
 */
async function loadVehicles() {
  if (_vehicleCache) return _vehicleCache;
  _vehicleCache = VEHICLES_DATA.filter(v => v.price > 0);
  return _vehicleCache;
}

const VEHICLES_DATA = [
  {"id":0,"name":"Audi TT","body":"Convertible","seats":2,"price":27000,"speed":90,"lockDef":0,"elecDef":0,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":1},
  {"id":1,"name":"Mercedes Benz C Class","body":"Fastback","seats":4,"price":55000,"speed":90,"lockDef":0,"elecDef":0,"engine":"4.3L V8","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":2},
  {"id":2,"name":"Oldsmobile Alero GLS","body":"Convertible","seats":2,"price":10000,"speed":70,"lockDef":0,"elecDef":0,"engine":"6 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":3},
  {"id":3,"name":"Ford Thunderbird","body":"Roadster","seats":2,"price":40000,"speed":100,"lockDef":3,"elecDef":37,"engine":"3.9L V8","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":4},
  {"id":4,"name":"Toyota Celica","body":"Roadster","seats":2,"price":17000,"speed":90,"lockDef":0,"elecDef":0,"engine":"2.2L I4","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":5},
  {"id":5,"name":"Toyota Tacoma SR5","body":"Pickup","seats":3,"price":28000,"speed":60,"lockDef":6,"elecDef":0,"engine":"2.4L I4","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":6},
  {"id":6,"name":"Mazda RX-7","body":"Convertible","seats":2,"price":32000,"speed":100,"lockDef":7,"elecDef":48,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":7},
  {"id":7,"name":"Jeep Grand Cherokee","body":"Crew Cab Pickup","seats":5,"price":25000,"speed":60,"lockDef":4,"elecDef":81,"engine":"8 cylinders","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":8},
  {"id":8,"name":"Ford Focus SE","body":"Hatchback","seats":4,"price":23000,"speed":70,"lockDef":9,"elecDef":31,"engine":"2.0L I4","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":9},
  {"id":9,"name":"Four Winds 5000","body":"Heavy Truck","seats":5,"price":30000,"speed":0,"lockDef":3,"elecDef":53,"engine":"","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":10},
  {"id":10,"name":"Ferrari F40","body":"Convertible","seats":2,"price":300000,"speed":100,"lockDef":6,"elecDef":91,"engine":"V8","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":11},
  {"id":11,"name":"Chevrolet 2500 Silverado","body":"Minivan","seats":2,"price":15000,"speed":50,"lockDef":9,"elecDef":88,"engine":"Vortec 6000 V8","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":12},
  {"id":12,"name":"AC Superblower","body":"Roadster","seats":2,"price":100000,"speed":100,"lockDef":3,"elecDef":95,"engine":"4.9L V16","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":13},
  {"id":13,"name":"Yamaha Raptor 660R","body":"Quad","seats":2,"price":5000,"speed":10,"lockDef":3,"elecDef":88,"engine":"660R","isMoto":true,"isTruck":false,"isRaceWorthy":false,"imgIdx":14},
  {"id":14,"name":"Honda Accord EX","body":"Fastback","seats":4,"price":25000,"speed":80,"lockDef":3,"elecDef":2,"engine":"3.0L V6","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":15},
  {"id":15,"name":"Ford Focus LX","body":"Fastback","seats":4,"price":21000,"speed":70,"lockDef":10,"elecDef":55,"engine":"2.0L I4","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":16},
  {"id":16,"name":"Hummer H2","body":"Crew Cab Pickup","seats":5,"price":90000,"speed":40,"lockDef":5,"elecDef":7,"engine":"6.0L V8","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":17},
  {"id":17,"name":"Mitsubishi 3000GT SL","body":"Sedan","seats":4,"price":24000,"speed":90,"lockDef":8,"elecDef":2,"engine":"3.0L V6","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":18},
  {"id":18,"name":"Honda Accord EX","body":"Fastback","seats":4,"price":20000,"speed":80,"lockDef":3,"elecDef":2,"engine":"2.3L I4","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":19},
  {"id":19,"name":"Chevrolet 1500 Silverado","body":"Pickup","seats":3,"price":20000,"speed":50,"lockDef":9,"elecDef":5,"engine":"5.7L V8","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":20},
  {"id":20,"name":"Toyota Celica GT","body":"Convertible","seats":2,"price":18000,"speed":80,"lockDef":0,"elecDef":0,"engine":"2.2L I4","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":21},
  {"id":21,"name":"Kawasaki ZX6R","body":"Sportbike","seats":2,"price":15000,"speed":100,"lockDef":11,"elecDef":73,"engine":"600","isMoto":true,"isTruck":false,"isRaceWorthy":true,"imgIdx":22},
  {"id":22,"name":"Ford Ranger Super","body":"Pickup","seats":3,"price":6000,"speed":50,"lockDef":0,"elecDef":0,"engine":"3.0L V6","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":23},
  {"id":23,"name":"Dodge Durango SLT","body":"Crew Cab Pickup","seats":4,"price":17000,"speed":50,"lockDef":7,"elecDef":100,"engine":"5.2L V8","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":24},
  {"id":24,"name":"FLSTF Fatboy","body":"Cruiser Moto","seats":2,"price":20000,"speed":70,"lockDef":8,"elecDef":44,"engine":"","isMoto":true,"isTruck":false,"isRaceWorthy":false,"imgIdx":25},
  {"id":25,"name":"Porsche Boxster","body":"Roadster","seats":2,"price":33000,"speed":90,"lockDef":9,"elecDef":13,"engine":"2.5L 6 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":26},
  {"id":26,"name":"Chevrolet S-10","body":"Pickup","seats":3,"price":15000,"speed":60,"lockDef":5,"elecDef":2,"engine":"2.2L I4","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":27},
  {"id":27,"name":"GMC 1500","body":"Pickup","seats":3,"price":18000,"speed":50,"lockDef":10,"elecDef":26,"engine":"5.7L V8","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":28},
  {"id":28,"name":"Chevrolet Astro LS","body":"Station Wagon","seats":5,"price":16000,"speed":60,"lockDef":5,"elecDef":45,"engine":"6 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":29},
  {"id":29,"name":"Ford Focus SE","body":"Fastback","seats":4,"price":15000,"speed":70,"lockDef":9,"elecDef":31,"engine":"2.0L I4","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":30},
  {"id":30,"name":"Chevrolet Z28","body":"Convertible","seats":2,"price":19000,"speed":90,"lockDef":5,"elecDef":95,"engine":"8 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":31},
  {"id":31,"name":"Mazda B4000","body":"Minivan","seats":2,"price":13000,"speed":50,"lockDef":4,"elecDef":27,"engine":"V6","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":32},
  {"id":32,"name":"Toyota Camry LE","body":"Fastback","seats":4,"price":13000,"speed":70,"lockDef":10,"elecDef":95,"engine":"4 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":33},
  {"id":33,"name":"Ford F350 Styleside XLT","body":"Minivan","seats":2,"price":14000,"speed":40,"lockDef":3,"elecDef":95,"engine":"8 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":34},
  {"id":34,"name":"Kawasaki ZX6R","body":"Sportbike","seats":2,"price":14000,"speed":100,"lockDef":11,"elecDef":73,"engine":"","isMoto":true,"isTruck":false,"isRaceWorthy":true,"imgIdx":35},
  {"id":35,"name":"Volvo FH12-420","body":"Tow Truck","seats":3,"price":34000,"speed":30,"lockDef":4,"elecDef":67,"engine":"","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":36},
  {"id":36,"name":"Pontiac Grand Prix SE","body":"Convertible","seats":2,"price":11000,"speed":70,"lockDef":10,"elecDef":62,"engine":"6 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":37},
  {"id":37,"name":"Dodge Stratus ES","body":"Fastback","seats":4,"price":11000,"speed":70,"lockDef":10,"elecDef":24,"engine":"6 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":38},
  {"id":38,"name":"Chevrolet Cavalier","body":"Sedan","seats":4,"price":7000,"speed":70,"lockDef":5,"elecDef":42,"engine":"4 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":39},
  {"id":39,"name":"Kia Sportage EX","body":"Hatchback","seats":4,"price":12000,"speed":50,"lockDef":3,"elecDef":63,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":40},
  {"id":40,"name":"Nissan Quest GXE","body":"Station Wagon","seats":5,"price":14000,"speed":60,"lockDef":4,"elecDef":94,"engine":"6 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":41},
  {"id":41,"name":"Lincoln LS","body":"Fastback","seats":4,"price":25000,"speed":80,"lockDef":8,"elecDef":22,"engine":"3.9L V8","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":42},
  {"id":42,"name":"Chevrolet Astro CL","body":"Station Wagon","seats":5,"price":9000,"speed":50,"lockDef":4,"elecDef":88,"engine":"6 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":43},
  {"id":43,"name":"GMC Sierra 3500","body":"Pickup","seats":3,"price":2000,"speed":20,"lockDef":7,"elecDef":84,"engine":"","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":44},
  {"id":44,"name":"RB145 Rainbow","body":"RV","seats":5,"price":32000,"speed":10,"lockDef":0,"elecDef":0,"engine":"","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":45},
  {"id":45,"name":"Saturn SL 2","body":"Fastback","seats":4,"price":9000,"speed":70,"lockDef":10,"elecDef":43,"engine":"4 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":46},
  {"id":46,"name":"Dodge Intrepid","body":"Fastback","seats":4,"price":5000,"speed":70,"lockDef":6,"elecDef":61,"engine":"2.7L V6","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":47},
  {"id":47,"name":"M.A.N.","body":"Tow Truck","seats":3,"price":25000,"speed":10,"lockDef":5,"elecDef":81,"engine":"","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":48},
  {"id":48,"name":"Volkswagen New Beetle GL","body":"Convertible","seats":2,"price":12000,"speed":70,"lockDef":11,"elecDef":72,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":49},
  {"id":49,"name":"Mercedes-Benz 2540 6X2","body":"Tow Truck","seats":3,"price":45000,"speed":10,"lockDef":4,"elecDef":59,"engine":"","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":50},
  {"id":50,"name":"Ford Focus ZX3","body":"Hatchback","seats":4,"price":8000,"speed":70,"lockDef":0,"elecDef":0,"engine":"2.0L","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":51},
  {"id":51,"name":"Honda Civic DX","body":"Fastback","seats":4,"price":8000,"speed":70,"lockDef":3,"elecDef":16,"engine":"1.6L I4","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":52},
  {"id":52,"name":"Mazda Protege LX","body":"Fastback","seats":4,"price":7000,"speed":70,"lockDef":4,"elecDef":50,"engine":"4 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":53},
  {"id":53,"name":"Honda Civic Si","body":"Convertible","seats":4,"price":16000,"speed":80,"lockDef":9,"elecDef":71,"engine":"4 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":54},
  {"id":54,"name":"Jeep Wrangler Sahara","body":"Crew Cab Pickup","seats":4,"price":14000,"speed":30,"lockDef":0,"elecDef":0,"engine":"4.0L I6","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":55},
  {"id":55,"name":"Dodge Intrepid SE","body":"Fastback","seats":4,"price":5000,"speed":70,"lockDef":0,"elecDef":0,"engine":"2.7L V6","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":56},
  {"id":56,"name":"Chevrolet Lumina","body":"Fastback","seats":4,"price":7000,"speed":70,"lockDef":8,"elecDef":50,"engine":"6 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":57},
  {"id":57,"name":"Honda Civic Si","body":"Convertible","seats":2,"price":19000,"speed":70,"lockDef":9,"elecDef":71,"engine":"4 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":58},
  {"id":58,"name":"Volkswagen Jetta","body":"Fastback","seats":4,"price":8000,"speed":60,"lockDef":0,"elecDef":0,"engine":"4 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":59},
  {"id":59,"name":"Kia Sephia","body":"Fastback","seats":4,"price":5000,"speed":70,"lockDef":3,"elecDef":71,"engine":"1.8L I4","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":60},
  {"id":60,"name":"Honda Civic LX","body":"Fastback","seats":4,"price":4000,"speed":70,"lockDef":8,"elecDef":92,"engine":"1.6L I4","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":61},
  {"id":61,"name":"Ford Taurus SE","body":"Sedan","seats":4,"price":6000,"speed":70,"lockDef":9,"elecDef":8,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":62},
  {"id":62,"name":"Dodge Durango SLT","body":"Crew Cab Pickup","seats":4,"price":16000,"speed":50,"lockDef":7,"elecDef":100,"engine":"4.7L V8","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":63},
  {"id":63,"name":"Dodge Dakota Sport","body":"Minivan","seats":2,"price":20000,"speed":50,"lockDef":4,"elecDef":16,"engine":"5.2L V8","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":64},
  {"id":64,"name":"Ford Escort ZX2","body":"Convertible","seats":2,"price":8000,"speed":70,"lockDef":5,"elecDef":30,"engine":"2.0L","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":65},
  {"id":65,"name":"Mercedes-Benz SLK 320","body":"Roadster","seats":2,"price":41000,"speed":90,"lockDef":0,"elecDef":0,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":66},
  {"id":66,"name":"Chrysler Concorde LX","body":"Fastback","seats":4,"price":6500,"speed":70,"lockDef":5,"elecDef":0,"engine":"2.7L V6","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":67},
  {"id":67,"name":"Mitsubishi Eclipse RS","body":"Convertible","seats":2,"price":16000,"speed":90,"lockDef":11,"elecDef":89,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":68},
  {"id":68,"name":"Ford Mustang","body":"Roadster","seats":2,"price":19000,"speed":80,"lockDef":6,"elecDef":85,"engine":"8 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":69},
  {"id":69,"name":"Mercury Sable GS","body":"Fastback","seats":4,"price":12000,"speed":70,"lockDef":3,"elecDef":31,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":70},
  {"id":70,"name":"Pontiac Firebird","body":"Convertible","seats":2,"price":28000,"speed":100,"lockDef":3,"elecDef":46,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":71},
  {"id":71,"name":"Ford Aspire","body":"Convertible","seats":2,"price":3000,"speed":70,"lockDef":11,"elecDef":43,"engine":"4 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":72},
  {"id":72,"name":"Ford Mustang","body":"Convertible","seats":2,"price":18000,"speed":100,"lockDef":6,"elecDef":85,"engine":"8 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":73},
  {"id":73,"name":"Ford Explorer","body":"Crew Cab Pickup","seats":4,"price":9000,"speed":50,"lockDef":9,"elecDef":8,"engine":"8 cylinders","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":74},
  {"id":74,"name":"Chevrolet Monte Carlo LS","body":"Convertible","seats":2,"price":7000,"speed":70,"lockDef":10,"elecDef":34,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":75},
  {"id":75,"name":"Chrysler PT Cruiser","body":"Station Wagon","seats":4,"price":17000,"speed":80,"lockDef":4,"elecDef":77,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":76},
  {"id":76,"name":"Subaru Legacy Outback","body":"Fastback","seats":4,"price":14000,"speed":80,"lockDef":0,"elecDef":0,"engine":"2.5L H4","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":77},
  {"id":77,"name":"Pontiac Bonneville SE","body":"Fastback","seats":4,"price":15000,"speed":70,"lockDef":9,"elecDef":71,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":78},
  {"id":78,"name":"Ford Taurus SE","body":"Hatchback","seats":4,"price":9000,"speed":70,"lockDef":9,"elecDef":8,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":79},
  {"id":79,"name":"Pontiac Grand Prix GT","body":"Fastback","seats":4,"price":15000,"speed":90,"lockDef":10,"elecDef":57,"engine":"6 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":80},
  {"id":80,"name":"Hyundai Elantra GLS","body":"Hatchback","seats":4,"price":14000,"speed":70,"lockDef":7,"elecDef":21,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":81},
  {"id":81,"name":"Ford Capri RS2600","body":"Convertible","seats":2,"price":10000,"speed":30,"lockDef":3,"elecDef":48,"engine":"2637cc V6","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":82},
  {"id":82,"name":"Chevrolet Corvette Z06","body":"Convertible","seats":2,"price":50000,"speed":100,"lockDef":0,"elecDef":0,"engine":"5.7L V8","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":83},
  {"id":83,"name":"Porsche 912","body":"Convertible","seats":2,"price":20000,"speed":30,"lockDef":7,"elecDef":16,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":84},
  {"id":84,"name":"Alfa Romeo Giulietta Ti 2","body":"Fastback","seats":4,"price":28000,"speed":20,"lockDef":9,"elecDef":89,"engine":"1290cc S4","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":85},
  {"id":85,"name":"GMC Sierra K1500","body":"Minivan","seats":4,"price":18000,"speed":50,"lockDef":3,"elecDef":54,"engine":"5.7L V8","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":86},
  {"id":86,"name":"Lincoln LS V8","body":"Fastback","seats":4,"price":36000,"speed":80,"lockDef":8,"elecDef":22,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":87},
  {"id":87,"name":"Chevrolet S-10 LS","body":"Minivan","seats":2,"price":9000,"speed":50,"lockDef":11,"elecDef":18,"engine":"2.2L I4","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":88},
  {"id":88,"name":"Audi A6 4.2 quattro","body":"Fastback","seats":4,"price":45000,"speed":70,"lockDef":5,"elecDef":93,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":89},
  {"id":89,"name":"Dodge Viper GTS","body":"Convertible","seats":2,"price":70000,"speed":100,"lockDef":5,"elecDef":30,"engine":"V10","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":90},
  {"id":90,"name":"Audi A6 2.7T quattro","body":"Fastback","seats":4,"price":31000,"speed":70,"lockDef":11,"elecDef":83,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":91},
  {"id":91,"name":"BMW X5 Sport","body":"Crew Cab Pickup","seats":4,"price":40000,"speed":100,"lockDef":5,"elecDef":51,"engine":"Diesel 3000cc","isMoto":false,"isTruck":true,"isRaceWorthy":true,"imgIdx":92},
  {"id":92,"name":"Lexus ES 300","body":"Fastback","seats":4,"price":19000,"speed":70,"lockDef":5,"elecDef":58,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":93},
  {"id":93,"name":"Suzuki GSXR 1100h","body":"Cruiser Moto","seats":2,"price":2000,"speed":100,"lockDef":6,"elecDef":97,"engine":"","isMoto":true,"isTruck":false,"isRaceWorthy":true,"imgIdx":94},
  {"id":94,"name":"Moto Guzzi EV1100","body":"Cruiser Moto","seats":2,"price":4500,"speed":80,"lockDef":11,"elecDef":34,"engine":"","isMoto":true,"isTruck":false,"isRaceWorthy":true,"imgIdx":95},
  {"id":95,"name":"Harley Davidson Pan Head","body":"Cruiser Moto","seats":2,"price":15000,"speed":70,"lockDef":7,"elecDef":41,"engine":"","isMoto":true,"isTruck":false,"isRaceWorthy":false,"imgIdx":96},
  {"id":96,"name":"Cobra Boxter 100cc","body":"Quad","seats":1,"price":1800,"speed":20,"lockDef":10,"elecDef":73,"engine":"","isMoto":true,"isTruck":false,"isRaceWorthy":false,"imgIdx":97},
  {"id":97,"name":"Yamaha YP 250","body":"Scooter","seats":1,"price":2000,"speed":20,"lockDef":11,"elecDef":44,"engine":"","isMoto":true,"isTruck":false,"isRaceWorthy":false,"imgIdx":98},
  {"id":98,"name":"Lamborghini Diablo VT","body":"Convertible","seats":2,"price":200000,"speed":100,"lockDef":0,"elecDef":0,"engine":"12 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":99},
  {"id":99,"name":"Pontiac Sunfire SE","body":"Fastback","seats":4,"price":10000,"speed":70,"lockDef":10,"elecDef":32,"engine":"4 cylinders","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":100},
  {"id":100,"name":"Toyota Supra Turbo","body":"Convertible","seats":2,"price":17000,"speed":90,"lockDef":6,"elecDef":10,"engine":"3.0L","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":101},
  {"id":101,"name":"Mercedes 408D","body":"SUV","seats":2,"price":8000,"speed":0,"lockDef":6,"elecDef":33,"engine":"","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":102},
  {"id":102,"name":"Chevrolet Custom Deluxe","body":"SUV","seats":2,"price":9000,"speed":0,"lockDef":4,"elecDef":76,"engine":"","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":103},
  {"id":103,"name":"VW LT 55","body":"SUV","seats":4,"price":15000,"speed":0,"lockDef":10,"elecDef":61,"engine":"","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":104},
  {"id":104,"name":"LDV Day Cab","body":"SUV","seats":2,"price":7000,"speed":0,"lockDef":8,"elecDef":13,"engine":"","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":105},
  {"id":105,"name":"Dutchmen 23RK","body":"Heavy Truck","seats":5,"price":30000,"speed":0,"lockDef":7,"elecDef":44,"engine":"Triton V-10","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":106},
  {"id":106,"name":"Holiday Rambler","body":"Heavy Truck","seats":5,"price":15000,"speed":0,"lockDef":7,"elecDef":81,"engine":"460 cu. in","isMoto":false,"isTruck":true,"isRaceWorthy":false,"imgIdx":107},
  {"id":107,"name":"Pontiac Parisienne","body":"Fastback","seats":4,"price":8000,"speed":50,"lockDef":11,"elecDef":31,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":117},
  {"id":119,"name":"Dodge Charger R/T","body":"Coupe","seats":2,"price":22000,"speed":65,"lockDef":0,"elecDef":0,"engine":"V8","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":120},
  {"id":120,"name":"Dodge Charger","body":"Coupe","seats":2,"price":34000,"speed":70,"lockDef":0,"elecDef":0,"engine":"V8","isMoto":false,"isTruck":false,"isRaceWorthy":false,"imgIdx":121},
  {"id":121,"name":"BMW 325 CiC","body":"Roadster","seats":4,"price":25000,"speed":80,"lockDef":10,"elecDef":99,"engine":"","isMoto":false,"isTruck":false,"isRaceWorthy":true,"imgIdx":122}
];

/**
 * buildLocationPool(locationType)
 * Returns 3-5 vehicles appropriate for the given location type.
 *
 * highway     - any stealable car, weighted toward mid/high value
 * residential - everyday cars only, no motos, no heavy trucks, price <= 40000
 * busy        - broader range cars, no motos, no heavy trucks
 * racing      - race-worthy only (speed >= 80), cars only
 */
async function buildLocationPool(locationType) {
  const all = await loadVehicles();
  let pool;
  switch (locationType) {
    case 'racing':
      pool = all.filter(v => v.isRaceWorthy && !v.isMoto && !v.isTruck);
      break;
    case 'residential':
      pool = all.filter(v => !v.isMoto && !v.isTruck && v.price <= 40000);
      break;
    case 'busy':
      pool = all.filter(v => !v.isMoto && !v.isTruck);
      break;
    case 'highway':
    default:
      pool = all.filter(v => !v.isTruck);
      break;
  }
  if (pool.length < 3) pool = all;
  const poolSize = 3 + Math.floor(Math.random() * 3);
  return _shuffle(pool).slice(0, poolSize).map(v => {
    const spec = [v.body, v.seats ? `${v.seats} seats` : null, v.engine].filter(Boolean).join(', ');
    return Object.assign({}, v, {
      condition: 30 + Math.floor(Math.random() * 66),
      img: `Graphics/pixel_cars/cars${String(Math.ceil(v.imgIdx/10)).padStart(2,'0')}.png`,
      frameX: ((v.imgIdx-1) % 10) * 64,
      spec,
    });
  });
}

/**
 * pickVehicle(pool)
 * Picks one vehicle at random from a pool.
 * Adds a random condition value (30-95).
 */
function pickVehicle(pool) {
  const v = pool[Math.floor(Math.random() * pool.length)];
  const idxStr = String(v.imgIdx).padStart(2, '0');
  const spec = [v.body, v.seats ? `${v.seats} seats` : null, v.engine]
    .filter(Boolean).join(', ');
  return Object.assign({}, v, {
    condition: 30 + Math.floor(Math.random() * 66),
    img: `Graphics/cars/individuals/CAR${idxStr}.BMP`,
    spec,
  });
}

/** Fisher-Yates shuffle (returns new array) */
function _shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}


// ---------------------------------------------------------------------------
// PERSISTENT VEHICLE POOLS
// ---------------------------------------------------------------------------

/** Generate a short random unique ID for a vehicle instance */
function _mkUid() {
  return 'v' + Math.random().toString(36).slice(2, 9);
}

/** Synchronous stealable vehicle list (uses VEHICLES_DATA constant) */
function _stealableVehicles() {
  return VEHICLES_DATA.filter(v => v.price > 0);
}

/** Filter vehicle list by location type */
function _filterByLocType(all, locType) {
  switch (locType) {
    case 'racing':      return all.filter(v => v.isRaceWorthy && !v.isMoto && !v.isTruck);
    case 'residential': return all.filter(v => !v.isMoto && !v.isTruck && v.price <= 40000);
    case 'busy':        return all.filter(v => !v.isMoto && !v.isTruck);
    case 'highway':
    default:            return all.filter(v => !v.isTruck);
  }
}

/** Enrich a raw vehicle entry into a persistent instance with uid, img, condition */
function _enrichVehicle(v, locId) {
  const spec  = [v.body, v.seats ? `${v.seats} seats` : null, v.engine].filter(Boolean).join(', ');
  const sheet = Math.ceil(v.imgIdx / 10);
  return Object.assign({}, v, {
    uid:       _mkUid(),
    locId,
    condition: 30 + Math.floor(Math.random() * 66),
    img:       `Graphics/pixel_cars/cars${String(sheet).padStart(2,'0')}.png`,
    frameX:    ((v.imgIdx - 1) % 10) * 64,
    spec,
  });
}

/** Internal: generate an array of enriched vehicle instances for one location */
function _generatePool(locId, locType, count) {
  const all      = _stealableVehicles();
  let   filtered = _filterByLocType(all, locType);
  if (filtered.length < 3) filtered = all;
  const n = (count != null) ? count : 3 + Math.floor(Math.random() * 3);
  return _shuffle(filtered).slice(0, n).map(v => _enrichVehicle(v, locId));
}

/**
 * initLocationPools(state, locDefs)
 * Populates state.locationPools for every stealable location.
 * Called once on new game start, or if pools are missing on load.
 * locDefs: array of { id, type } — stealable map locations only.
 */
function initLocationPools(state, locDefs) {
  // Additive: only generate pools for locations that don't already have one.
  // Never wipes existing entries so server-synced pools (MP) are preserved.
  if (!state.locationPools) state.locationPools = {};
  for (const loc of locDefs) {
    if (!state.locationPools[loc.id]) {
      state.locationPools[loc.id] = _generatePool(loc.id, loc.type);
    }
  }
  saveState(state);
}

/**
 * refreshLocationPools(state, locDefs)
 * Daily turnover: each vehicle has a 20% chance of leaving.
 * Locations that drop below 2 vehicles are restocked with 1-2 new ones.
 * Called by advanceDay().
 */
function refreshLocationPools(state, locDefs) {
  if (!state.locationPools) { initLocationPools(state, locDefs); return; }
  for (const loc of locDefs) {
    let pool = state.locationPools[loc.id] || [];
    pool = pool.filter(() => Math.random() > 0.20);
    if (pool.length < 2) {
      const toAdd = 2 - pool.length + Math.floor(Math.random() * 2);
      pool.push(..._generatePool(loc.id, loc.type, toAdd));
    }
    state.locationPools[loc.id] = pool;
  }
  // saveState called by advanceDay after this returns
}

/**
 * removeVehicleFromPool(state, locId, uid)
 * Removes a stolen vehicle from its location pool.
 * Called by crime.html on successful theft.
 */
function removeVehicleFromPool(state, locId, uid) {
  if (!state.locationPools || !state.locationPools[locId]) return;
  state.locationPools[locId] = state.locationPools[locId].filter(v => v.uid !== uid);
  saveState(state);
}


// ---------------------------------------------------------------------------
// ITEMS
// ---------------------------------------------------------------------------

const ITEMS_DATA = [
  { index:  1, name:'Beretta 92FS',             id:'pistol',  cat:'weapon',        slot:'weapon',  buy:1200, sell:500  },
  { index:  2, name:'Magnum Baby Eagle',         id:'pistol',  cat:'weapon',        slot:'weapon',  buy:1100, sell:450  },
  { index:  3, name:'Walther P99',               id:'pistol',  cat:'weapon',        slot:'weapon',  buy:1000, sell:400  },
  { index:  4, name:'Remington 300',             id:'rifle',   cat:'weapon',        slot:'weapon',  buy:2200, sell:900  },
  { index:  5, name:'Garmin Streetpilot c330',   cat:'navigation',    slot:'gps_map', buy: 400, sell:150  },
  { index:  6, name:'TomTom GO 910',             cat:'navigation',    slot:'gps_map', buy: 600, sell:250  },
  { index:  7, name:'Radio Scanner BC60XLT-1',   cat:'radio_scanner', slot:'tool',    buy: 500, sell:200  },
  { index:  8, name:'Radio Scanner IC-R3',       cat:'radio_scanner', slot:'tool',    buy: 800, sell:300  },
  { index:  9, name:'Electric Lock-Pick',        cat:'lock_pick',     slot:'tool',    buy: 600, sell:200  },
  { index: 10, name:'Advanced Code Grabber',     cat:'code_grabber',  slot:'tool',    buy:2500, sell:1000 },
  { index: 11, name:'Screwdriver',               cat:'mechanic',      slot:'tool',    buy: 100, sell: 30  },
  { index: 12, name:'Tarpon Bay Combat Knife',   cat:'weapon',        slot:'weapon',  buy: 400, sell:150  },
  { index: 13, name:'Defender II Knife',         cat:'weapon',        slot:'weapon',  buy: 300, sell:100  },
  { index: 14, name:'21-inch Steel Baton',       cat:'weapon',        slot:'weapon',  buy: 250, sell: 80  },
  { index: 15, name:'Brass Knuckles',            cat:'weapon',        slot:'weapon',  buy: 200, sell: 60  },
  { index: 16, name:'Body Armor IIA',            cat:'armor',         slot:'armor',   buy:2500, sell:800  },
  { index: 17, name:'Genesis Body Armor IIIA',   cat:'armor',         slot:'armor',   buy:4000, sell:1500 },
  { index: 18, name:'Basic Code Grabber',        cat:'code_grabber',  slot:'tool',    buy: 800, sell:300  },
  { index: 19, name:'Basic Code Grabber Mk2',    cat:'code_grabber',  slot:'tool',    buy:1200, sell:450  },
  { index: 20, name:'Snap Gun',                  id:'snap_gun',         cat:'lock_pick', slot:'tool', buy: 500, sell:180  },
  { index: 21, name:'Lock Pick Set',             id:'lock_pick_set',    cat:'lock_pick', slot:'tool', buy: 250, sell: 80  },
  { index: 22, name:'Ignition Decoding System',  id:'ignition_decoder', cat:'lock_pick', slot:'tool', buy:3000, sell:1200 },
  { index: 23, name:'Tryout Key Set',            id:'tryout_keys',      cat:'lock_pick', slot:'tool', buy: 150, sell: 50  },
  { index: 24, name:'Professional Pick Set',     id:'pro_pick_set',     cat:'lock_pick', slot:'tool', buy:1200, sell:400  },
  { index: 25, name:'Pump Wedge',                id:'pump_wedge',       cat:'lock_pick', slot:'tool', buy: 350, sell:100  },
  { index: 26, name:'Slim Jim Kit',              id:'slim_jim',         cat:'lock_pick', slot:'tool', buy: 200, sell: 60  },
  { index: 27, name:'IMI Micro UZI',             id:'rifle',   cat:'weapon',        slot:'weapon',  buy:3500, sell:1400 },
  { index: 28, name:'Glock 17',                  id:'pistol',  cat:'weapon',        slot:'weapon',  buy: 900, sell:350  },
  { index: 29, name:'Stun Gun SM-625',           cat:'weapon',        slot:'weapon',  buy: 600, sell:200  },
  { index: 30, name:'Stun Baton SM-500',         cat:'weapon',        slot:'weapon',  buy: 500, sell:160  },
  { index: 31, name:'Air Taser Gun M18L',        cat:'weapon',        slot:'weapon',  buy: 800, sell:300  },
  { index: 32, name:'The Buster',                cat:'cutting',       slot:'tool',    buy: 300, sell:100  },
  { index: 33, name:'Razor Blade',               cat:'other',         slot:'tool',    buy:  50, sell: 10  },
  { index: 34, name:'Wire Cutter',               id:'wire_cutter',   cat:'wiring', slot:'tool', buy: 200, sell: 60  },
  { index: 35, name:'Wire Stripper and Cutter',  id:'wire_stripper', cat:'wiring', slot:'tool', buy: 300, sell:100  },
  { index: 36, name:'Ball Bearing Nunchaku',     cat:'weapon',        slot:'weapon',  buy: 300, sell:100  },
  { index: 37, name:'Halogen Probelight',        id:'probelight',  cat:'wiring', slot:'tool', buy: 450, sell:150  },
  { index: 38, name:'Digital Multimeter',        id:'multimeter',  cat:'wiring', slot:'tool', buy: 350, sell:100  },
  { index: 39, name:'Utility Blade',             cat:'other',         slot:'tool',    buy:  50, sell: 10  },
  { index: 40, name:'RF Jammer',                 cat:'gps_jammer',    slot:'jammer',  buy:1500, sell:500  },
  { index: 41, name:'Radio Scanner',             cat:'radio_scanner', slot:'tool',    buy: 600, sell:200  },
  { index: 42, name:'M96 Recon Carbine',         id:'rifle',   cat:'weapon',        slot:'weapon',  buy:4500, sell:1800 },
  { index: 43, name:'Mossberg 590 Cruiser',      id:'shotgun', cat:'weapon',        slot:'weapon',  buy:1800, sell:700  },
  { index: 44, name:'Hammer',                    cat:'cutting',       slot:'tool',    buy: 150, sell: 40  },

  // ── Drug packages (Phase 2) ────────────────────────────────────────────────
  { index: 45, name:'Weed (Small)',              cat:'drug', slot:'drug', buy:   60, sell:  30, sellMid:   250 },
  { index: 46, name:'Weed (Large)',              cat:'drug', slot:'drug', buy:  120, sell:  60, sellMid:   500 },
  { index: 47, name:'Ecstasy (Small)',           cat:'drug', slot:'drug', buy:  300, sell: 150, sellMid:  1150 },
  { index: 48, name:'Ecstasy (Large)',           cat:'drug', slot:'drug', buy:  600, sell: 300, sellMid:  2250 },
  { index: 49, name:'Shrooms (Small)',           cat:'drug', slot:'drug', buy:  400, sell: 200, sellMid:  1600 },
  { index: 50, name:'Shrooms (Large)',           cat:'drug', slot:'drug', buy:  800, sell: 400, sellMid:  3200 },
  { index: 51, name:'Cocaine (Small)',           cat:'drug', slot:'drug', buy: 1500, sell: 750, sellMid:  5750 },
  { index: 52, name:'Cocaine (Large)',           cat:'drug', slot:'drug', buy: 3000, sell:1500, sellMid: 11500 },
  { index: 53, name:'Heroin (Small)',            cat:'drug', slot:'drug', buy: 2500, sell:1250, sellMid:  9750 },
  { index: 54, name:'Heroin (Large)',            cat:'drug', slot:'drug', buy: 5000, sell:2500, sellMid: 19500 },
];

// ---------------------------------------------------------------------------
// HOUSES
// ---------------------------------------------------------------------------

/**
 * HOUSE_DATA — 28 entries matching Graphics/houses/house01–18 + house50–60.
 * tier: 'low' | 'mid' | 'high'  (determines loot table on successful burglary)
 * label: displayed in the panel detail view
 */
const HOUSE_DATA = [
  { index:  1, img:'Graphics/houses/house01.png', tier:'low',  label:'Small Bungalow'    },
  { index:  2, img:'Graphics/houses/house02.png', tier:'low',  label:'Corner Cottage'    },
  { index:  3, img:'Graphics/houses/house03.png', tier:'low',  label:'Row House'         },
  { index:  4, img:'Graphics/houses/house04.png', tier:'low',  label:'Duplex'            },
  { index:  5, img:'Graphics/houses/house05.png', tier:'low',  label:'Studio Flat'       },
  { index:  6, img:'Graphics/houses/house06.png', tier:'low',  label:'Terraced House'    },
  { index:  7, img:'Graphics/houses/house07.png', tier:'mid',  label:'Ranch House'       },
  { index:  8, img:'Graphics/houses/house08.png', tier:'mid',  label:'Split-Level Home'  },
  { index:  9, img:'Graphics/houses/house09.png', tier:'mid',  label:'Colonial House'    },
  { index: 10, img:'Graphics/houses/house10.png', tier:'mid',  label:'Craftsman Home'    },
  { index: 11, img:'Graphics/houses/house11.png', tier:'mid',  label:'Cape Cod'          },
  { index: 12, img:'Graphics/houses/house12.png', tier:'mid',  label:'Tudor Home'        },
  { index: 13, img:'Graphics/houses/house13.png', tier:'high', label:'Modern Villa'      },
  { index: 14, img:'Graphics/houses/house14.png', tier:'high', label:'Executive Home'    },
  { index: 15, img:'Graphics/houses/house15.png', tier:'high', label:'Gated Estate'      },
  { index: 16, img:'Graphics/houses/house16.png', tier:'high', label:'Luxury Townhouse'  },
  { index: 17, img:'Graphics/houses/house17.png', tier:'high', label:'Penthouse Suite'   },
  { index: 18, img:'Graphics/houses/house18.png', tier:'high', label:'Manor House'       },
  { index: 50, img:'Graphics/houses/house50.png', tier:'low',  label:'Rundown Flat'      },
  { index: 51, img:'Graphics/houses/house51.png', tier:'low',  label:'Old Bungalow'      },
  { index: 52, img:'Graphics/houses/house52.png', tier:'mid',  label:'Brick House'       },
  { index: 53, img:'Graphics/houses/house53.png', tier:'mid',  label:'Suburban Home'     },
  { index: 54, img:'Graphics/houses/house54.png', tier:'mid',  label:'Semi-Detached'     },
  { index: 55, img:'Graphics/houses/house55.png', tier:'mid',  label:'Garden House'      },
  { index: 56, img:'Graphics/houses/house56.png', tier:'high', label:'Hillside Villa'    },
  { index: 57, img:'Graphics/houses/house57.png', tier:'high', label:'Corner Estate'     },
  { index: 58, img:'Graphics/houses/house58.png', tier:'high', label:'Restored Mansion'  },
  { index: 59, img:'Graphics/houses/house59.png', tier:'high', label:'Lakefront Home'    },
  { index: 60, img:'Graphics/houses/house60.png', tier:'high', label:'Hilltop Retreat'   },
];

const LOOT_TIERS = {
  low:  [55, 56, 57, 58],
  mid:  [55, 56, 57, 58, 59, 60, 61, 62],
  high: [59, 60, 61, 62, 63, 64, 65],
};

/**
 * _generateHousePool(locId)
 * Returns 3–6 random house entries for a residential location.
 * Weighted toward lower tiers (more common houses).
 */
function _generateHousePool(locId) {
  const tickets = [];
  for (const h of HOUSE_DATA) {
    const w = h.tier === 'low' ? 4 : h.tier === 'mid' ? 2 : 1;
    for (let i = 0; i < w; i++) tickets.push(h.index);
  }
  const count = 3 + Math.floor(Math.random() * 4); // 3–6
  const picked = new Set();
  let attempts = 0;
  while (picked.size < count && attempts < 200) {
    picked.add(tickets[Math.floor(Math.random() * tickets.length)]);
    attempts++;
  }
  return [...picked].map(idx => Object.assign({}, HOUSE_DATA.find(h => h.index === idx), { locId }));
}

/**
 * initHousePools(state, locDefs)
 * Populates state.housePools for every residential location.
 * Additive — never overwrites existing entries.
 */
function initHousePools(state, locDefs) {
  if (!state.housePools) state.housePools = {};
  for (const loc of locDefs) {
    if (loc.type === 'residential' && !state.housePools[loc.id]) {
      state.housePools[loc.id] = _generateHousePool(loc.id);
    }
  }
  saveState(state);
}

/**
 * refreshHousePools(state, locDefs)
 * Daily turnover: 20% chance each house leaves. Replenish below 2.
 * Called by advanceDay().
 */
function refreshHousePools(state, locDefs) {
  if (!state.housePools) { initHousePools(state, locDefs); return; }
  for (const loc of locDefs) {
    if (loc.type !== 'residential') continue;
    let pool = state.housePools[loc.id] || [];
    pool = pool.filter(() => Math.random() > 0.20);
    if (pool.length < 2) {
      const fresh = _generateHousePool(loc.id);
      const toAdd = 2 - pool.length + Math.floor(Math.random() * 2);
      pool.push(...fresh.slice(0, toAdd));
    }
    state.housePools[loc.id] = pool;
  }
}

/**
 * resolveBurglary(state, houseIndex)
 * Rolls 1–3 loot items from the house's tier table and adds them to inventory.
 * Returns array of item objects added (for display in crime.html result message).
 */
function resolveBurglary(state, houseIndex) {
  const house = HOUSE_DATA.find(h => h.index === houseIndex);
  if (!house) return [];
  const tier = house.tier || 'low';
  const pool = LOOT_TIERS[tier] || LOOT_TIERS.low;
  const count = 1 + Math.floor(Math.random() * 3); // 1–3 items
  if (!state.inventory) state.inventory = [];
  const added = [];
  for (let i = 0; i < count; i++) {
    if (state.inventory.length >= 12) break;
    const idx = pool[Math.floor(Math.random() * pool.length)];
    const item = ITEMS_DATA.find(it => it.index === idx);
    if (item) {
      state.inventory.push({ index: item.index, name: item.name, cat: item.cat, slot: item.slot, sell: item.sell });
      added.push(item);
    }
  }
  saveState(state);
  return added;
}

/**
 * getItem(index)
 * Returns the item definition for a given 1-based index, or null.
 */
function getItem(index) {
  return ITEMS_DATA.find(i => i.index === index) || null;
}

/**
 * makeInventoryItem(index)
 * Returns a full inventory item object ready to push into state.inventory.
 * img uses STOOL (medium) for backpack display.
 */
function makeInventoryItem(index) {
  const def = getItem(index);
  if (!def) return null;
  const n = String(index).padStart(2, '0');
  return {
    index,
    id:    def.id,
    label: def.name,
    cat:   def.cat,
    slot:  def.slot,
    buy:   def.buy,
    sell:  def.sell,
    img:   def.cat === 'drug'
             ? `Graphics/drugs/${def.name.replace(/\s*\((\w+)\)/, '_$1').toLowerCase()}.png`
             : `Graphics/items_medium/STOOL${n}.bmp`,
  };
}

/**
 * addItemToInventory(state, index)
 * Adds one item to state.inventory if there's a free slot (max 12).
 * Returns true on success, false if full or invalid.
 */
function addItemToInventory(state, index) {
  if (state.inventory.length >= 12) return false;
  const item = makeInventoryItem(index);
  if (!item) return false;
  state.inventory.push(item);
  saveState(state);
  return true;
}

/**
 * removeItemFromInventory(state, slotIndex)
 * Removes the item at inventory[slotIndex].
 */
function removeItemFromInventory(state, slotIndex) {
  state.inventory.splice(slotIndex, 1);
  saveState(state);
}

// ---------------------------------------------------------------------------
// SHOP STOCK
// ---------------------------------------------------------------------------

/**
 * _generateShopStock()
 * Returns an array of 15-20 item indices for a shop visit.
 *
 * Weighting:
 *   - Cheap items (buy <= 400)  : 3 tickets each  — common
 *   - Mid items  (buy <= 1500)  : 2 tickets each  — occasional
 *   - Expensive  (buy >  1500)  : 1 ticket each   — rare
 *
 * Guarantees at least 1 item from each of these categories if available:
 *   lock_pick, wiring, cutting, weapon, armor
 */
function _generateShopStock() {
  const all = ITEMS_DATA.filter(i => i.cat !== 'drug');

  // Build weighted ticket pool
  const tickets = [];
  for (const item of all) {
    const weight = item.buy <= 400 ? 3 : item.buy <= 1500 ? 2 : 1;
    for (let i = 0; i < weight; i++) tickets.push(item.index);
  }

  const stockSize = 15 + Math.floor(Math.random() * 6); // 15–20
  const picked = new Set();

  // Guarantee one item per key category
  const guaranteed = ['lock_pick', 'wiring', 'cutting', 'weapon', 'armor'];
  for (const cat of guaranteed) {
    const candidates = all.filter(i => i.cat === cat);
    if (candidates.length) {
      const choice = candidates[Math.floor(Math.random() * candidates.length)];
      picked.add(choice.index);
    }
  }

  // Fill remaining slots from weighted pool
  let attempts = 0;
  while (picked.size < stockSize && attempts < 500) {
    picked.add(tickets[Math.floor(Math.random() * tickets.length)]);
    attempts++;
  }

  return _shuffle([...picked]);
}

/**
 * initShopStock(state)
 * Sets state.shopStock from a fresh generation. Called by initState and advanceDay.
 * Does NOT call saveState — caller is responsible.
 */
function initShopStock(state) {
  state.shopStock = _generateShopStock();
}

/**
 * assignVehicleToTeam(state, vehicle)
 * Auto-assigns a stolen/won vehicle to the first empty active slot.
 * Slot 0 (primary) first, then slot 1 (secondary). If both full → garage.
 * Returns 'primary' | 'secondary' | 'garage'.
 */
function assignVehicleToTeam(state, vehicle) {
  if (!Array.isArray(state.activeVehicles)) state.activeVehicles = [];
  if (!state.activeVehicles[0]) {
    state.activeVehicles[0] = vehicle;
    return 'primary';
  }
  if (!state.activeVehicles[1]) {
    state.activeVehicles[1] = vehicle;
    return 'secondary';
  }
  if (!Array.isArray(state.garage)) state.garage = [];
  if (state.garage.length < 6) state.garage.push(vehicle);
  return 'garage';
}

// ---------------------------------------------------------------------------
// ARREST PENALTIES
// ---------------------------------------------------------------------------

/**
 * applyArrestPenalties(state)
 * Called when the player is busted. Applies fine, item seizure, wanted level bump.
 *
 * Fine:       $500 base + $250 per prior arrest, capped at $5,000
 * Seizure:    1 random inventory item if arrests < 3, else 2
 * Cash/debt:  fine deducted from cash; if cash goes negative, deficit added to debt
 * wantedLevel: bumped +1 per arrest, max 5
 *
 * Returns { fine, seized, debtIncrease } for the arrest screen to display.
 */
function applyArrestPenalties(state) {
  const priorArrests = (state.arrests || 0) - 1; // arrests already incremented by crime.html
  const fine = Math.min(500 + priorArrests * 250, 5000);

  // Confiscate items
  const seizeCount = priorArrests >= 2 ? 2 : 1;
  const seized = [];
  for (let i = 0; i < seizeCount; i++) {
    if (!state.inventory.length) break;
    const slot = Math.floor(Math.random() * state.inventory.length);
    seized.push(state.inventory[slot]);
    state.inventory.splice(slot, 1);
  }

  // Deduct fine
  let debtIncrease = 0;
  state.cash -= fine;
  if (state.cash < 0) {
    debtIncrease = Math.abs(state.cash);
    state.debt  += debtIncrease;
    state.cash   = 0;
  }

  // Bump wanted level (max 5)
  state.wantedLevel = Math.min((state.wantedLevel || 0) + 1, 5);

  saveState(state);
  return { fine, seized, debtIncrease };
}


// ---------------------------------------------------------------------------
// RACING
// ---------------------------------------------------------------------------

const RACE_TOTAL_DIST   = 100;   // abstract distance units to finish line
const RACE_CHECKPOINTS  = [33, 66];
const RACE_POLICE_RISE  = [5, 8]; // min/max per turn

/**
 * initRace(state, playerVehicle, opponentVehicle)
 * Sets up gs.currentRace and saves state. Called before navigating to race.html.
 */
function initRace(state, playerVehicle, opponentVehicle) {
  state.currentRace = {
    playerVehicle,
    opponentVehicle,
    playerDist:        0,
    oppDist:           0,
    checkpointsPassed: 0,   // number of checkpoints the player has passed
    policeAwareness:   0,
    policeReadiness:   22,  // CT6 default starting value
    turn:              0,
    finished:          false,
    winner:            null,  // 'player' | 'opponent'
  };
  saveState(state);
}

/**
 * resolveRaceTurn(state)
 * Advances one turn of the race. Mutates state.currentRace in place.
 * Returns { log, checkpointHit, drivingGain, finished, winner }
 */
function resolveRaceTurn(state) {
  const race = state.currentRace;
  if (!race || race.finished) return null;

  const log          = [];
  let   checkpointHit = false;
  let   drivingGain   = false;

  race.turn++;

  // ── Player advance ──────────────────────────────────────────────────────
  // Base gain 8–12; bonus up to +6 from Driving stat (scaled 0–100)
  const drivingStat  = (state.stats.driving.val || 10);
  const playerGain   = 8 + Math.floor(Math.random() * 5) + Math.floor(drivingStat / 20);
  race.playerDist    = Math.min(RACE_TOTAL_DIST, race.playerDist + playerGain);

  const pv = race.playerVehicle;
  log.push({ text: `Player Group Alpha is riding ahead in ${pv.name}...`, style: 'dim' });
  log.push({ text: `[${state.playerName} uses driving]`, style: 'skill' });

  // ── Opponent advance ────────────────────────────────────────────────────
  // Opponent speed stat (0–100) scaled to gain range 6–14
  const ov           = race.opponentVehicle;
  const oppSpeed     = Math.max(10, ov.speed || 50);
  const oppGain      = 6 + Math.floor(Math.random() * 5) + Math.floor(oppSpeed / 14);
  race.oppDist       = Math.min(RACE_TOTAL_DIST, race.oppDist + oppGain);

  log.push({ text: `Enemy Group Alpha is advancing in ${ov.name}...`, style: 'dim' });

  // ── Distance comparison ─────────────────────────────────────────────────
  const delta = race.playerDist - race.oppDist;
  if (delta > 0) {
    log.push({ text: `You've left your opponent ${delta} meters behind.`, style: 'good' });
  } else if (delta < 0) {
    log.push({ text: `Your opponent is ${-delta} meters ahead.`, style: 'bad' });
  } else {
    log.push({ text: `You're neck and neck.`, style: 'neutral' });
  }

  // ── Checkpoints ─────────────────────────────────────────────────────────
  const nextCp = RACE_CHECKPOINTS[race.checkpointsPassed];
  if (nextCp !== undefined && race.playerDist >= nextCp) {
    race.checkpointsPassed++;
    checkpointHit = true;
    drivingGain   = true;
    state.stats.driving.val = Math.min(state.stats.driving.max,
                                       state.stats.driving.val + 1);
    log.push({ text: `Passing through checkpoint ${race.checkpointsPassed}...`, style: 'neutral' });
    log.push({ text: `You have gained +1 to driving.`, style: 'good' });
  }

  // ── Police ──────────────────────────────────────────────────────────────
  const policeRise = RACE_POLICE_RISE[0] +
    Math.floor(Math.random() * (RACE_POLICE_RISE[1] - RACE_POLICE_RISE[0] + 1));
  race.policeAwareness = Math.min(100, race.policeAwareness + policeRise);

  // ── Finish check ─────────────────────────────────────────────────────────
  // Whoever crosses 100 first wins. If both cross same turn, player wins ties.
  if (race.playerDist >= RACE_TOTAL_DIST || race.oppDist >= RACE_TOTAL_DIST) {
    race.finished = true;
    log.push({ text: `Passing through the finish line...`, style: 'neutral' });

    if (race.playerDist >= race.oppDist) {
      race.winner = 'player';
      log.push({ text: `You've left your rival ${Math.max(0, race.playerDist - race.oppDist)} meters behind.`, style: 'good' });
      log.push({ text: `You have won ${ov.name}!`, style: 'good' });
    } else {
      race.winner = 'opponent';
      log.push({ text: `Your opponent crosses the line first.`, style: 'bad' });
      log.push({ text: `You have lost ${pv.name}.`, style: 'bad' });
    }
    log.push({ text: `[The action has ended]`, style: 'neutral' });
  }

  saveState(state);
  return { log, checkpointHit, drivingGain, finished: race.finished, winner: race.winner };
}

/**
 * resolveRaceWin(state)
 * Called after race.winner === 'player'. Grants opponent vehicle.
 */
function resolveRaceWin(state) {
  const race = state.currentRace;
  if (!race) return;
  const won = race.opponentVehicle;
  if (!state.garage) state.garage = [];
  if (state.garage.length < 12) state.garage.push(won);
  state.currentRace = null;
  saveState(state);
}

/**
 * resolveRaceLoss(state)
 * Called after race.winner === 'opponent'. Removes player's active vehicle.
 * 25% chance the cheaper car ends up in the dealer lot (opponent sold it).
 */
function resolveRaceLoss(state) {
  const race = state.currentRace;
  if (!race) return;
  const lost = state.activeVehicles && state.activeVehicles[0];
  if (state.activeVehicles) state.activeVehicles[0] = null;
  if (lost && Math.random() < 0.25) {
    if (!state.dealerLot) state.dealerLot = [];
    state.dealerLot.push(lost);
  }
  state.currentRace = null;
  saveState(state);
}


// ---------------------------------------------------------------------------
// CITY SYSTEM
// ---------------------------------------------------------------------------

/** Pick a random integer in [min, max] inclusive */
function _randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

/**
 * MAP_SLOTS
 * 36 pre-spaced positions (% of map area) covering the playable map.
 * Shuffled per city generation so icon placement looks organic but never overlaps.
 * Positions avoid extreme edges (min ~8%, max ~92%) and are spaced ~12% apart.
 */
const MAP_SLOTS = [
  {x:12,y:12},{x:25,y:12},{x:40,y:12},{x:55,y:12},{x:70,y:12},{x:85,y:12},
  {x:12,y:26},{x:25,y:26},{x:40,y:26},{x:55,y:26},{x:70,y:26},{x:85,y:26},
  {x:12,y:40},{x:25,y:40},{x:40,y:40},{x:55,y:40},{x:70,y:40},{x:85,y:40},
  {x:12,y:54},{x:25,y:54},{x:40,y:54},{x:55,y:54},{x:70,y:54},{x:85,y:54},
  {x:12,y:68},{x:25,y:68},{x:40,y:68},{x:55,y:68},{x:70,y:68},{x:85,y:68},
  {x:12,y:82},{x:25,y:82},{x:40,y:82},{x:55,y:82},{x:70,y:82},{x:85,y:82},
];

/**
 * _generateCityLocations(cityId)
 * Rolls all locations for one city using the shared MAP_SLOTS pool.
 * Slots are shuffled so placement looks organic and never overlaps.
 */
function _generateCityLocations(cityId) {
  const locs = [];
  const stealableTypes = ['highway','residential','busy','racing'];
  const slots = _shuffle(MAP_SLOTS.slice()); // fresh shuffled copy each city
  let slotIdx = 0;

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
// DRUG DEALING
// ---------------------------------------------------------------------------

/**
 * DEALER_NPC_POOL
 * One named dealer NPC per city. Persistent across location cycling —
 * favor survives the map icon going off and back on.
 * portrait: reuse existing enemy BMP assets as placeholders.
 */
const DEALER_NPC_POOL = [
  { id:'dnpc_las_vegas',    name:'Slick',   cityId:'las_vegas',    portrait:'Graphics/enemies/ENEMY01.BMP', favor:0 },
  { id:'dnpc_los_angeles',  name:'Cortez',  cityId:'los_angeles',  portrait:'Graphics/enemies/ENEMY02.BMP', favor:0 },
  { id:'dnpc_kansas_city',  name:'Twitchy', cityId:'kansas_city',  portrait:'Graphics/enemies/ENEMY03.BMP', favor:0 },
  { id:'dnpc_houston',      name:'Rooster', cityId:'houston',      portrait:'Graphics/enemies/ENEMY04.BMP', favor:0 },
  { id:'dnpc_miami',        name:'Lito',    cityId:'miami',        portrait:'Graphics/enemies/ENEMY05.BMP', favor:0 },
  { id:'dnpc_boston',       name:'Murph',   cityId:'boston',       portrait:'Graphics/enemies/ENEMY06.BMP', favor:0 },
  { id:'dnpc_philadelphia', name:'Dozer',   cityId:'philadelphia', portrait:'Graphics/enemies/ENEMY07.BMP', favor:0 },
];

/**
 * initDealerNPCs(state)
 * Called once from initState(). Populates state.dealerNPCs from DEALER_NPC_POOL.
 * Safe to call on old saves — skips if already populated.
 */
function initDealerNPCs(state) {
  if (!Array.isArray(state.dealerNPCs)) state.dealerNPCs = [];
  if (state.dealerNPCs.length >= DEALER_NPC_POOL.length) return; // already seeded
  state.dealerNPCs = DEALER_NPC_POOL.map(d => Object.assign({}, d));
}

/**
 * getDealerStock(state, dealerNpcId)
 * Generates a fresh daily stock list for the given dealer NPC.
 * Returns array of { itemIndex, qty, price }.
 *
 * Favor gates available tiers:
 *   0–30:  weed, ecstasy, shrooms only (indices 45–50)
 *   31–60: adds cocaine (51–52)
 *   61+:   full roster (53–54 heroin unlocked)
 *
 * Price = buy cost * (0.9 + rand * 0.4), further reduced by favor:
 *   each 10 favor points shaves ~1% off price (max ~7% discount at favor 70+).
 */
function getDealerStock(state, dealerNpcId) {
  const npc = (state.dealerNPCs || []).find(d => d.id === dealerNpcId);
  const favor = npc ? (npc.favor || 0) : 0;

  // Build available item index pool based on favor tier
  let pool = [45,46,47,48,49,50]; // base: weed, ecstasy, shrooms
  if (favor >= 31) pool = pool.concat([51,52]); // cocaine
  if (favor >= 61) pool = pool.concat([53,54]); // heroin

  const stockSize = 3 + Math.floor(Math.random() * 4); // 3–6 slots
  const picked = [];
  const used = new Set();

  let attempts = 0;
  while (picked.length < stockSize && attempts < 100) {
    attempts++;
    const idx = pool[Math.floor(Math.random() * pool.length)];
    if (used.has(idx)) continue;
    used.add(idx);
    const def = getItem(idx);
    if (!def) continue;
    const favorDiscount = 1 - Math.min(favor, 70) * 0.001; // up to ~7% off
    const rngMark = 0.9 + Math.random() * 0.4;
    const price = Math.floor(def.buy * rngMark * favorDiscount);
    picked.push({ itemIndex: idx, qty: 1 + Math.floor(Math.random() * 3), price });
  }
  return picked;
}

/**
 * assignToDealing(state, contactId, locId)
 * Assigns a hired contact (or 'player') to a map location for dealing.
 * Creates a record in state.drugDealing[].
 * Returns { ok, msg }.
 */
function assignToDealing(state, contactId, locId) {
  let person = null;
  if (contactId === 'player') {
    person = { id: 'player', name: state.playerName || 'You', status: 'hired' };
  } else {
    person = (state.contacts || []).find(c => c.id === contactId);
  }
  if (!person)                   return { ok:false, msg:'Person not found.' };
  if (person.status !== 'hired') return { ok:false, msg:`${person.name} is not available.` };

  const already = (state.drugDealing || []).find(r => r.contactId === contactId);
  if (already) return { ok:false, msg:`${person.name} is already assigned somewhere.` };

  const locs = getCityLocations(state);
  const loc  = locs.find(l => l.id === locId);
  if (!loc)  return { ok:false, msg:'Location not found.' };

  if (!state.drugDealing) state.drugDealing = [];
  state.drugDealing.push({ contactId, locId, role:'deal' });
  if (contactId !== 'player') person.assignedLocation = locId;

  saveState(state);
  return { ok:true, msg:`${person.name} assigned to deal at ${loc.label}.` };
}

/**
 * recallFromDealing(state, contactId)
 * Removes the dealing assignment for a contact.
 * Returns { ok, msg }.
 */
function recallFromDealing(state, contactId) {
  if (!state.drugDealing) return { ok:false, msg:'No assignments.' };
  const idx = state.drugDealing.findIndex(r => r.contactId === contactId);
  if (idx === -1) return { ok:false, msg:'This person has no dealing assignment.' };

  state.drugDealing.splice(idx, 1);
  if (contactId !== 'player') {
    const c = (state.contacts || []).find(c => c.id === contactId);
    if (c) c.assignedLocation = null;
  }

  saveState(state);
  const name = contactId === 'player'
    ? (state.playerName || 'You')
    : ((state.contacts || []).find(c => c.id === contactId) || {}).name || contactId;
  return { ok:true, msg:`${name} recalled from dealing.` };
}

/**
 * resolveDealingIncome(state)
 * Called inside advanceDay(). Processes all dealing assignments for one night.
 * Returns array of log strings for the day message.
 */
function resolveDealingIncome(state) {
  if (!state.drugDealing || !state.drugDealing.length) return [];
  const log  = [];
  const locs = [];
  for (const city of Object.values(state.cities || {})) {
    if (city.locations) locs.push(...city.locations);
  }

  // Group assignments by locId to detect solo vs group
  const byLoc = {};
  for (const rec of state.drugDealing) {
    if (!byLoc[rec.locId]) byLoc[rec.locId] = [];
    byLoc[rec.locId].push(rec);
  }

  for (const rec of state.drugDealing) {
    const loc       = locs.find(l => l.id === rec.locId);
    const dealRisk  = loc ? (loc.dealRisk || 10) : 10;
    const groupSize = byLoc[rec.locId].length;
    const isSolo    = groupSize === 1;

    let personInv, personStats, personName;
    if (rec.contactId === 'player') {
      personInv   = state.inventory;
      personStats = state.stats;
      personName  = state.playerName || 'You';
    } else {
      const c = (state.contacts || []).find(c => c.id === rec.contactId);
      if (!c) continue;
      personInv   = c.inventory || [];
      personStats = c.stats     || {};
      personName  = c.name;
    }

    const drugs = personInv.filter(i => i.slot === 'drug');
    if (!drugs.length) {
      log.push(`${personName} has no drugs to sell.`);
      continue;
    }

    // ── Robbery check (solo only) ──────────────────────────────────────
    const robChance = isSolo ? Math.floor(dealRisk * 0.6) : 0;
    if (robChance > 0 && Math.floor(Math.random() * 100) < robChance) {
      if (rec.contactId === 'player') {
        state.inventory = state.inventory.filter(i => i.slot !== 'drug');
      } else {
        const c = (state.contacts || []).find(c => c.id === rec.contactId);
        if (c) c.inventory = (c.inventory || []).filter(i => i.slot !== 'drug');
      }
      log.push(`${personName} was robbed! Lost all drugs. No income tonight.`);
      continue;
    }

    // ── Income roll ────────────────────────────────────────────────────
    const charisma   = (personStats.acting && personStats.acting.val) || 10;
    const charmMod   = 0.8 + (charisma / 100) * 0.4;
    const groupBonus = isSolo ? 0.9 : 1.1;
    let   totalIncome = 0;
    const soldIndices = [];

    for (let i = 0; i < drugs.length; i++) {
      if (Math.random() < 0.5) continue; // ~50% chance each package sells per night
      const def = getItem(drugs[i].index);
      if (!def || !def.sellMid) continue;
      const rngMod = 0.75 + Math.random() * 0.75;
      totalIncome += Math.floor(def.sellMid * charmMod * rngMod * groupBonus);
      soldIndices.push(i);
    }

    // Remove sold packages — map back to full inventory positions
    if (soldIndices.length) {
      const invRef = rec.contactId === 'player'
        ? state.inventory
        : ((state.contacts || []).find(c => c.id === rec.contactId) || {}).inventory || [];
      const drugSlots = invRef.reduce((acc, item, idx) => {
        if (item.slot === 'drug') acc.push(idx);
        return acc;
      }, []);
      const toRemove = soldIndices.map(si => drugSlots[si]).filter(x => x !== undefined);
      for (const idx of toRemove.slice().reverse()) invRef.splice(idx, 1);
    }

    if (totalIncome > 0) {
      state.cash += totalIncome;
      log.push(`${personName} earned $${totalIncome.toLocaleString()} dealing (${soldIndices.length} package${soldIndices.length !== 1 ? 's' : ''} sold).`);
    } else {
      log.push(`${personName} sold nothing tonight.`);
    }

    // ── Arrest check ──────────────────────────────────────────────────
    const arrestChance = groupSize > 1 ? Math.floor(dealRisk * 1.4) : dealRisk;
    if (Math.floor(Math.random() * 100) < arrestChance) {
      if (rec.contactId === 'player') {
        state.inventory  = state.inventory.filter(i => i.slot !== 'drug');
        state.wantedLevel = Math.min(3, (state.wantedLevel || 0) + 1);
        log.push(`${personName} was arrested! Drugs confiscated. Strike ${state.wantedLevel}/3.`);
        if (state.wantedLevel >= 3) {
          state.threeStrikeFlag = true;
          log.push(`⚠️ ${personName} has 3 strikes — consequences incoming.`);
        }
      } else {
        const c = (state.contacts || []).find(c => c.id === rec.contactId);
        if (c) {
          c.inventory = (c.inventory || []).filter(i => i.slot !== 'drug');
          c.strikes   = (c.strikes || 0) + 1;
          log.push(`${personName} was arrested! Drugs confiscated. Strike ${c.strikes}/3.`);
          if (c.strikes >= 3) {
            c.status           = 'prison';
            c.assignedLocation = null;
            state.drugDealing  = state.drugDealing.filter(r => r.contactId !== rec.contactId);
            log.push(`${personName} has 3 strikes and is now in prison.`);
          }
        }
      }
    }
  }

  return log;
}

/**
 * haggleWithDealer(state, dealerNpcId, packageIndex, offeredPrice)
 * Success chance = acting stat + favor bonus, clamped [10, 75].
 * On success: offered price accepted, favor +2.
 * On fail: dealer holds firm.
 * Returns { ok, msg, finalPrice }.
 */
function haggleWithDealer(state, dealerNpcId, packageIndex, offeredPrice) {
  const npc = (state.dealerNPCs || []).find(d => d.id === dealerNpcId);
  if (!npc) return { ok:false, msg:'Dealer not found.', finalPrice: offeredPrice };

  const acting     = (state.stats.acting && state.stats.acting.val) || 10;
  const favorBonus = Math.floor((npc.favor || 0) / 10) * 3;
  const chance     = Math.max(10, Math.min(75, acting + favorBonus));
  const roll       = Math.floor(Math.random() * 100) + 1;

  if (roll <= chance) {
    npc.favor = Math.min(100, (npc.favor || 0) + 2);
    saveState(state);
    return { ok:true, msg:`Haggle successful (${chance}% / rolled ${roll}). Price accepted.`, finalPrice: offeredPrice };
  }
  return { ok:false, msg:`Haggle failed (${chance}% / rolled ${roll}). Dealer holds firm.`, finalPrice: null };
}

/**
 * buyDrugs(state, dealerNpcId, itemIndex, price)
 * Deducts cash, adds drug item to player inventory.
 * Returns { ok, msg }.
 */
function buyDrugs(state, dealerNpcId, itemIndex, price) {
  if (state.cash < price)           return { ok:false, msg:"You don't have enough cash." };
  if (state.inventory.length >= 12) return { ok:false, msg:'Your backpack is full.' };
  const def = getItem(itemIndex);
  if (!def || def.slot !== 'drug')  return { ok:false, msg:'Invalid item.' };

  state.cash -= price;
  const item = makeInventoryItem(itemIndex);
  item.buy   = price; // record actual price paid
  state.inventory.push(item);

  const npc = (state.dealerNPCs || []).find(d => d.id === dealerNpcId);
  if (npc) npc.favor = Math.min(100, (npc.favor || 0) + 1);

  saveState(state);
  return { ok:true, msg:`Bought ${def.name} for $${price.toLocaleString()}.` };
}

/**
 * initCities(state)
 * Called once from initState(). Generates locations for all 7 cities.
 * Saves into state.cities as { cityId: { locations: [...] } }.
 * Does NOT call saveState — initState handles that.
 */
function initCities(state) {
  state.cities = {};
  for (const city of CITIES) {
    state.cities[city.id] = {
      locations: _generateCityLocations(city.id),
    };
  }
}

/**
 * getCityLocations(state)
 * Returns the location array for the player's current city.
 * Safe fallback: regenerates if missing.
 */
function getCityLocations(state) {
  const cityId = state.currentCity || 'las_vegas';
  if (!state.cities || !state.cities[cityId]) {
    if (!state.cities) state.cities = {};
    state.cities[cityId] = { locations: _generateCityLocations(cityId) };
  }
  return state.cities[cityId].locations;
}

/**
 * advanceCityLocations(state)
 * Called by advanceDay(). Ages all non-fixed locations across all cities.
 * Locations that hit their lifespan have a 33% chance to close.
 * When one closes, 50% chance a replacement of the same type spawns.
 * Also cleans up vehicle pools for closed locations.
 * Does NOT call saveState — advanceDay handles that.
 */
function advanceCityLocations(state) {
  if (!state.cities) return;
  const stealableTypes = ['highway','residential','busy','racing'];

  for (const city of CITIES) {
    const cd = state.cities[city.id];
    if (!cd) continue;

    const staying = [];
    const toAdd   = [];

    for (const loc of cd.locations) {
      if (loc.fixed) { staying.push(loc); continue; }

      loc.age = (loc.age || 0) + 1;

      if (loc.age < loc.lifespan) { staying.push(loc); continue; }

      // Reached lifespan — 33% chance to close
      if (Math.random() < 0.33) {
        // Clean up vehicle pool
        if (state.locationPools && loc.id) {
          delete state.locationPools[loc.id];
        }
        // 50% chance a replacement spawns
        if (Math.random() < 0.5) {
          const tpl  = CITY_LOCATION_TEMPLATES[loc.type];
          // Pick a slot not already used by any current location
          const usedSlots = new Set(staying.map(l => `${l.x},${l.y}`));
          const free = MAP_SLOTS.filter(s => !usedSlots.has(`${s.x},${s.y}`));
          const pos  = free.length ? free[Math.floor(Math.random() * free.length)]
                                   : MAP_SLOTS[Math.floor(Math.random() * MAP_SLOTS.length)];
          const existingOfType = cd.locations.filter(l => l.type === loc.type).length;
          toAdd.push({
            id:       stealableTypes.includes(loc.type)
                        ? `${city.id}_${loc.type}_${existingOfType}_${Date.now()}`
                        : null,
            type:     loc.type,
            x:        pos.x,
            y:        pos.y,
            si:       tpl.si,
            label:    tpl.label,
            desc:     tpl.desc,
            fixed:    false,
            lifespan: _randInt(3, 7),
            age:      0,
            dealRisk: _randInt(5, 35),
            hoeRisk:  _randInt(8, 40),
          });
        }
      } else {
        // Survived — reset for another lifespan window
        loc.age      = 0;
        loc.lifespan = _randInt(3, 7);
        staying.push(loc);
      }
    }

    cd.locations = [...staying, ...toAdd];
  }
}

/**
 * travelToCity(state, cityId)
 * Deducts travel cost, switches currentCity. Returns { ok, msg }.
 * Called by airport.html on confirm.
 */
function travelToCity(state, cityId) {
  const TRAVEL_COST = 500;
  if (cityId === state.currentCity) return { ok:false, msg:'You are already in this city.' };
  if (state.cash < TRAVEL_COST) return { ok:false, msg:`Not enough cash. Flight costs $${TRAVEL_COST}.` };
  const dest = CITIES.find(c => c.id === cityId);
  if (!dest) return { ok:false, msg:'Unknown city.' };
  state.cash        -= TRAVEL_COST;
  state.currentCity  = cityId;
  // Ensure city locations exist (should always, but safe fallback)
  if (!state.cities[cityId]) {
    state.cities[cityId] = { locations: _generateCityLocations(cityId) };
  }
  saveState(state);
  return { ok:true, msg:`Flew to ${dest.name}. Flight cost: -$${TRAVEL_COST}.` };
}

function driveToCity(state, cityId) {
  if (cityId === state.currentCity) return { ok:false, msg:"You are already in this city." };
  const av = (state.activeVehicles && state.activeVehicles.find(v => v)) || null;
  if (!av) return { ok:false, msg:"You need an active vehicle to drive." };
  const dest = CITIES.find(c => c.id === cityId);
  if (!dest) return { ok:false, msg:"Unknown city." };
  state.currentCity = cityId;
  if (!state.cities[cityId]) {
    state.cities[cityId] = { locations: _generateCityLocations(cityId) };
  }
  saveState(state);
  return { ok:true, msg:`Drove to ${dest.name}.` };
}
