---
title: Deleting a session deletes the backend's copy, and a listed row can be deleted - implemented
date: 2026-10-04
refs:
  - "[code://packages/sdk/src/host/lifecycle.ts](../../../../packages/sdk/src/host/lifecycle.ts) - removeSession, the teardown, the backend delete and the owner check"
  - "[code://packages/sdk/src/types/agent.ts](../../../../packages/sdk/src/types/agent.ts) - Agent.delete"
---

`disposeSession` and the `delete_session` tool now delete the backend's own copy of a session as well as what the host holds, for a session the daemon is running and for a row it only lists. Only the session's owner, or a caller holding `session:*`, may delete it.

## What was built

- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - `removeSession` tears down a held session, then asks the agent's `delete`; a store that has no such session counts as deleted, and any other failure is reported to the caller after the clients are told the session is gone. An agent without `delete` is logged once per provider.
- `mayDispose` in the same file refuses a caller who is not the owner and does not hold `session:*`, before anything is torn down. A host with no users directory refuses nobody.
- [`code://packages/sdk/src/types/agent.ts`](../../../../packages/sdk/src/types/agent.ts) - the optional `delete(id, directory)`, checked by `validate.ts`.
- Claude deletes through the SDK's `deleteSession`; pi removes its session file only when it is under pi's own session folder; cofold deletes from its store; ACP sends `session/delete` when the server advertises it, through a getter on `delete`.
- `docs/AHP.md` says a delete is permanent.

## Verified

- `packages/sdk/test/session-delete.test.ts`, `session-delete-owner.test.ts` and one delete test per backend.
- `pnpm exec tsc --noEmit`, `pnpm boundary` pass; `pnpm test` passes 185 of 186 files, the one failure being `agent-pi-lazy.test.ts`'s 2000 ms budget, which fails the same way on main under load.

## Departures from the plan

- Task 05 was added after review, Softov, 2026-10-04: a member holding `session:write` could delete anyone's session.
- Added in review: the `delete_session` tool, run in a session whose owner has not signed in since the daemon started, acts as that owner by name and may delete only that owner's sessions. Before, it passed no principal and was refused nothing.

## Left for later

- The tasks stay `implemented` until Softov reviews them.
