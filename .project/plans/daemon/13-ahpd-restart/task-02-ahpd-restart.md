---
title: "`ahpd restart`"
status: done
depends: [task-01-the-record-keeps-the-argv.md]
layer: "server, sdk"
refs:
  - "[code://packages/server/src/commands/registry.ts#L39-L59](../../../../packages/server/src/commands/registry.ts#L39-L59) - where `stop` and `restart` are registered"
  - "[code://packages/server/src/commands/restart.ts](../../../../packages/server/src/commands/restart.ts) - the command, the restart in place, the lifecycle, the signal answer and the terminal"
  - "[code://packages/server/src/commands/run.ts#L588-L633](../../../../packages/server/src/commands/run.ts#L588-L633) - the lifecycle and the signal handlers, wired"
  - "[code://packages/server/src/daemon.ts#L9-L30](../../../../packages/server/src/daemon.ts#L9-L30) - `Running`, with `argv`"
---

## Objective

`daemon.restart` is `ahpd restart [--force]` and `POST /api/restart` as the plan's table says; the host answers which sessions have a turn running.

## Files

- `CREATE: packages/server/src/commands/restart.ts` - the command.
- `UPDATE: packages/server/src/commands/registry.ts` and `served.ts` - registered at the terminal and served.
- `UPDATE: packages/server/src/commands/run.ts` and `packages/server/src/daemon.ts` - the lifecycle, the signal handlers, a start in a restarting daemon's place.
- `UPDATE: packages/sdk/src/host.ts`, `packages/sdk/src/types/host.ts` and `packages/sdk/src/listen.ts` - the running sessions, `Host.close`, and listeners that let go of their port on close.
- `UPDATE: packages/sdk/src/sessions.ts`, `packages/sdk/src/scheduled.ts` and their types - stores that write nothing once closed.
- `UPDATE: packages/sdk/src/types/session.ts`, `packages/agent-acp/src/connection.ts`, `packages/agent-acp/src/types.ts`, `packages/agent-acp/src/session.ts` and `packages/agent-claude/src/session.ts` - a session's close that settles once its agent's process has gone.
- `CREATE: packages/server/test/server-restart.test.ts` - the cases below.

## Steps

1. Tests first with a faked spawn: no daemon says so; a running turn refuses with the session named; `--force` stops and starts with the recorded argv; over HTTP a foreground daemon refuses; over HTTP a started one answers, then spawns and exits.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- By hand: the first three checks of the plan's checklist.

## Resume

- `Host.turning()` (`packages/sdk/src/host.ts`, `types/host.ts`) answers the sessions whose status has `InProgress` or `InputNeeded`, the test `settleRun` uses for a busy session.
- `daemon.restart` lives in `commands/restart.ts`, beside `start.ts` and `stop.ts`. It is registered in `cliRegistry` and in `servedRegistry`, and not in `localRegistry`, so `--remote` reaches the served one.
- Served: it refuses a daemon with no record (`FOREGROUND`), a record naming another pid (its own words, naming that pid), a record with no `argv`, and a running turn without `force`; otherwise it answers `{ restarting, pid }` and calls `ServedFacts.restart(argv)`. `meta.deploymentTokenOnly` is the words of the refusal, `restart the daemon`.
- The daemon's lifecycle is `lifecycle()` in `restart.ts`, wired in `runForeground`: `shutdown` for `SIGINT` and `SIGTERM`, and `restart`, which is refused while a restart runs or once a stop has begun. `down()` raises `stopping` and awaits the API's own listener's close and then the daemon's.
- `restartInPlace` closes, logs `restart: starting the successor`, starts the successor with `start(argv, self, token, process.pid)`, logs `restarted as <url> (pid N)` and exits. The record stays until the successor's replaces it, so `ahpd stop` reaches the old daemon throughout; a stop during the close means no successor is started, and a stop during the start stops the successor, each logged as `Could not restart it: ...` with exit 0. A failed start forgets the record, logs why and exits 1.
- The successor's token is `secret(optionsOfLine(argv))`: the recorded line read with the run's declaration over the configuration as it is now (`optionsOfLine` in `run.ts`).
- At the terminal, `restartAtTerminal` only signals: it reads the record, refuses with none or with no `argv`, and sends the recorded pid `SIGHUP`, or `SIGUSR2` with `--force`. It reads `daemon.log` for the refusal line, a `Could not restart it` line or the `restarted as` line with a new record. It waits with no limit while the old pid lives and has not said it is starting the successor, then `SUCCESSOR_WAIT_MS` (`READY_TIMEOUT_MS` plus five seconds, documented at both constants) from that line; an old pid gone with no answer ends the wait at once. On giving up it answers the log's last ten lines.
- A restart from elsewhere is the served one, reached by `ahpd --remote <url> restart` or `POST /api/restart`; neither it nor the terminal falls back to the other.
- `answerRestartSignal` answers a signal: a refusal, or a restart the lifecycle refused, is one `restart refused:` line; otherwise it is the lifecycle's restart.
- `daemon.ts` spawns a started daemon with `AHPD_DETACHED=1`; `runForeground` reads and deletes it at once and installs the two signal handlers only when it was set.
- `listen` and `serveRequests` on Node (`packages/sdk/src/listen.ts`) close as their type says: every connection is dropped and the promise settles once the port is free. `listen` also closes the `node:http` server `ws` is attached to, which it left bound before, so a successor on a fixed port met `EADDRINUSE`.
- Tests, `packages/sdk/test`: `turning.test.ts`, which reads `turning()` at the first streamed delta and after `chat/turnComplete`, with no timer; `listen.test.ts` "lets go of the port on close" for both listeners.
- Tests, `packages/server/test/server-restart.test.ts`: served (foreground, another pid with the message, a started daemon, a running turn and `force`, an older record, a person, a second restart refused); `restartInPlace` (the order, a failed start, a refused close, a stop during the close, a stop during the start); `lifecycle` (a second restart refused, a restart refused while stopping, two stops go down once, a stop during a restart starts nothing); the signal answer (idle, busy, forced, not its own with each message, a refused restart); `restartAtTerminal` (no daemon, an older record, both signals, the refusal, a failed successor, a minute of stopping then the successor, the successor's wait counted from the starting line then the log's last lines, a late refusal, an old daemon gone with no answer, an answer written just before it went).
- Tests, `server-cli.test.ts`, real processes: over HTTP; from the terminal with both signals; from the terminal with the token changed in the file between start and restart, the successor's `connectUrl` carrying the new one; on a fixed free port, the same URL after, with a session made before listed after through the fixture `test/fixtures/plugin-kept`; `AHPD_DETACHED` absent from a started daemon's environment (fixture `test/fixtures/plugin-env`); a foreground daemon ended by `SIGHUP` and by `SIGUSR2`, the default for a signal with no handler.
- Failed first: the fixed-port case, on `EADDRINUSE`, before the listener fix. The other new cases were written with the code they cover.
- Second review, 2026-09-30.
- `down()` in `run.ts` (L589) awaits `stopping` and both listeners' close, then `Host.close()`. A stop runs the same `down()`.
- `answerRestartSignal` (`restart.ts` L266) logs `restart: stopping (SIGHUP)` or `(SIGUSR2)` once the lifecycle takes the restart, and a refusal is `restart refused (SIGHUP): ...`.
- `restartAtTerminal` (`restart.ts` L344) converts a failed `kill` to a conflict with words (`unsignalled`, L328): `ESRCH` is a daemon gone, and any other error is `Could not signal pid N: <why>`. It waits `RECEIPT_WAIT_MS` (five seconds, L47) for its own receipt or its own kind's refusal, whichever is first; after the receipt it reads only the log after it, so a later refusal is another terminal's. An old pid gone with no answer is read once more before the log's last lines are given.
- `claim(record, replacing)` (`daemon.ts` L345) writes the record unless a live record names a pid other than `replacing`, and answers that one; `start` then kills its child and throws, naming the other pid. `forget(only)` (L362) unlinks only a record naming a pid in `only`: the restart's stop step forgets `[successor.pid]` and its forget step `[process.pid]`.
- `listen.ts`: a Node close stops accepting, closes idle connections every 25 ms, and after `CLOSE_GRACE_MS` (two seconds, L397) drops the rest, settling once `server.close` calls back (`closeHttp`, L404); a Deno close is bounded by the same time (`within`, L426).
- `fileSessions` (`sessions.ts`, `close` at L220) and `scheduledAutomations` (`scheduled.ts`, `close` at L372) write and fire nothing once closed.
- Tests, `packages/sdk/test/host-close.test.ts`: the session store writes what was waiting on close and nothing after; the scheduled store fires and writes nothing after close; `Host.close` ends a session, stops the clock, and a schedule due and a dispose after it reach no file.
- Tests, `listen.test.ts`: "lets a response in flight finish before it drops the connection".
- Tests, `turning.test.ts`: `turning()` read at the first delta and at `chat/turnComplete`, in a `mkdtemp` directory, with a five-second bound that fails naming the action.
- Tests, `server-restart.test.ts`: the tagged receipt and refusals; `restartAtTerminal` with `ESRCH` and another error, a receipt that never comes (bounded), another terminal's refusal after the receipt ignored, and an answer written just before the old pid went, appended by `alive()`.
- Tests, `daemon.test.ts`: `claim` refuses a record another live daemon holds, and `forget` leaves a record that names another pid.
- These cases were written with the code they cover.
- Third review, 2026-09-30.
- `stop()` in `daemon.ts` (L372) forgets `[found.pid]` (L378), so a successor's record claimed between its read and its forget stays. Test: `daemon.test.ts` "leaves a record a successor claimed while a stop was signalling the daemon it read", with `process.kill` spied to write the successor's record at the `SIGTERM`.
- `Host.close` (`packages/sdk/src/host.ts` L5822, type `types/host.ts`) answers one promise, and from its first call `closed` (L978) refuses `createSession` (L7256), `spawn` (L3204), `createTerminal` (L6731), a backend's terminal (L4583), a command's terminal (L4502), `startForAutomation` (L5770) and a due automation (L5791) with `This host is closing, so nothing new starts on it`. `Session.close` (`types/session.ts`) may answer a promise; `connectAcp`'s close (`agent-acp/src/connection.ts` L224) awaits the child's `ended`, the ACP session's close answers it (`session.ts` L1202), and the Claude session's close answers the query's `Symbol.asyncDispose`, which settles once the CLI has exited or after the SDK's own two-second bound (`agent-claude/src/session.ts` L3614). `down()` awaits `host.close()`.
- `closed` and `closing` sit beside `terminals`, so the clock's doc block is directly above the `onDue` it documents.
- `checkedRestart` (`restart.ts` L231) reads the line and its token, through `secret(await optionsOfLine(line))` in `run.ts` (L620), before the lifecycle is asked; a throw is `Its line cannot run now, so it was not stopped: <why>`, a refusal at the terminal and a 409 served. `answerRestartSignal` is async and writes its receipt only after the read. `lifecycle().restart(argv, token)` hands the token to `start`.
- The announcement has a `pid N` line in the same write (`run.ts` L539); `start` takes the block `announcementOf` (`daemon.ts` L177) finds holding its child's pid.
- `listen.ts`: Node always serves through its own `node:http` server (L299), answering 426 when the host has no HTTP surface; Bun stops with `stop(false)` and forces `stop(true)` after `CLOSE_GRACE_MS` (`stopBun`, L420), for `listen` and `serveRequests`; a Bun (L189) or Deno (L244) close closes its open WebSockets first. The type docs in `types/listen.ts` say so for all three. Smoke-run by hand on Bun and Deno from a scratch script: a WebSocket close in 9 ms and 28 ms, the port bound again, and a request in flight answered before the close settled.
- `restartAtTerminal`: after the receipt wait it says the daemon may still take the signal (L392); a successor named in `restarted as` that is not running is said so (L404).
- Tests, `host-close.test.ts`: the one close shared by two calls; a late agent close awaited, with a `createSession` during it refused; a terminal's process exited by the time the close settles, with a `createTerminal` during it refused; an agent that never exits given up on at `HOST_CLOSE_WAIT_MS`, under fake timers.
- Tests, `listen.test.ts`: the kept-alive case closes in under 500 ms; "lets go of a WebSocket-only port at once on close, with a kept-alive plain connection open".
- Tests, `server-restart.test.ts`: `checkedRestart` reads before asking and hands the token, and refuses without asking; a signal whose line cannot run writes a refusal and no receipt; the lifecycle starts the successor with the token; the receipt-timeout words; a successor gone after `restarted as`.
- Tests, `daemon.test.ts`: `announcementOf` takes the block with its pid among another daemon's lines and answers nothing for a block with no pid line.
- Tests, `server-cli.test.ts`: "refuses a restart whose line cannot run over the file as it is now, and the daemon runs on", with `config.json` broken after the start; the stop-during-restart case holds `stopping` until the test writes the file `AHPD_RELEASE` names, after `ahpd stop` returns (fixture `plugin-slow-stop`, thirty-second bound), passing three runs of three on its own.
- Tests, `packages/agent-acp/test/agent-acp-failure.test.ts`: a connection's close settles after the child has exited, and again at once. `packages/agent-claude/test/agent-claude-close.test.ts`: the session's close settles when the query's dispose does, not before.
- These cases were written with the code they cover.
- Fourth review, 2026-09-30.
- The record's lock this review added was removed in the fifth; see there.
- `restartInPlace` (`restart.ts` L113): any failure once the way down began, `down()`, `forget()` or `stop()` included, is logged as `Could not restart it: <why>` and exits 1; the branch for a close refused because a stop was under way is gone, since a restart is never begun once a stop is. A stop whose way down fails logs `Could not stop cleanly: <why>` (L68) and exits 1.
- `Host.close` (`host.ts` L5822) runs each step in its own `step` (L5826), logging a failure as `closing <what> failed: <why>` and going on. The automation store now closes after the wait, with the session store after it, as the type and `docs/DAEMON.md` say: the host's own `closed` flag is what stops a due automation from the first call.
- `checkedRestart` (`restart.ts` L231) takes the running turns and the force, and reads the turns again after the line, so a turn that began during the read refuses an unforced restart. `SignalFacts.restart` and `ServedFacts.restart` take `force`.
- The terminal's and `start`'s reads of `daemon.log` go through `logSince` (`daemon.ts` L149), which reads from the offset rather than the whole file.
- `typedValue` (`options.ts` L86): see daemon/12 task 01.
- Tests, `daemon.test.ts`: the lock's cases, removed with it in the fifth review.
- Tests, `server-restart.test.ts`: a way down that rejects exits 1; `forget` or `stop` throwing inside the restart is logged and exits 1; a stop whose way down rejects exits 1; the real `checkedRestart` and `lifecycle` driving two signals, the first refused by a turn that began during its read, the second, forced, restarting.
- Tests, `host-close.test.ts`: a `createSession` under way when the close began is refused at `spawn` and creates no session; a `!` command's run after the close answers the refusal and opens no terminal; a backend's terminal opened after the close is refused; a due automation after the close reaches the host's guard, with the store still open, and `startForAutomation` handed out before refuses; a session's close and the automation store's close throwing are logged and both stores still close.
- Tests, `listen.test.ts`: a plain request in flight on the WebSocket port is answered before the close settles; one that never answers is dropped at `CLOSE_GRACE_MS`, under fake timers, and the close then settles.
- These cases were written with the code they cover.
- Fifth review, 2026-09-30.
- The record has no lock, at Softov's answer "Drop the lock". `claim` (`daemon.ts` L345) reads the record again just before its write and writes a temp file named by its pid, `daemon.json.<pid>.tmp`, renamed over the record; before it writes, `sweepTemps` (L127) removes the temp of any pid that is gone, so temps cannot accumulate beyond one per live writer. `forget(only)` (L362) compares the pid before it unlinks, and `stop` forgets `[found.pid]`. The windows between those reads and writes are accepted in the plan's Risks.
- `startForAutomation` (`host.ts` L5769) is refused once closing and holds each run in `starting` (L982) while `beginAutomation` (L5736) makes its session; `Host.close` waits for those runs with the sessions (L5836), so a run past the guard ends before the stores close, refused at `spawn`, and its failure is logged by the due observer as `<automation> was due and failed: This host is closing, so nothing new starts on it`.
- The receipt's words: `restart: stopping (SIG)` is written once the daemon has read its line and token and begins to stop, which the doc comments on `RECEIPT_WAIT_MS` and the receipt (`restart.ts` L39-L59) and `docs/DAEMON.md` now say.
- `typedValue`: see daemon/12 task 01.
- Tests, `daemon.test.ts`: the lock's cases are gone; a claim clears the temp a dead writer left and keeps a live writer's. The stop-then-start and stop-during-restart sequences, which hold `claim`'s re-check and `forget`'s compare, stay.
- Tests, `listen.test.ts`: the in-flight and drop cases wait on a promise the request handler resolves rather than 50 ms, and check the close has not settled while the response is held; the idle closes are timed on fake timers moved 25 ms at a time and settle before `CLOSE_GRACE_MS`, with no wall clock.
- Tests, `host-close.test.ts`: the `spawn` case waits until the create has entered the gated worktree lookup before it closes; a new case holds an automation run in the same lookup, and the close does not settle until it is let go, after which the run's refusal is logged.
- These cases were written with the code they cover.
- Merge-readiness review, 2026-09-30.
- A `daemon.json` that holds no record, `null`, another JSON value, a non-numeric pid or text that is not JSON, is read by `recordIn` (`daemon.ts` L104) as none: `running()` (L84) removes the file, and `claim` writes over it, where both threw a `TypeError` before.
- `start` stops the child it spawned when `claim` throws, as it does when another daemon holds the record (`unmade`, L319), so a failed write leaves no daemon running unrecorded.
- `sweepTemps` asks `present` (L64), which counts a pid answering `EPERM` as there, so a temp named by another user's live pid is kept.
- Tests, `daemon.test.ts`: the temp sweep uses a pid above 2^22, which no process can have, and checks each file by name: the gone writer's is removed, a live writer's and pid 1's (`EPERM` to anybody but root) are kept; five files that are not a record are cleared by `running()` and claimed over; `start` with the record's temp path made a directory rejects with `EISDIR`, and the child it announced is gone and no record is left.
- These cases were written with the code they cover.
