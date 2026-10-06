---
title: The restart line names `ahpd restart`, and the docs say it
status: done
depends: [task-02-ahpd-restart.md]
layer: "server, docs"
refs:
  - "[code://packages/server/src/commands/plugin.ts#L25](../../../../packages/server/src/commands/plugin.ts#L25) - `RESTART`, the restart line, said at L146, L184, L291 and L359"
  - "[code://docs/DAEMON.md](../../../../docs/DAEMON.md) - start and stop"
---

## Objective

Every "restart the daemon" line says `ahpd restart`, and `docs/DAEMON.md` documents it beside `start` and `stop`.

## Files

- `UPDATE: packages/server/src/commands/plugin.ts` and its tests.
- `UPDATE: docs/DAEMON.md`.

## Steps

1. Change the line and its tests, then write the docs, short and direct, no hard wrap.

## Validation

- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

- `RESTART` in `commands/plugin.ts` is `Restart the daemon to load the change: ahpd restart`, the one line every plugin write says.
- `docs/DAEMON.md`: `ahpd restart` in the commands block; a section after it on the signal and the daemon deciding, the log the command reads, the wait while the old daemon stops and the 25 seconds from its starting line, the receipt line and the five seconds it is waited for, refusals named by signal, a signal that could not be sent, the successor's token read from its line and the configuration now, the quiesce before the successor, one restart at a time with `ahpd stop` winning, the record written and forgotten only by its own daemon or successor, the foreground daemon, ended by either signal, an older record, the same URL only on a fixed port, and `ahpd --remote <url> restart` or `POST /api/restart` from elsewhere with neither falling back to the other; `restart` in the HTTP grants table; the upgrade steps end with `ahpd restart`.
- Tests: `plugin-config.test.ts` "names ahpd restart when a daemon is running" (a live record naming this process, then a set and a disable); `daemon.restart` in the grants case of `server-commands.test.ts`.
- Failed first: the restart line case; no test pinned the old line.
- After the third review of 2026-09-30: `docs/DAEMON.md` says the line and token are read before anything goes down and a failure is refused with the daemon running on, that the old daemon starts nothing new and waits up to five seconds for its processes, that `ahpd stop` forgets only its daemon's record under `daemon.json.lock`, and that a receipt the command gave up on may still be taken.
- After the fourth review of 2026-09-30: `docs/DAEMON.md` says the automation and session stores close after the processes have exited or five seconds have passed.
- After the fifth review of 2026-09-30: the lock's words are gone from `docs/DAEMON.md`, and the receipt is said to be written once the daemon has read its arguments and token.
