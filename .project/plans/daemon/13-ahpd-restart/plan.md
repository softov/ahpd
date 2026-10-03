---
title: "`ahpd restart` restarts the daemon in place, and refuses while a turn runs"
domain: daemon
status: active
priority: high
created: 2026-09-29
revalidated: 2026-09-29
requires: []
decisions:
  - decisions/a-configuration-change-applies-live-or-on-ahpd-restart.md
refs:
  - "[code://packages/server/src/daemon.ts#L9-L30](../../../../packages/server/src/daemon.ts#L9-L30) - `Running`, the record, which held no argv before this plan"
  - "[code://packages/server/src/daemon.ts#L240-L380](../../../../packages/server/src/daemon.ts#L240-L380) - start: detached spawn, the log poll, the record; claim, forget; stop: SIGTERM"
  - "[code://packages/server/src/commands/start.ts#L47-L123](../../../../packages/server/src/commands/start.ts#L47-L123) - `ahpd start` and the argv it forwards"
  - "[code://packages/server/src/commands/stop.ts#L14-L33](../../../../packages/server/src/commands/stop.ts#L14-L33) - `ahpd stop`"
  - "[code://packages/server/src/commands/run.ts#L588-L633](../../../../packages/server/src/commands/run.ts#L588-L633) - the shutdown, the restart and their signals"
  - "[code://packages/server/src/commands/plugin.ts#L25](../../../../packages/server/src/commands/plugin.ts#L25) - `RESTART`, the restart line, which named `ahpd stop && ahpd start` before this plan and is said at L146, L184, L291 and L359"
  - "[code://packages/server/src/commands/registry.ts#L39-L59](../../../../packages/server/src/commands/registry.ts#L39-L59) - the local and CLI registries"
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
| At the terminal, `ahpd restart` only signals the recorded pid, one signal for a restart and one for a forced one; the daemon checks its own running turns, refuses or restarts itself with its recorded argv, and writes its answer to `daemon.log`, which the terminal reads. A restart from elsewhere is `POST /api/restart`, which `ahpd --remote <url> restart` and clients use; neither path falls back to the other | Softov, 2026-09-30, asked "Which way should `ahpd restart` reach the daemon?": "Local signals, remote API" | 02 |
| The terminal waits for as long as the old daemon is still stopping, and gives the successor `READY_TIMEOUT_MS` plus a margin from the log line the daemon writes when it starts it; plugins' `stopping` handlers keep no time limit | Softov, 2026-09-30, asked how the terminal should wait when `stopping` handlers have no time limit: "Wait while it stops" | 02 |
| One restart runs at a time, a second is refused, and a stop during a restart wins: no successor is left running | Softov, review of daemon/13, 2026-09-30 | 02 |
| The successor's connection token is read from its recorded line over the configuration as it is at the restart | Softov, review of daemon/13, 2026-09-30 | 02 |
| Before the `STARTING` line the old daemon stops the scheduler, ends agents and terminals, and flushes the session and schedule stores, as a stop would; a turn `--force` let run ends there, and the two processes never overlap on the stores | Softov, 2026-09-30, asked "During a restart the old daemon keeps its host running (agents, terminals, the automation scheduler) for up to 20 s while the successor starts ... What should a restart do?": "Quiesce before successor" | 02 |
| The daemon logs a receipt line when it accepts the signal; the terminal waits a bounded, documented time for it, then without limit while the old daemon stops, then `SUCCESSOR_WAIT_MS` from `STARTING`; a signal that cannot be sent is a conflict with words, `ESRCH` saying the daemon is gone | Softov, second review of daemon/13, 2026-09-30 | 02 |
| A terminal does not read another terminal's refusal as its own: the receipt and each refusal name the signal they answer, and after its receipt no refusal is read | Softov, second review of daemon/13, 2026-09-30 | 02 |
| A stop then a start during a restart orphans no daemon: the successor writes the record only while it is the old daemon's or no live daemon's, and a daemon forgets only its own record or its successor's | Softov, second review of daemon/13, 2026-09-30 | 02 |
| Closing a listener lets a response in flight, the served restart's 200 among them, finish for a moment before the rest of the connections are dropped, and a Deno close is bounded; the promise settles once the port is free | Softov, second review of daemon/13, 2026-09-30 | 02 |
| `ahpd stop` forgets the record only when it still names the daemon it stopped | Softov, third review of daemon/13, 2026-09-30 | 02 |
| `Host.close` settles once the agents and terminals it ended have exited, bounded, and refuses a session, a terminal or an automation run from its first call; `down()` awaits it | Softov, third review of daemon/13, 2026-09-30 | 02 |
| A restart reads its recorded line over the configuration as it is now, and the token, before anything goes down; either failing refuses the restart with why, and the daemon runs on | Softov, third review of daemon/13, 2026-09-30 | 02 |
| A change to the record writes through a rename; `start` reads the log by bytes and takes only the announcement naming its child's pid | Softov, third review of daemon/13, 2026-09-30 | 02 |
| Bun lets requests in flight finish as Node does, and a Bun or Deno close closes its open WebSockets first | Softov, third review of daemon/13, 2026-09-30 | 02 |
| The terminal signals `SIGHUP` for a restart and `SIGUSR2` for a forced one | (defaulted: `SIGHUP` is the conventional reload signal, and `SIGUSR2` is the free user signal Node does not take) | 02 |
| `RECEIPT_WAIT_MS` is five seconds | (defaulted: a daemon takes a signal in milliseconds, and five seconds covers a loaded machine without leaving a person waiting) | 02 |
| `CLOSE_GRACE_MS` is two seconds, and idle connections are closed on a 25 ms sweep until the port is free | (defaulted: long enough for the restart's own answer to leave, short against the restart's wait; the sweep closes a connection as soon as its response has gone) | 02 |
| Any failure once the way down began, in a restart or a stop, is logged and exits 1 | Softov, fourth review of daemon/13, 2026-09-30 | 02 |
| Each step of `Host.close` is its own, logged when it fails; the stores close after the agents' wait, and the host's own flag stops a due automation from the first call | Softov, fourth review of daemon/13, 2026-09-30 | 02 |
| The running turns are read again after the recorded line, so a turn that began meanwhile refuses an unforced restart | Softov, fourth review of daemon/13, 2026-09-30 | 02 |
| No lock on `daemon.json`: a record write is a temp file renamed into place, `claim` reads the record again just before it writes, and `forget` compares the pid before it unlinks | Softov, 2026-09-30, asked "The daemon.json lock: keep it or drop it?": "Drop the lock" | 02 |
| A record write's temp file is named by the writer's pid, and a write removes the temp of a writer that is gone | (defaulted: one temp per pid, so only a writer that died between write and rename leaves one, and the next write clears it) | 02 |
| A close waits for the automation runs already starting a session, as for the sessions | Softov, fifth review of daemon/13, 2026-09-30 | 02 |
| `HOST_CLOSE_WAIT_MS` is five seconds | (defaulted: a backend takes its process down in well under that once stdin closes, and one that ignores its kill does not hold a stop for ever) | 02 |
| A daemon `start` spawns carries `AHPD_DETACHED=1`, which the daemon reads and deletes at once, and only such a daemon listens for the restart signals | (defaulted: a foreground daemon keeps the default for both signals, and a session's shell never inherits the variable) | 02 |
| `plugin config` says when the running daemon's recorded `--plugin-option` overrides the key it set, since a restart starts that argv again | (defaulted: a set that a restart silently ignores reads as a broken command) | 04 |
| A plugin or preset that fails to load at a restart is skipped and the successor runs with the rest; `start` and `restart` print what was skipped and exit 0 | Softov, 2026-10-03, "Only its item"; [host/41 task 03](../../host/41-a-failure-belongs-to-the-item-that-failed/task-03-start-and-restart-say-what-was-skipped.md) | host/41 03 |
| A session whose agent did not load after a restart is listed under it, not openable, its record never rewritten | Softov, 2026-10-03; [host/41 task 02](../../host/41-a-failure-belongs-to-the-item-that-failed/task-02-a-session-waits-for-its-own-agent.md) | host/41 02 |

## Proposed architecture

- **Data flow** - terminal: read the record, signal the recorded pid, and read the daemon's answer from `daemon.log`, waiting while the old daemon stops and then for the successor. The daemon decides, and the restart itself is the daemon's. HTTP: the daemon checks, answers, spawns its own `start` with the recorded argv once its listener is closed, and exits.
- **Layer responsibilities** - server; the host answers which sessions have a turn running.
- **Source-of-truth files** - [`code://packages/server/src/daemon.ts`](../../../../packages/server/src/daemon.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The record keeps the argv](task-01-the-record-keeps-the-argv.md) | implemented | - |
| [02 - `ahpd restart`](task-02-ahpd-restart.md) | implemented | 01 |
| [03 - The restart line and docs](task-03-the-restart-line-and-docs.md) | implemented | 02 |
| [04 - `plugin config` says a recorded flag overrides it](task-04-plugin-config-says-a-recorded-flag-overrides-it.md) | todo | 01 |

## Risks and tradeoffs

- Between the old listener closing and the new one opening, a client reconnects; the connect URL keeps its token unless the file or the recorded line changed it, in which case the new record carries the new one.
- A new daemon that fails to start leaves none running; the command waits while the old daemon stops, then `SUCCESSOR_WAIT_MS` from its starting line, and reports the log's last lines when no answer comes.
- A configuration or token that no longer reads, found at a restart, is refused before anything goes down, and the old daemon runs on.
- A plugin that now fails to load is skipped and the successor runs with the rest; only a successor left with no backend at all refuses to start. [host/41 task 03](../../host/41-a-failure-belongs-to-the-item-that-failed/task-03-start-and-restart-say-what-was-skipped.md) has `restart` print what was skipped, and [host/41 task 02](../../host/41-a-failure-belongs-to-the-item-that-failed/task-02-a-session-waits-for-its-own-agent.md) keeps that agent's sessions listed under it.
- A `--plugin-option` in the recorded argv is started again by every restart and wins over a later `plugin config` of the same key; task 04 says so when the key is set.
- A backend whose process ignores its kill is left to the operating system after `HOST_CLOSE_WAIT_MS`, and may briefly overlap the successor, though never on the stores.
- A child a pi or cofold session started, such as a pi bash tool's shell, is not waited on: pi's backend close is a synchronous `session.dispose()` and cofold's close stops its run without an exit to wait for, so a forced restart may leave such a child running briefly beside the successor, which does not share the stores with it.
- Accepted, with no lock on the record: `claim` reads the record and then renames its own over it, and `forget` reads it and then unlinks it, each a few microseconds apart, so a write by another process in that window can be overwritten or removed. It needs two daemons changing the record in the same microseconds, which a person's `ahpd stop` and `ahpd start` beside a restart do not.

## Resume state

- **Done so far:** tasks 01, 02 and 03 implemented, awaiting review.
- **Reviews applied:** the first review of 2026-09-30, the terminal signalling only and waiting while the old daemon stops; the second, with the receipt line, refusals tagged by signal, the claimed record, the grace close and the quiesce; the third, with `stop` forgetting only its daemon's record, `Host.close` awaited and refusing new work, the line and token read before going down, the record's lock, the announcement by pid, Bun and Deno closes, and the terminal's words. The fourth, with the lock made whole by a hard link and reaped by compare, every failure after the way down began exiting 1, `Host.close` steps each logged and the stores closed after the wait, the turns read again after the line, `typedValue` refusing only what loses its value, and the log read from its offset. The fifth, with the lock dropped at Softov's answer, the listen tests waiting on the request rather than the clock, the receipt's words, `typedValue` alike at every depth, and a close waiting for automation runs already starting. The merge-readiness review, with a file that holds no record cleared, the child stopped when its record cannot be written, and the temp sweep keeping another user's pid.
- **Next action:** [task-04-plugin-config-says-a-recorded-flag-overrides-it.md](task-04-plugin-config-says-a-recorded-flag-overrides-it.md) once the question below is answered; review, the checklist's checks by hand, then `implemented.md` and `status: built`.
- **Open question (ask before task 04):** a restart starts the recorded argv again, so a one-run flag such as `--plugin-option` or `--path` outlives the run it was typed for - (a) a restart keeps every one-run flag, and task 04 warns when one overrides a `plugin config` change, or (b) a restart drops the one-run flags and starts from the file, and task 04 is dropped.
- **Watch out for:** `start` leaves out the program globals (`--remote`, `--token`); the recorded argv must be the child's, not the parent's.
- **Watch out for:** a signal names no sender, so two terminals sending the same kind of signal read the same answer; they asked for the same thing, so either answer is true for both.

## Final verification checklist

- [ ] `ahpd start --path /tmp/x`, then `ahpd restart`: the new daemon serves `/tmp/x`, and a session made before resumes.
- [ ] With a turn running, `ahpd restart` names the session and does nothing; `--force` restarts.
- [ ] `POST /api/restart` from ahpapp restarts a daemon started with `ahpd start`.
- [ ] Started with `--plugin-option @ahpd/agent-claude.workerStop=session`, `ahpd plugin config @ahpd/agent-claude workerStop turn` says the flag overrides it.
- [ ] `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- [ ] `plans/index.md` updated.
