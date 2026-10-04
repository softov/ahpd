---
title: Only the owner, or a session:* holder, may delete a session
status: implemented
depends: [task-01-the-host-deletes-through-the-agent.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/lifecycle.ts](../../../../packages/sdk/src/host/lifecycle.ts) - `removeSession`, which every delete goes through"
  - "[code://packages/sdk/src/host/sessionmethods.ts](../../../../packages/sdk/src/host/sessionmethods.ts) - `disposeSession`, with the connection in hand"
  - "[code://packages/sdk/src/host/tooling.ts](../../../../packages/sdk/src/host/tooling.ts) - the `delete_session` tool"
  - "[code://packages/sdk/src/host/owners.ts](../../../../packages/sdk/src/host/owners.ts) - `ownerFor`, the same `user:<id>` spelling `kept.owner` records"
  - "[code://packages/sdk/src/host/gate.ts#L43](../../../../packages/sdk/src/host/gate.ts#L43) - `disposeSession: 'session:dispose'`, an operation of the `session:write` group"
---

## Objective

A member who holds `session:write` - and therefore `session:dispose` - cannot delete a session that is not theirs. Only the session's owner, or a caller holding `session:*`, can; a caller who is neither is refused and nothing is deleted.

This is what task 01 made urgent rather than what it created. Before it, a delete ended a chat and a row; now it also removes the backend's transcript and cannot be undone, and nothing anywhere asked whose the session was.

## Files

- `UPDATE: packages/sdk/src/host/lifecycle.ts` - `removeSession(uri, acting?)` takes the person asking and refuses before the teardown.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts` - `disposeSession` passes `connection.principal`.
- `UPDATE: packages/sdk/src/host/tooling.ts` - the `delete_session` tool passes the principal of the session the tool is running in.
- `CREATE: packages/sdk/test/session-delete-owner.test.ts`.

## Steps

1. In `removeSession`, first thing: no principal is no decision, so a host with no users directory is untouched and so is a root connection. Otherwise the session's owner is `kept.owner(idOf(uri))`, and a caller whose `user:<id>` is that owner may delete it.
2. `acting.can('session:*')` may delete anything - that is the wildcard an administrator's role resolves to.
3. Anything else throws `RpcError(-32009, "Only the session's owner can delete it.")`, with the caller's id and the session's URI written to the log. `-32009` is the code the users gate already refuses with, and it carries no `data.request`, which is what tells a client to stop rather than negotiate.
4. The refusal comes before the teardown and before the delete, so a session nobody was allowed to end is left exactly as it was - a half-disposed session would be worse than either answer.
5. The tool acts for the session it runs in: `forWhom(kept.owner(idOf(uri)))?.principal`, the same reference the tool's other operations use to say whose work they are.

## Validation

- `session-delete-owner.test.ts`: the owner deletes their own session and the backend is asked once; a caller holding `session:*` deletes somebody else's; a member holding `session:write` is refused `-32009` with that sentence, the backend is asked nothing and the session is still listed; a member deletes their own; a host with no users directory disposes as before.
- The same four through the `delete_session` tool: the owner's tool deletes a session of theirs, and a member's tool is refused for a session that is not his, with the backend asked nothing.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test`.

## Resume

- Nothing outstanding. The refusal is `mayDispose` in `host/lifecycle.ts`.