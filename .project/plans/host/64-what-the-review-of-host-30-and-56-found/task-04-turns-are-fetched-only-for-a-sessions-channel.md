---
title: Turns are fetched only for a session's channel
status: done
depends: [task-03-a-channel-is-a-string-or-refused.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L160-L172](../../../../packages/sdk/src/host/sessionmethods.ts#L160-L172) - `fetchTurns`"
  - "[code://packages/sdk/src/host/snapshots.ts#L243](../../../../packages/sdk/src/host/snapshots.ts#L243) - `snapshotOf`'s `sessionChannel` guard"
---

## Objective

`fetchTurns` on a terminal or file name refuses rather than sending a session's turns as `chat/turnsLoaded` on that channel, as host/30 task 08 says a session id is never read out of a file or terminal name.

## Files

- `UPDATE: packages/sdk/src/host/sessionmethods.ts:160-172` - the guard.
- `UPDATE: packages/sdk/test/users-gate-names.test.ts` - the case below.

## Steps

1. Failing case first: a terminal named `ahp-terminal:/<session-id>`; `fetchTurns` on it today sends that session's turns to the terminal's subscribers.
2. Guard `fetchTurns` the way `snapshotOf` does at `snapshots.ts:243`: a channel that is not a session's or a chat's is refused `-32602` before `sessionFor` is read.

## Validation

- The case fails on `main` and passes after; `fetchTurns` on a session and on its chats is unchanged.
- `pnpm exec vitest run packages/sdk/test/users-gate*.test.ts packages/sdk/test/host-names.test.ts`.

## Resume

Built 2026-10-06.

- The case in `packages/sdk/test/users-gate-names.test.ts`, `refuses turns for a name that is nobody's session or chat`. It failed first on `c4e4dd0`: a session named `one` with a one-turn transcript, and a terminal created as `ahp-terminal:/one`, was answered with `chat/turnsLoaded` carrying that session's turn - dispatched on the terminal's channel to everyone watching it. The subscription to the terminal is what the case needs, since `turnsLoaded` goes to the watchers of the name and not to the asker.
- `fetchTurns` gained the `snapshotOf` guard: `sessionChannel(sessionOfChat(channel) ?? channel)`, refused `-32602` with `<channel> is not a session or a chat` before `sessionFor` is read. Both were added to the factory's destructure.
- The code is `-32602` as the task says. It is not what `snapshotOf` answers with for the same channel (that is `-32001 No agent for session <channel>`), and it is the code the rest of `fetchTurns` uses for a request it cannot serve as asked - the unrecognised-cursor case. The two are not visible at once: a name that is nobody's session is refused for a subscribe by `snapshotOf`, and for turns by this.
- A channel in a space this host does not know, `x:/1`, is still read as a session's, which is what `sessionFor` does with it and what host/30 says: a session a backend keeps on disk is named before anything has listed it.
- `pnpm exec vitest run packages/sdk/test/users-gate*.test.ts packages/sdk/test/host-names.test.ts packages/sdk/test/host-catalogue.test.ts packages/sdk/test/sessions.test.ts packages/sdk/test/host-snapshots.test.ts packages/sdk/test/session-provider.test.ts` passes, 206 tests.
