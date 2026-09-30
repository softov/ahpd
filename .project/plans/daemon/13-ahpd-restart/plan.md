---
title: "`ahpd restart` restarts the daemon in place, and refuses while a turn runs"
domain: daemon
status: planned
priority: high
created: 2026-09-29
revalidated: 2026-09-29
requires: []
decisions:
  - decisions/a-configuration-change-applies-live-or-on-ahpd-restart.md
refs:
  - "[code://packages/server/src/daemon.ts#L8-L24](../../../../packages/server/src/daemon.ts#L8-L24) - `Running`, the record, which holds no argv"
  - "[code://packages/server/src/daemon.ts#L151-L210](../../../../packages/server/src/daemon.ts#L151-L210) - start: detached spawn, the log poll, the record; stop: SIGTERM"
  - "[code://packages/server/src/commands/start.ts#L161-L207](../../../../packages/server/src/commands/start.ts#L161-L207) - `ahpd start` and the argv it forwards"
  - "[code://packages/server/src/commands/stop.ts#L14-L33](../../../../packages/server/src/commands/stop.ts#L14-L33) - `ahpd stop`"
  - "[code://packages/server/src/commands/run.ts#L570-L584](../../../../packages/server/src/commands/run.ts#L570-L584) - the shutdown and its signals"
  - "[code://packages/server/src/commands/plugin.ts#L131-L133](../../../../packages/server/src/commands/plugin.ts#L131-L133) - \"ahpd stop && ahpd start\", which this replaces"
  - "[code://packages/server/src/commands/registry.ts#L38-L57](../../../../packages/server/src/commands/registry.ts#L38-L57) - the local and CLI registries"
---

## Goal

`ahpd restart` at the terminal, or `POST /api/restart` from a client, restarts the daemon with the arguments it was started with, so a change that needs a restart can be applied from where it was made.
It refuses while a turn is running and names the sessions, unless it is given `--force`; sessions resume from the store afterwards.

## Reconnaissance

The files read are the `refs` above.

### Gaps

- No restart exists; the plugin commands say to run `ahpd stop && ahpd start`.
- The record does not hold the arguments the daemon was started with.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A configuration change applies live where the key can, and otherwise on `ahpd restart`](../../../decisions/a-configuration-change-applies-live-or-on-ahpd-restart.md) | 01, 02 |

| What | Source | Task |
| --- | --- | --- |
| A turn running refuses, naming the sessions; `--force` (`force: true` over HTTP) restarts anyway | Softov, 2026-09-29, asked "What should `ahpd restart` do while a turn is running?": "Refuse, --force to go" | 02 |
| The record keeps the forwarded argv, and a restart starts with it | (defaulted: a restart must not lose `--path` or `--plugin-option`) | 01 |
| A daemon that runs in the foreground, with no record of its own pid, refuses a restart over HTTP and says to restart it where it runs | (defaulted: a respawn would leave the terminal it runs in) | 02 |
| Over HTTP it needs `config:write` and `deploymentTokenOnly`, as `plugin install` | (defaulted: the shape of `plugin install`) | 02 |
| The plugin commands' restart line names `ahpd restart` | (defaulted: the command now exists) | 03 |

## Proposed architecture

- **Data flow** - terminal: read the record, ask the running daemon over its API whether a turn runs, stop, then start with the recorded argv. HTTP: the daemon checks, answers, spawns its own `start` with the recorded argv once its listener is closed, and exits.
- **Layer responsibilities** - server; the host answers which sessions have a turn running.
- **Source-of-truth files** - [`code://packages/server/src/daemon.ts`](../../../../packages/server/src/daemon.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The record keeps the argv](task-01-the-record-keeps-the-argv.md) | todo | - |
| [02 - `ahpd restart`](task-02-ahpd-restart.md) | todo | 01 |
| [03 - The restart line and docs](task-03-the-restart-line-and-docs.md) | todo | 02 |

## Risks and tradeoffs

- Between the old listener closing and the new one opening, a client reconnects; the connect URL keeps its token because the token comes from the same file or flags.
- A new daemon that fails to start leaves none running; the command waits for the new `ws://` line as `start` does and reports the log's last lines when it does not come.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-record-keeps-the-argv.md](task-01-the-record-keeps-the-argv.md).
- **Open questions:** none.
- **Watch out for:** `start` leaves out the program globals (`--remote`, `--token`); the recorded argv must be the child's, not the parent's.

## Final verification checklist

- [ ] `ahpd start --path /tmp/x`, then `ahpd restart`: the new daemon serves `/tmp/x`, and a session made before resumes.
- [ ] With a turn running, `ahpd restart` names the session and does nothing; `--force` restarts.
- [ ] `POST /api/restart` from ahpapp restarts a daemon started with `ahpd start`.
- [ ] `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- [ ] `plans/index.md` updated.
