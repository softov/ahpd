---
title: A chat's read state is its own - implemented
date: 2026-11-01
refs:
  - git://252f8c74
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts)"
---

A chat's read bit and its session's read bit move apart, as the protocol has them.
A client that marks a chat changes that chat alone, and one that marks the session changes the session alone.
A turn's start clears its chat's bit and a turn's end marks its chat unread, and neither moves the session's bit.

## What was built

- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - `sessionFlag` moves the session's read bit alone, and `countedChats` and `sessionFollows` are gone.
- The same file moves a chat's bit alone after a client's chat action and after a chat's archive, which marks the chat read.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - a turn's start and end move the chat's bit alone, with the reducer and the reference host cited.
- [`code://packages/sdk/test/ahp-test-cases.test.ts`](../../../../packages/sdk/test/ahp-test-cases.test.ts) - case 072 runs with no divergence listed, and the rule it broke is gone from `BROKEN`.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the rows of both read actions say what each moves, and that a turn's start and end mark the chat alone.

## Verified

- On `c7899eff` each changed case fails for the reason it names: 13 cases in three files, each a bit that moved with the other.
- Case 072 fails there with "what a client that only watched holds: expected [ 'chats' ] to deeply equal []".
- After the change the three files pass with 740 tests, all 647 protocol cases among them.
- The full `pnpm run test:unit --maxWorkers=2` first failed 22 cases, with a second suite running beside it.
- Eight were tests of a session's activity that read its whole status, and expected the read bit a turn's start had cleared.
- Those eight read the status without the read bit now, as `statusAtEnd` in agent-acp already did, and their seven files pass with 222 tests.
- Thirteen were timeouts in seven files, and each file passes whole alone.
- One is `users-gate-commands`' usage pools case, which reads the current month and fails the same on `c7899eff`.
- The full run again on `252f8c74` passes 7348 tests and fails 2: the usage pools case, and a `usage-port` timeout whose file passes alone.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- Task 01 - seven test files beyond its Files list read a session's status without the read bit.
- They are `host-chats`, `host-input`, `host-snapshots`, `host-turn`, `notes`, agent-acp's `client-tool` and agent-cofold's `turn`.

## Left for later

- None.
