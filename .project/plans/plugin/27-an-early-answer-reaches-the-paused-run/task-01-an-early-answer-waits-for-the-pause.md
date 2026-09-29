---
title: An answer or cancel that arrives before the pause is recorded waits for it
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/session.ts#L641-L666](../../../../packages/agent-cofold/src/session.ts#L641-L666) - `route`"
  - "[code://packages/agent-cofold/src/session.ts#L673-L693](../../../../packages/agent-cofold/src/session.ts#L673-L693) - `stopNow`"
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts) - the cases that `settle` before answering"
---

## Objective

A confirm, an answer, a decline or a cancel for a request the current run opened reaches the run even when it arrives before ahpd has read that run's awaiting `run.finished`, and the turn ends as it does when the answer comes later.

## Files

- `UPDATE: packages/agent-cofold/src/session.ts` - `route` and `stopNow` hold a command for an open request until the run's awaiting `run.finished` is read, then use the paused path; a run that ends otherwise drops the held command.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts` - the answer and cancel cases stop waiting on `settle` before they answer.

## Steps

1. Tests first: a fake client that answers synchronously from the `session/inputNeededSet` emit, once for a confirm, once for a decline and once for a cancel; each must fail on current code with the turn never ending.
2. Remove the `settle` before the answer in the existing cases, so they fail on current code too.
3. Fix `route` and `stopNow`; a run with a live request still takes its command directly.
4. Run the file under load (several copies at once pinned to 2 CPUs, as in the flake work) and record the failure rate before and after.

## Validation

- The new cases and the existing ones pass, with no fixed waits before an answer.
- Load runs: 0 failures after the fix.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

- **Done:** in `packages/agent-cofold/src/session.ts`, `pausing` (L304) is the pause a live run owes once it has announced a request: `owePause` starts it and `payPause` settles it with whether the run paused. `apply` holds an opened request in `pending` just before its `session/inputNeededSet` goes out (`hold`, L580), so an answer given inside that emit finds it, and a live, non-replayed request starts the owed pause. The run's `run.finished` settles it (L618), true for `awaiting`; `settleTurn` settles it false (L514).
- `route` (L686) and `stopNow` (L725) wait on the owed pause while `paused` is unset, then go the paused way (`rejoin`); a run that ended any other way drops what was held. A replayed request owes nothing, so a resumed run with a live request still takes its command directly.
- **Tests:** in `packages/agent-cofold/test/agent-cofold-tools.test.ts`, `open` takes an `onEmit` hook. There are three new cases that answer inside the `session/inputNeededSet` emit: an approval (tool runs, turn completes), a decline (`after` sent, no file, turn completes) and a cancel (turn cancelled, `after` sent). The `settle` helper and its three calls before an answer or cancel are gone.
- **Failed first:** on the old `session.ts` all three new cases and the three existing answer and cancel cases failed with `timed out waiting` on the turn's end, in every run (6 of 30 in the file).
- **Load:** the file, 6 copies at once pinned to 2 CPUs with 2 busy loops: before, those 6 cases failed in 12 of 12 runs; after, 0 failures in 24 runs.
- **Departure:** the request goes into `pending` before its `session/inputNeededSet` is emitted rather than after the whole batch, because an answer inside the emit otherwise finds no request; the plan's checklist asks for that case.
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean (8 packages, none undeclared). Full `pnpm test` three times with both plans built: 1710 of 1710 passed each run; runs 1 and 2 exited 0, run 3 exited 1 on one unhandled rejection after teardown in `packages/sdk/test/host.test.ts` (`git rev-parse` in a removed temp directory, reached through `summaryMoved`), which host/28 task 01 records.

