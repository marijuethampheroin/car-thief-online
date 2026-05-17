# Classic Mode — Status

Files: classic.html, main.html, classic_crime.html, classic_arrested.html,
       classic_drive.html, classic_airport.html, classic_race.html

---

## File Summaries

**classic.html** — New game setup screen. Player name, portrait picker (6 portraits),
profession selection (6 options), starting city picker (interactive USA map dots).
Calls initState() + navigates to main.html.

**main.html** — Core game hub (~2059 lines). HUD, 3-column layout (left context panel,
city map with clickable icons, right panel with vehicle storage / active team / hideout /
garage). Handles: character view, contact view, vehicle view, store, dealer, bank,
airport panel, dealer NPC, steal pool, race panel, drag-and-drop item system,
contacts modal (4 tabs), modal system, multiplayer WS stub.

**classic_crime.html** — Crime scene screen. Action bar with turn-based actions for
residential/highway/racing/bank scenarios. Police readiness meter, scene image,
left panel (character/contact/vehicle views), right panel (team/target slots).
Handles steal, hijack, and bank robbery flows. On bust -> classic_arrested.html;
on success -> main.html.

**classic_arrested.html** — Post-arrest summary screen. Shows mugshot, penalties
(fine, debt increase, cash remaining), seized items list, wanted stars.
One button back to main.html.

**classic_drive.html** — Drive-to-city screen. USA map with city dots, active vehicle
display with condition bar. Free travel. Navigates back to main.html.

**classic_airport.html** — Fly-to-city screen. USA map with city dots, $500 flight cost.
Navigates back to main.html.

**classic_race.html** — Street race screen. Player vs opponent vehicle display,
race log, turn-based resolution via resolveRaceTurn(). Police awareness + readiness
meters. Win/loss handled by resolveRaceWin/resolveRaceLoss. Navigates back to main.html.

---

## Known Issues / Bugs

- classic_arrested.html: subtitle hardcoded as "LAS VEGAS POLICE DEPARTMENT"
  regardless of current city.

---

## To-Do / Planned Work

- [ ] (add items here as work is planned)

---

## Change Log

| Date       | File(s) | Change                                          |
|------------|---------|-------------------------------------------------|
| 2026-05-17 | all     | Status doc created after reading all classic files |
| 2026-05-17 | classic_drive.html, classic_airport.html, classic_race.html | Fixed all game.html → main.html navigation links |
| 2026-05-17 | classic_drive.html | Added IS_MP / MP_ID / MP_CODE definitions (were missing, caused throw) |
