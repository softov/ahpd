---
title: A draft the chat already holds is answered
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1391-L1398](../../../../packages/sdk/src/host/chatactions.ts#L1391-L1398) - a running chat's draft"
  - "[code://packages/sdk/src/host/chatactions.ts#L427-L449](../../../../packages/sdk/src/host/chatactions.ts#L427-L449) - a draft for a session nothing is running for"
---

## Objective

A draft set to the one the chat already holds is answered to the client that sent it alone, on a running chat and on a session nothing is running for.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:1391-1398` - a draft equal to the chat state's is answered with `echoTo`; any other is handed to the backend.
- `UPDATE: packages/sdk/src/host/chatactions.ts:427-449` - a draft equal to the one this host keeps is answered with `echoTo`; any other is kept and said to everyone.
- `UPDATE: docs/sdk/AHP.md` - the `chat/draftChanged` row, and a draft under "An action that changes nothing is not a change".
- `UPDATE: packages/sdk/test/host-chats.test.ts` - a draft a running chat holds, answered to its sender alone.
- `UPDATE: packages/sdk/test/host-snapshots.test.ts` - a draft held for a session nothing is running for, answered to its sender alone.

## Steps

1. Write the two cases and run them on `a20915fb` to see the running chat answer nothing and the held draft said to every client.
2. Compare and answer in both places.
3. Bring AHP.md to what the host does.

## Validation

- The new cases fail on `a20915fb` and pass after the change.
- `host-chats`, `host-snapshots`, `session-provider`, `subagent-chat`, `wire` and `echo-origin` pass.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Resume

Done 2026-10-31.
Every step is built, and the touched suites, the type check and the boundary check pass.
