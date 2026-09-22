---
title: A failed read is tried once more
status: todo
depends:
  - task-01-an-empty-read-is-not-remembered.md
layer: agents
refs:
  - code://packages/agent-claude/src/transcript.ts#L38-L51 - `turnsOf`'s catch, which answers `[]` for any failure
  - code://packages/agent-claude/src/transcript.ts#L56-L60 - the loop the messages feed, which a retry has to reach unchanged
  - code://test/host.test.ts#L73-L85 - `getSessionMessages` in the mock, which needs a way to fail once
  - code://test/host.test.ts#L2324-L2380 - the transcript describe the new case joins
---

## Objective

A transcript read that throws is attempted once more before it is drawn as an empty session, so a transient failure does not reach a client as a session with no turns.

## Files

- `UPDATE: packages/agent-claude/src/transcript.ts:46-51` - the `try`/`catch` around `getSessionMessages` gains a second attempt, and the catch answers `[]` only when that fails too.
- `UPDATE: test/host.test.ts:32-67` - the hoisted fake gains `throwOnce`, a count of reads that should fail.
- `UPDATE: test/host.test.ts:73-85` - `getSessionMessages` throws while that count is positive.
- `UPDATE: test/host.test.ts:181-197` - `beforeEach` resets it with the rest of the fake.
- `UPDATE: test/host.test.ts` - one case: a session whose first read throws still draws its turns.

## Steps

1. Extract the read into a small helper inside `turnsOf`, or write the two `try` blocks, so the second attempt happens only when the first threw - never on a successful empty read, which is a real answer.
2. Keep the comment above the function true: a transcript that cannot be parsed is still served as an empty session, and what the retry changes is that one transient failure is not enough to be that.
3. Add `throwOnce` to the mock and make `getSessionMessages` decrement it and throw while it is positive, after the existing one-tick wait so concurrent callers still overlap.
4. Add the case: a catalogue session, one user frame in the mock, `throwOnce = 1`, subscribe to its chat, assert the turn is drawn and that the read was attempted twice.
5. Run `pnpm test`, `pnpm typecheck` and `pnpm boundary`.

## Validation

- `test/host.test.ts` - the new case, and `reads the transcript once, however many channels ask for it at once` still at one read, because the retry is only on the failure path.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Done 2026-09-23.
`turnsOf` retries the SDK read once on a throw and answers `[]` only when that attempt fails too, and its doc comment gained the paragraph that says why.
The mock gained `throwOnce`, reset in `beforeEach`, and throws while it is positive after the existing one-tick wait, so two concurrent callers still overlap.
The case asserts the turn is drawn and that two reads were attempted, and it fails with the retry reverted.
