---
title: A paused run is answered and stopped on its own handle
status: todo
depends: [task-01-ahpd-takes-the-cofold-release.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/pauses.ts#L43-L178](../../../../packages/agent-cofold/src/pauses.ts#L43-L178) - `owePause`, `payPause`, `rejoin`, `route`, `stopNow`, `stop`"
  - "[code://packages/agent-cofold/src/pauses.ts#L196-L257](../../../../packages/agent-cofold/src/pauses.ts#L196-L257) - `confirm` and `answer`, which stay and call `route`"
  - "[code://packages/agent-cofold/src/runs.ts#L78-L97](../../../../packages/agent-cofold/src/runs.ts#L78-L97) - `settleTurn` with `liveAgent`, `paused` and `payPause`"
  - "[code://packages/agent-cofold/src/runs.ts#L121-L192](../../../../packages/agent-cofold/src/runs.ts#L121-L192) - `apply`: `owePause` in `hold`, and the awaiting bookkeeping at L186-190"
  - "[code://packages/agent-cofold/src/runs.ts#L201-L228](../../../../packages/agent-cofold/src/runs.ts#L201-L228) - `read` and its synthesized `run.finished` at L215-226"
  - "[code://packages/agent-cofold/src/runs.ts#L244-L316](../../../../packages/agent-cofold/src/runs.ts#L244-L316) - `reopen`, which stays"
  - "[code://packages/agent-cofold/src/context.ts#L54-L94](../../../../packages/agent-cofold/src/context.ts#L54-L94) - `handle`, `liveAgent`, `paused`, `pausing`, `opening`"
  - "[code://packages/agent-cofold/src/turns.ts#L117-L136](../../../../packages/agent-cofold/src/turns.ts#L117-L136) - `startTurn` sets `ctx.liveAgent`"
  - "[code://packages/agent-cofold/src/session.ts#L165-L171](../../../../packages/agent-cofold/src/session.ts#L165-L171) - the context's first values"
  - "[code://packages/agent-cofold/src/session.ts#L301-L323](../../../../packages/agent-cofold/src/session.ts#L301-L323) - `cancel` and `steer`"
  - "[code://packages/agent-cofold/src/mapping.ts#L662-L669](../../../../packages/agent-cofold/src/mapping.ts#L662-L669) - `run.finished{awaiting}` maps to nothing, which stays"
  - file:///github/cofold/.project/plans/agent/05-a-run-answers-its-own-pause/deferred.md - the ahpd row this task closes
---

## Objective

An approval, a question and a stop go to the turn's own `run()` or `resume()` handle, also while the run is paused.
ahpd reads one handle to its last `run.finished` and keeps no pause bookkeeping of its own.

## Files

- `UPDATE: packages/agent-cofold/src/pauses.ts:43-178` - `owePause`, `payPause` and `rejoin` go; `route` submits to `ctx.handle` after `ctx.opening`; `stopNow` settles the held entries, then calls `ctx.handle?.cancel()`.
- `UPDATE: packages/agent-cofold/src/runs.ts:78-97` - `settleTurn` loses the `liveAgent`, `paused` and `payPause` lines.
- `UPDATE: packages/agent-cofold/src/runs.ts:121-192` - `hold` loses `owePause`; an awaiting `run.finished` sets no `settled` and no `paused`, and still records no `endPoint`.
- `UPDATE: packages/agent-cofold/src/runs.ts:201-228` - `read` loses the fallback that makes a `run.finished` when the stream ends without one.
- `UPDATE: packages/agent-cofold/src/context.ts:54-94` - `liveAgent`, `paused` and `pausing` go.
- `UPDATE: packages/agent-cofold/src/turns.ts:117-136` - `startTurn` no longer sets `ctx.liveAgent`.
- `UPDATE: packages/agent-cofold/src/session.ts:165-171` - the context no longer starts `liveAgent` and `pausing`.
- `UPDATE: packages/agent-cofold/src/runs.ts:244-316` - `reopen` no longer sets `ctx.liveAgent`; its replay and `resume({ afterSeq })` stay.
- `UPDATE: packages/agent-cofold/test/agent-cofold-approval.test.ts` - the ten pause cases pass unchanged, or their fakes take an answer on the open handle.
- `UPDATE: packages/agent-cofold/test/agent-cofold-plugin.test.ts` - the paused-run case passes.
- `UPDATE: packages/agent-cofold/test/agent-cofold-store.test.ts` - the two `reopen` cases pass, and a resumed run answers a second pause.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts` - the three in-emit cases and the nine timeout cases pass.

## Steps

1. Read cofold `packages/agents/src/run/run.ts` at 0.2.1 for the paused handle's contract.
2. Delete `owePause`, `payPause` and `rejoin` from `pauses.ts`, and their names from `Pauses`.
3. Make `route` wait on `ctx.opening`, then call `ctx.handle.submit`.
4. Keep the `.catch` on `submit`, because a closed handle throws `not_running`.
5. In `stopNow`, settle every held entry, then call `ctx.handle?.cancel()`, also for a paused run.
6. Make `stop` wait on `ctx.opening`, then call `stopNow`.
7. Delete `liveAgent`, `paused` and `pausing` from `context.ts`, `session.ts`, `turns.ts` and `runs.ts`.
8. Remove the awaiting bookkeeping from `apply`, and keep the rule that an awaiting `run.finished` records no `endPoint`.
9. Remove the synthesized `run.finished` from `read`.
10. Run the 24 pause cases in the plan, and fix each fake that closes its stream at a pause.
11. Add a case: a steer sent during a pause reaches the run after the answer.
12. Add a case: one run pauses twice and both answers reach it.
13. Add a case: a run reopened after a restart answers a pause that comes after the resume.
14. Add a case: a cancel on a paused run settles the entry, and the turn ends cancelled.
15. Add a case: a confirm after the turn ended does not throw.

## Validation

- `rg "owePause|payPause|rejoin|pausing|liveAgent|\.paused" packages/agent-cofold/src` finds nothing.
- Every case in the plan's test table, except the `ENOENT` one, passes.
- The five new cases pass.
- `pnpm typecheck` and `pnpm boundary` pass.

## Resume

- A paused run is now in cofold's `liveRuns`, so any `resume()` in the same process fails `writer_busy`.
