---
title: A restart takes no new turn once it has checked
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/restart.ts#L231-L246](../../../../packages/server/src/commands/restart.ts#L231-L246) - `checkedRestart`, the turn check"
  - "[code://packages/server/src/commands/run.ts#L895-L912](../../../../packages/server/src/commands/run.ts#L895-L912) - `down`: plugins' `stopping` is awaited, unbounded, before the listeners close"
  - "[code://packages/server/test/server-restart.test.ts](../../../../packages/server/test/server-restart.test.ts) - the restart cases"
---

## Objective

Between an unforced restart's turn check and the host closing, no new turn starts; a client that tries is told the daemon is restarting, so an unforced restart never ends a turn.

## Files

- `UPDATE: packages/server/src/commands/restart.ts:231-246` - the host stops taking turns before the check.
- `UPDATE: packages/sdk/src/host` - whatever lets the daemon tell the host to refuse new turns (find where a turn starts; a refusal with a clear message).
- `UPDATE: packages/server/test/server-restart.test.ts` - the case below.

## Steps

1. Failing case first: a plugin whose `stopping` handler waits on a promise the test controls; request a restart with no turn running, start a turn while `stopping` waits, release it; today the turn is ended by `host.close()`.
2. Before the turn check, put the host into a state that refuses a new turn with "The daemon is restarting". Then check; if a turn is running and the restart is not forced, leave that state and refuse the restart as today.
3. A forced restart takes the same state, so nothing new starts while it closes.

## Validation

- The case fails on `main` and passes after; the existing restart cases still pass.
- `pnpm exec vitest run packages/server/test/server-restart.test.ts packages/server/test/server-cli.test.ts`.

## Resume

Built 2026-10-06.

- The case is in `packages/server/test/server-restart.test.ts`, `refuses a turn started while it stops, rather than having the close end one`. It failed first: a host built in that file over the echo example, one session subscribed, a `checkedRestart` whose hold is `host.refuseTurns`, and a way down whose `stopping` phase waits on a promise the case holds. A turn sent in that window was applied and answered with nothing - the action and its turn went through, and the `host.close()` at the end of the restart is what would have ended it. After the fix the same turn comes back as an `action` envelope with `rejectionReason: 'The daemon is restarting'`.
- Two more cases in the same describe, which pass before and after and hold the fix in place: a turn already running lets the hold go again when the restart is refused because of it, and so do a line that cannot be read and a lifecycle that refuses the restart.
- `checkedRestart` gained a fourth parameter, `hold: (why: string | undefined) => void`, and takes it *before* the line is read - a turn that starts while the file is being read is the same turn the close would end. It is let go on the three ways a restart does not run: an unreadable line, a running turn that is not forced, and a `way.restart` that throws (`A restart is already under way.`, `It is stopping.`). Otherwise it stays held, since the process ends.
- `RESTARTING = 'The daemon is restarting'` is declared in `restart.ts`. The words are the embedder's, which is why the host is handed them rather than inventing them.
- The SDK gained `Host.refuseTurns(why: string | undefined)`, `ctx.refusing` and the refusal in `beginOrRun` - the one road every turn takes, which is why it sits there rather than at the three call sites. `undefined` takes turns again. A turn already running is untouched, and `turning()` still names it. A turn on a session this host is not running yet still starts the session before `beginOrRun` refuses the turn; the client is told, and the close takes the session.
- `users-gate-names.test.ts` needed a `WireTurn` annotation on task 04's fake transcript: it did not typecheck, since that task's validation ran vitest and not `pnpm typecheck`. Cast as `echo` casts its own.
- Seen, not this task: a plain `ahpd stop` has the same window - `down()` awaits the `stopping` handlers before `host.close()` - and takes no hold, so a turn started there is still ended by the close.
- `pnpm typecheck` passes. `packages/server/test/server-restart.test.ts` and `packages/server/test/server-cli.test.ts` pass, 115 tests. `packages/sdk/test` passes, 1438 tests.
