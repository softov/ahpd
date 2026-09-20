---
title: A facio conversation forks at a turn and rewinds to one
status: todo
depends: []
layer: packages/agent-facio
refs:
  - code://packages/sdk/src/types/session.ts#L189-L203 - `forkPoint` and `endPoint`, what a host asks a backend for
  - code://packages/sdk/src/types/agent.ts#L106-L121 - `Start.forkAt` and `Start.rewindAt`, what a resumed session arrives with
  - code://packages/agent-facio/src/session.ts - the session and its `create`, which this extends
  - file:///github/facio/packages/agents/src/types/store.ts - `RunRecord.inputMessageId` and `lastMessageId`, the slots a fork and a rewind cut at
  - file:///github/facio/packages/agents/src/types/run.ts - `RunArgs` and `ResumeArgs`, which today start a run from its session's whole history
  - code://packages/agent-claude/src/session.ts - a backend that already answers both
  - code://.project/decisions/facio-fork-and-rewind-needs-a-cut.md - the proposed decision this task waits on
---

## Objective

A facio session answers `forkPoint(turnId)` with the message the turn began at and `endPoint(turnId)` with the message it ended at, and `create` with `start.forkAt` or `start.rewindAt` starts a run cut at that point: a fork under a new facio session id, a rewind under the same one with what followed dropped.

## Files

- `UPDATE: packages/agent-facio/src/session.ts` - the two point methods, and the fork and rewind branches of `create`.
- `UPDATE: packages/agent-facio/src/agent.ts` - remove the comment that says fork and rewind are unmapped, and say what happens now.
- `CREATE: test/agent-facio-fork.test.ts` - the cases below.

## Steps

1. Read `RunArgs`, `ResumeArgs` and the store's messages before writing anything: facio records `inputMessageId` and `lastMessageId` per run and describes them as fork and rewind slots, but the run API may only start from a session's whole history. What facio actually offers decides steps 4 and 5, and if it offers no cut-at-a-message call then this task includes that change in `/github/facio` with its own decision, rather than a bridge that pretends.
2. Keep the message id each turn began at and ended at, keyed by the AHP turn id, from the run's events as they arrive, so `forkPoint` and `endPoint` answer for a turn this process watched.
3. Answer `undefined` for a turn not watched or one whose run the store wrote only in part, because a fork at the wrong place is worse than a fork that is not offered.
4. On `start.forkAt`, start a run at that message in a new facio session id derived from the AHP URI, so the original conversation is left whole for somebody else to find.
5. On `start.rewindAt`, cancel any live run, start at that message under the same session id, and let the truncation be what the transcript then reads.
6. Refuse a `forkAt` and a `rewindAt` together the way the SDK does, rather than choosing one silently.
7. Assert one live run after either: a rewind that left the old run writing would be two writers on one session, which facio refuses with `writer_busy`.

## Validation

- `test/agent-facio-fork.test.ts`:
  - three turns, then a fork at the second: the new session carries the first two and not the third.
  - a rewind at the second: the same session answers with two turns, and the third is gone.
  - a fork at a turn this session did not watch answers `undefined` and the host offers no fork control.
  - `forkAt` and `rewindAt` together is refused.
  - after each, one run is live and the writer claim is held by it.
- `pnpm test` green, `pnpm typecheck` green.

## Resume

Not started, and waiting on [facio-fork-and-rewind-needs-a-cut](../../decisions/facio-fork-and-rewind-needs-a-cut.md), which is proposed.
Read against facio: `run()` has no argument for the history to run on and `turn.ts` reads the whole session's messages, `Store.sessions` cannot remove messages after one, and a run record's `inputMessageId`/`lastMessageId` are the only cut points it records.
So a fork is reachable today by seeding a new facio session through the public store calls, and a rewind is not without facio gaining a truncation.
Step 1 of the task is therefore done as reconnaissance and its outcome is the decision; the implementation waits for which option is chosen.
