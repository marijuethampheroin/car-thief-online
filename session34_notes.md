# Session 34 — Dev Notes

## Changes made

### server.js
1. `player_joined` broadcast — added `portraitSrc` and `profession` fields.
   Was: `{ id, name }`
   Now: `{ id, name, portraitSrc, profession }`

2. `pushRoomList()` — added `totalPlayers` computed across ALL rooms (started + lobby),
   filtering only connected players (`p.connected === true`).

3. `get_room_list` handler — same `totalPlayers` logic added inline (initial response
   to the index page WS connection).

### index.html
1. `fetchStats()` — uses `msg.totalPlayers` for the Players Online display.
   Falls back to summing lobby room counts if talking to an old server build.

2. CSS — added `.land-btn-rejoin` (green border, transparent bg, hidden by default).

3. HTML — added `#rejoinBtn` between the Solo and Leaderboard buttons.

4. `updateAuthBar()` — checks `sessionStorage.fbToken` + `localStorage.roomCode`
   + `localStorage.playerId`. Shows rejoinBtn if all three present, hides otherwise.

## Not changed
- play.html — `addPlayerRow()` already renders `p.portraitSrc`; the server was the bug.
- game.html — no changes needed for these issues.

## Bank robberies — status
- Rob tab exists and works in singleplayer (full heist sequence via crime.html).
- MP wiring deferred: `bank_leave`/`bank_success` not handled in server.js or
  game.html's `mpHandleMsg`. Listed in backlog.

## Known issue still open (from handoff)
- Player shown as disconnected during crime.html navigation — needs `page_change`
  message or server-side "game in progress = don't disconnect" logic.
- Chat log not persisted across navigation.
