---
title: The host deletes a session through its agent, held or listed
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L474](../../../../packages/sdk/src/types/agent.ts#L474) - `list`, beside which `delete` goes"
  - "[code://packages/sdk/src/host/lifecycle.ts#L95-L240](../../../../packages/sdk/src/host/lifecycle.ts#L95-L240) - `removeSession`"
  - "[code://packages/sdk/src/host.ts#L2693](../../../../packages/sdk/src/host.ts#L2693) - `disposeSession`"
  - "[code://packages/sdk/src/host/catalogue.ts#L345](../../../../packages/sdk/src/host/catalogue.ts#L345) - `owners`"
---

## Objective

`Agent` has an optional `delete(id, directory)`, and `disposeSession` calls it for a session the daemon is running and for a row it only lists.

## Files

- `UPDATE: packages/sdk/src/types/agent.ts` - `delete?(id: string, directory: string): Promise<void>` after `list`, documented: removes the backend's own copy; resolves when the copy is gone or was never there.
- `UPDATE: packages/sdk/src/host/lifecycle.ts` - `removeSession` becomes async, calls the agent's `delete` after the teardown and before the broadcast; a row in `owners` and not in `sessions` is deleted through `owners.get(uri)` with no teardown.
- `UPDATE: packages/sdk/src/host.ts` - `disposeSession` awaits it; the `delete_session` tool path does the same.
- `CREATE: packages/sdk/test/session-delete.test.ts`.

## Steps

1. Add the hook to `Agent`.
2. In `removeSession`, take the agent and the session's directory before the teardown forgets them; after the teardown, `await agent.delete?.(idOf(uri), directory)`.
3. A row only in `owners`: the same delete, then `kept.forget`, `owners.delete`, and `root/sessionRemoved`. A name in neither map still answers -32001.
4. A delete that throws: log it with the session's URI, and answer the request with the error after the teardown is done.
5. An agent with no `delete`: log once per provider that its deleted sessions may be listed again.
6. Every caller of `removeSession` awaits it.

## Validation

- `session-delete.test.ts`: a held session's dispose calls `delete` once, after the chat closed; a listed row's dispose calls its owner's `delete` with no teardown and broadcasts `root/sessionRemoved`; a delete that throws answers the error and the session is still gone from `sessions`; an agent with no `delete` disposes as before and logs once; a name in neither map answers -32001.
- `pnpm exec tsc --noEmit`, `pnpm test`.

## Resume

