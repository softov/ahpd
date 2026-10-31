---
title: A draft the chat already holds is answered - implemented
date: 2026-10-31
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1397-L1416](../../../../packages/sdk/src/host/chatactions.ts#L1397-L1416) - a running chat's draft"
  - "[code://packages/sdk/src/host/chatactions.ts#L427-L455](../../../../packages/sdk/src/host/chatactions.ts#L427-L455) - a draft for a session nothing is running for"
---

A draft set to the one the chat already holds is answered to the client that sent it, and to nobody else.
It moves nothing, so it says nothing to the other clients, as a flag set to the value it has does not.

## What was built

- [`code://packages/sdk/src/host/chatactions.ts#L1397-L1416`](../../../../packages/sdk/src/host/chatactions.ts#L1397-L1416) - a running chat compares the draft with the one its state holds, answers an equal one with `echoTo`, and hands any other to the backend.
- [`code://packages/sdk/src/host/chatactions.ts#L427-L455`](../../../../packages/sdk/src/host/chatactions.ts#L427-L455) - a session nothing is running for compares the draft with the one this host keeps for it, answers an equal one with `echoTo`, and keeps and says any other.
- [`code://docs/sdk/AHP.md#L289`](../../../../docs/sdk/AHP.md#L289), the `chat/draftChanged` row, and [`code://docs/sdk/AHP.md#L757-L759`](../../../../docs/sdk/AHP.md#L757-L759) under "An action that changes nothing is not a change".
- One case in `host-chats.test.ts` (two clients on a running chat) and one in `host-snapshots.test.ts` (two clients on a session nothing is running for): the second, unchanged draft answered to its sender with its origin and no rejection, and nothing more said to the other client.

## Verified

- On `a20915fb` both cases fail for the reasons they name: the running chat answers the unchanged draft with nothing, and the session nothing runs for says it to every client.
- After the change, `host-chats`, `host-snapshots`, `session-provider`, `subagent-chat`, `wire` and `echo-origin` pass with 166 tests.
- The round's full run, at two workers with the machine waiting on I/O (the Mac's swap nearly full and its disk pool near full): `test:unit` 102 failed and `test:processes` 295 failed, every one a timeout or a process killed or unannounced at one. One file at a time, the failed unit files pass 1097 tests with six timeouts and the failed process files pass 546 with 21 timeouts; a recheck of those fourteen files passes 334 with twelve timeouts, all in `computer-*` files, and four of those files time out the same way on the deployed union without this change (eight timeouts in 149 tests).
- `pnpm run typecheck` and `pnpm run boundary` pass.

## Departures from the plan

- none.

## Left for later

- none.
