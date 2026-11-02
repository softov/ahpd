---
title: A chat's read state is its own - implemented
date: 2026-11-01
refs:
  - git://f80fcac9
  - git://487b620e
  - git://e3188e2a
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts)"
---

A chat's read bit and its session's read bit move apart, as the protocol has them.
A client that marks a chat changes that chat alone, and one that marks the session changes the session alone.
A turn's start clears its chat's bit, and leaves the session's.
A turn's end marks its chat unread, then a read session unread with the session's own action, unless the chat is a tool's or hidden.

## What was built

- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - `sessionFlag` moves the session's read bit alone, and `countedChats` and `sessionFollows` are gone.
- The same file moves a chat's bit alone after a client's chat action and after a chat's archive, which marks the chat read.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - a turn's start moves the chat's bit, with the reducer cited.
- At a turn's end the same file marks the chat, then sends `session/isReadChanged` false to a read session, with the reference host cited.
- The session's mark skips a `!` command's turn, and a chat whose origin is a tool or whose interactivity is hidden.
- A worker's end marks its own chat alone.
- [`code://packages/sdk/test/ahp-test-cases.test.ts`](../../../../packages/sdk/test/ahp-test-cases.test.ts) - case 072 runs with no divergence listed, and `BROKEN` holds no rule it breaks.
- [`code://packages/sdk/test/subagent-chat.test.ts`](../../../../packages/sdk/test/subagent-chat.test.ts) - `busyHost` folds a session's row from its `root/sessionAdded` summary, then each change.
- [`code://packages/sdk/test/host-snapshots.test.ts`](../../../../packages/sdk/test/host-snapshots.test.ts) - "marks one chat read" keeps the notes the session was added in, so its row starts there.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the rows of both read actions say what each moves, and when this host sends `session/isReadChanged` itself.

## Verified

- On `c7899eff` each changed case fails for the reason it names: 13 cases in three files, each a bit that moved with the other.
- Case 072 fails there with "what a client that only watched holds: expected [ 'chats' ] to deeply equal []".
- After `252f8c74` the three files pass with 740 tests, all 647 protocol cases among them.
- The full `pnpm run test:unit --maxWorkers=2` first failed 22 cases, with a second suite running beside it.
- Eight were tests of a session's activity that read its whole status, and expected the read bit a turn's start had cleared.
- Those eight read the status without the read bit now, as `statusAtEnd` in agent-acp already did, and their seven files pass with 222 tests.
- Thirteen were timeouts in seven files, and each file passes whole alone.
- One is `users-gate-commands`' usage pools case, which reads the current month and fails the same on `c7899eff`.
- The full run again on `252f8c74` passes 7348 tests and fails 2: the usage pools case, and a `usage-port` timeout whose file passes alone.
- The session's mark at a turn's end: on `1b292fa2` three turn-end cases fail with "expected true to be false", the session left read.
- With `b4f24e4d` they pass, and the four files that read these bits pass with 774 tests.
- With its guard taken out, the worker's test fails with "expected false to be true".
- With its guard taken out, the `!` command's test fails with "expected +0 to be 32".
- The full run on `b4f24e4d` passes 7350 tests and fails 1, the usage pools case.
- Built on the held-state plan's branch at `b7a08801`, `e3188e2a` carries `252f8c74` and `487b620e` carries `b4f24e4d`.
- Before `f80fcac9`, two of the held-state plan's tests fail with "expected undefined to be 33" and "expected +0 to be 1".
- With `f80fcac9` they pass, and eleven files that read the read bits pass with 997 tests, all 647 protocol cases among them.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- Task 01 - seven test files beyond its Files list read a session's status without the read bit.
- They are `host-chats`, `host-input`, `host-snapshots`, `host-turn`, `notes`, agent-acp's `client-tool` and agent-cofold's `turn`.
- Task 01 - four of them keep the held-state plan's assertions, which read the activity bits alone: `host-snapshots`, `host-turn`, `notes` and `client-tool`.
- Task 01 - two held-state tests fold a session's row from the row it was added with, as no change in them carries its status.
- Task 01 - the session's mark at a turn's end came in `b4f24e4d`, after `252f8c74` had left it out as an aggregate.
- It is the session's own action, filtered by the turn's own chat, and the plan's *Answers* say so.

## Left for later

- None.
