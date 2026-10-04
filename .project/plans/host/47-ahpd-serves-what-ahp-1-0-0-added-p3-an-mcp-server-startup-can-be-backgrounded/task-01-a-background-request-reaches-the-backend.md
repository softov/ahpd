---
title: A request to background an MCP startup reaches the backend that can do it
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/session.ts#L513-L516](../../../../packages/sdk/src/types/session.ts#L513-L516) - where the optional method goes"
  - "[code://packages/sdk/src/host.ts#L11239-L11248](../../../../packages/sdk/src/host.ts#L11239-L11248) - the case it goes beside"
  - "[code://packages/sdk/src/nested.ts#L498-L505](../../../../packages/sdk/src/nested.ts#L498-L505) - the forward it copies"
  - "[code://packages/sdk/test/host.test.ts#L3430-L3530](../../../../packages/sdk/test/host.test.ts#L3430-L3530) - `withServers` and the start and stop case"
  - "[code://packages/sdk/test/nested-proxy.test.ts](../../../../packages/sdk/test/nested-proxy.test.ts) - an inner host behind a nested one"
  - "[code://packages/sdk/test/users-gate.test.ts](../../../../packages/sdk/test/users-gate.test.ts) - the dispatch gate's cases"
  - "[code://packages/agent-claude/test/customizations.test.ts](../../../../packages/agent-claude/test/customizations.test.ts) - the Claude backend's MCP rows"
  - "[code://docs/AHP.md#L202](../../../../docs/AHP.md#L202) - the `session/mcpServerStartRequested` row the new one goes under"
---

## Objective

`session/mcpServerBackgroundRequested` on a session channel calls the session's `backgroundMcpServerStartup(id)` when its backend has one and does nothing otherwise, with no refusal; a nested host forwards it; the Claude backend still reports no `blocking`.

## Files

- `UPDATE: packages/sdk/src/types/session.ts:513-516` - `backgroundMcpServerStartup?(id: string): Promise<boolean>`, documented as VS Code's seam: the backend emits `session/mcpServerBackgroundRequested` and the new state when it took the request, and `session/mcpServerStateChanged` restoring `blocking: true` when it could not.
- `UPDATE: packages/sdk/src/host.ts:11239-11248` - a `session/mcpServerBackgroundRequested` case: `void session.backgroundMcpServerStartup?.(id)`, with no `no(...)` on `false` or absence.
- `UPDATE: packages/sdk/src/nested.ts:498-505` - `backgroundMcpServerStartup` delivers the action to the inner host and answers `true`.
- `UPDATE: packages/sdk/test/host.test.ts`, `packages/sdk/test/nested-proxy.test.ts`, `packages/sdk/test/users-gate.test.ts`, `packages/agent-claude/test/customizations.test.ts` - the cases below.
- `UPDATE: docs/AHP.md` - a `session/mcpServerBackgroundRequested` row: client, served, a no-op on every backend but a nested host, as on VS Code's Claude backend.

## Steps

1. Add the method to `Session`; implement it only in `nested.ts`.
2. Add the host case; the action is never dispatched by the host itself.
3. Write the tests, then the docs row.

## Validation

- `packages/sdk/test/host.test.ts`, in `turning a customization on and off`: dispatching the action for `mcp:desk` on the Claude backend produces no `is not served yet` line and no action on the session channel; with a fake session whose `backgroundMcpServerStartup` records its id, the id is recorded once.
- `packages/sdk/test/nested-proxy.test.ts`: the outer dispatch reaches the inner host as `session/mcpServerBackgroundRequested` with the same id, and a `session/mcpServerStateChanged` the inner host sends with `{ kind: 'starting', blocking: false }` reaches the outer client.
- `packages/sdk/test/users-gate.test.ts`: a role holding only `session:read` is refused the action; `session:write` is not.
- `packages/agent-claude/test/customizations.test.ts`: a server the CLI reports `pending` is `{ kind: 'starting' }` with no `blocking` key.
- A test asserts `isActionKnownToVersion({ type: 'session/mcpServerBackgroundRequested', id: 'x' }, '0.9.0')` is `true`.
- `pnpm test` passes.

## Resume
