---
title: A cofold conversation forks at a turn and rewinds to one
status: done
depends: []
layer: packages/agent-cofold
refs:
  - code://packages/sdk/src/types/session.ts#L189-L203 - `forkPoint` and `endPoint`, what a host asks a backend for
  - code://packages/sdk/src/types/agent.ts#L106-L121 - `Start.forkAt` and `Start.rewindAt`, what a resumed session arrives with
  - code://packages/agent-cofold/src/session.ts - the session and its `create`, which this extends
  - code://packages/agent-cofold/src/agent.ts - `chats: { fork: true }`, the capability a fork is offered through
  - file:///github/cofold/packages/agents/src/types/store.ts - `RunRecord.inputMessageId` and `lastMessageId`, the slots a fork and a rewind cut at
  - file:///github/cofold/packages/agents/src/store/cut.ts - `selectCut`, the one rule both stores cut by
  - file:///github/cofold/packages/store-file/src/store.ts - `truncate` and `fork`, and the `lastMessageId` an append advances
  - file:///github/cofold/packages/agents/src/types/run.ts - `RunArgs` and `ResumeArgs`, neither of which can start at a message
  - code://packages/agent-claude/src/session.ts - a backend that already answers both
  - code://test/agent-cofold-fork.test.ts - the cases
  - code://.project/decisions/facio-fork-and-rewind-needs-a-cut.md - the decision this task implements
---

## Objective

A facio session answers `forkPoint(turnId)` with the message the turn began at and `endPoint(turnId)` with the message it ended at, and `create` with `start.forkAt` or `start.rewindAt` starts a run cut at that point: a fork under a new facio session id, a rewind under the same one with what followed dropped.

## Files

- `UPDATE: packages/agent-cofold/src/session.ts` - the two point methods, and the fork and rewind branches of `create`.
- `UPDATE: packages/agent-cofold/src/agent.ts` - remove the comment that says fork and rewind are unmapped, and say what happens now.
- `CREATE: test/agent-cofold-fork.test.ts` - the cases below.

## Steps

1. Read `RunArgs`, `ResumeArgs` and the store's messages before writing anything: facio records `inputMessageId` and `lastMessageId` per run and describes them as fork and rewind slots, but the run API may only start from a session's whole history. What facio actually offers decides steps 4 and 5, and if it offers no cut-at-a-message call then this task includes that change in `/github/cofold` with its own decision, rather than a bridge that pretends.
2. Keep the message id each turn began at and ended at, keyed by the AHP turn id, from the run's events as they arrive, so `forkPoint` and `endPoint` answer for a turn this process watched.
3. Answer `undefined` for a turn not watched or one whose run the store wrote only in part, because a fork at the wrong place is worse than a fork that is not offered.
4. On `start.forkAt`, start a run at that message in a new facio session id derived from the AHP URI, so the original conversation is left whole for somebody else to find.
5. On `start.rewindAt`, cancel any live run, start at that message under the same session id, and let the truncation be what the transcript then reads.
6. Refuse a `forkAt` and a `rewindAt` together the way the SDK does, rather than choosing one silently.
7. Assert one live run after either: a rewind that left the old run writing would be two writers on one session, which facio refuses with `writer_busy`.

## Validation

- `test/agent-cofold-fork.test.ts`:
  - three turns, then a fork at the second: the new session carries the first two and not the third.
  - a rewind at the second: the same session answers with two turns, and the third is gone.
  - a fork at a turn this session did not watch answers `undefined` and the host offers no fork control.
  - `forkAt` and `rewindAt` together is refused.
  - after each, one run is live and the writer claim is held by it.
- `pnpm test` green, `pnpm typecheck` green.

## Resume

Done 2026-09-20.
`session.ts` answers `forkPoint(turnId)` with the run's `inputMessageId` and `endPoint(turnId)` with its `lastMessageId`, both read from the run record as the turn ends and before the client is told it did; a turn this process did not watch has no entry and answers nothing.
`create` cuts before the first turn: `start.forkAt` copies the resumed conversation through that message into a new facio session id with `Store.sessions.fork` and leaves the source whole, `start.rewindAt` drops what followed it in place with `Store.sessions.truncate`.
The cut rides the `opening` chain every turn already waits on.
A `forkAt` beside a `rewindAt` is refused by name, and a cut the store will not make leaves every turn answered with `chat/error` through the new `failTurn` rather than carrying on from the wrong place.
`agent.ts` advertises `chats: { fork: true }` and no side chat.
The cut itself is the change in `/github/cofold` the decision chose: `Store.sessions.truncate` and `Store.sessions.fork`, `selectCut` as the one rule both stores cut by, and `appendMessages` advancing a run's `lastMessageId`.
That last part was found missing while implementing this, because the loop never wrote the slot, and without it a cut would have dropped every run and a fork would have lost the usage and the tool timings of the turns it kept.
`test/agent-cofold-fork.test.ts` is nine cases: a fork through the session with the source still whole and the fork going on as itself, a rewind under the same id with the next turn running rather than refused `writer_busy`, no point for a turn read back off the store, both cuts asked for at once refused, a point the conversation does not hold failing the turn without appending anything, the store-level shape of a fork, a plain session still opening, and the same fork and rewind driven through `createHost` by `createChat` with `source.kind: 'fork'` and by a `chat/truncated` dispatch.
Verified: the eight facio test files 60 passed, the full suite 790 passed with one pre-existing `host.test.ts` `create-pr` flake that passes alone and is untouched here, `pnpm typecheck` green, `pnpm boundary` green.
Departures from the plan: a fork cuts at the prompt of the turn rather than at its end, which is what `forkPoint` means and what lets the forked turn be asked again; `start.forkAt` with no `start.resume` is refused rather than forked from nothing; `endPoint` is answered from the store's run record rather than tracked off the events, because the last message a run writes is a tool result, a steer or a cancel marker that no event names, and a guessed point would drop a kept turn's log.
