---
title: A disposable machine is made for a session and goes after it - implemented
---

## What exists

- A disposable profile is offered in the picker, and its machine is made when the session starts, labelled `ahpd.session`, `ahpd.owner` and `ahpd.host`.
- The machine goes after the last session that uses it leaves, after its delay, unless picked again; a stray `leave` does not re-arm the timer.
- A machine made for a session counts against `max` and needs `computer:write`. A disposable-alone machine refuses another session, a machine another daemon made, and a session whose owner differs from its own.
- `hostId()` (`packages/server/src/config.ts`) is this daemon's id, kept at `<config>/host-id` at 0600 and handed to plugins as `PluginContext.hostId`. A new id is made only when the file is missing, created with `wx`. An unreadable file, or one that does not hold a UUID, stops the start with a sentence naming it.
- A daemon adopts only the leftovers it made whose session it keeps, and a resumed session counts as a user of its machine. `keptFor` answers `{ session, owner, mine }`.
- `inMachine` (`packages/sdk/src/host.ts`) runs `enter` and `leave` inside a promise and logs a rejection or a synchronous throw.
- The machine listing matches `inspect` rows by name and drops a machine that vanished between `ps` and `inspect`.
- The session folder reaches a machine only where its profile says `sessionFolder`.
- `docs/COMPUTER.md` covers disposable machines, adoption and the create turn.

## Verified

- Three review rounds with probes; every finding has a test that fails without its fix, including the owner check at `createSession` and on the pre-turn change, and the host-id missing, unreadable, corrupt and concurrent-start cases.
- After rebasing onto `52161a8`: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (173 files, 2632 tests) pass.

## Departures

- The rebase met claude/16 and host/41 in `PluginHostPorts` and the loader: `problem` and `sessions` sit side by side.
- The pre-turn change asks `admitted` with the session's stored owner, which is the owner of the work, rather than the connection's principal.
