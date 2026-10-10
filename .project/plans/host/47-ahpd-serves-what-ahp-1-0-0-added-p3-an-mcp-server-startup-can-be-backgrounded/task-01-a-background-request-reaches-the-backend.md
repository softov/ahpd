---
title: A request to background an MCP startup reaches the backend that can do it
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/session.ts#L513-L516](../../../../packages/sdk/src/types/session.ts#L513-L516) - where the optional method goes"
  - "[code://packages/sdk/src/host/chatactions.ts#L890-L899](../../../../packages/sdk/src/host/chatactions.ts#L890-L899) - the case it goes beside"
  - "[code://packages/sdk/src/nested.ts#L498-L505](../../../../packages/sdk/src/nested.ts#L498-L505) - the forward it copies"
  - "[code://packages/sdk/test/host-harness.test.ts#L483-L585](../../../../packages/sdk/test/host-harness.test.ts#L483-L585) - `withServers` and the start and stop case in `turning a customization on and off`"
  - "[code://packages/sdk/test/nested-proxy.test.ts](../../../../packages/sdk/test/nested-proxy.test.ts) - an inner host behind a nested one"
  - "[code://packages/sdk/test/users-gate.test.ts](../../../../packages/sdk/test/users-gate.test.ts) - the dispatch gate's cases"
  - "[code://packages/agent-claude/test/customizations.test.ts](../../../../packages/agent-claude/test/customizations.test.ts) - the Claude backend's MCP rows"
  - "[code://docs/AHP.md#L202](../../../../docs/AHP.md#L202) - the `session/mcpServerStartRequested` row the new one goes under"
---

## Objective

`session/mcpServerBackgroundRequested` on a session channel calls the session's `backgroundMcpServerStartup(id)` when its backend has one and does nothing otherwise, with no refusal; a nested host forwards it; the Claude backend still reports no `blocking`.

## Files

- `UPDATE: packages/sdk/src/types/session.ts:513-516` - `backgroundMcpServerStartup?(id: string): Promise<boolean>`, documented as VS Code's seam: the backend emits `session/mcpServerBackgroundRequested` and the new state when it took the request, and `session/mcpServerStateChanged` restoring `blocking: true` when it could not.
- `UPDATE: packages/sdk/src/host/chatactions.ts:890-899` - a `session/mcpServerBackgroundRequested` case: `void session.backgroundMcpServerStartup?.(id)`, with no `no(...)` on `false` or absence.
- `UPDATE: packages/sdk/src/nested.ts:498-505` - `backgroundMcpServerStartup` delivers the action to the inner host and answers `true`.
- `UPDATE: packages/sdk/test/host-harness.test.ts`, `packages/sdk/test/nested-proxy.test.ts`, `packages/sdk/test/users-gate.test.ts`, `packages/agent-claude/test/customizations.test.ts` - the cases below.
- `UPDATE: docs/AHP.md` - a `session/mcpServerBackgroundRequested` row: client, served, a no-op on every backend but a nested host, as on VS Code's Claude backend.

## Steps

1. Add the method to `Session`; implement it only in `nested.ts`.
2. Add the host case; the action is never dispatched by the host itself.
3. Write the tests, then the docs row.

## Validation

- `packages/sdk/test/host-harness.test.ts`, in `turning a customization on and off`: dispatching the action for `mcp:desk` on the Claude backend produces no `is not served yet` line and no action on the session channel; with a fake session whose `backgroundMcpServerStartup` records its id, the id is recorded once.
- `packages/sdk/test/nested-proxy.test.ts`: the outer dispatch reaches the inner host as `session/mcpServerBackgroundRequested` with the same id, and a `session/mcpServerStateChanged` the inner host sends with `{ kind: 'starting', blocking: false }` reaches the outer client.
- `packages/sdk/test/users-gate.test.ts`: a role holding only `session:read` is refused the action; `session:write` is not.
- `packages/agent-claude/test/customizations.test.ts`: a server the CLI reports `pending` is `{ kind: 'starting' }` with no `blocking` key.
- A test asserts `isActionKnownToVersion({ type: 'session/mcpServerBackgroundRequested', id: 'x' }, '0.9.0')` is `true`.
- `pnpm test` passes.

## Resume

Implemented as the steps say. The action is served: the host hands it to the session's backend when the backend has the method, and does nothing when it does not.

- `backgroundMcpServerStartup?(id: string): Promise<boolean>` on `Session` in `packages/sdk/src/types/session.ts`, after `stopMcpServer`, documented as VS Code's own name for the seam and as optional rather than refused.
- `packages/sdk/src/host/chatactions.ts`: a `session/mcpServerBackgroundRequested` case beside the start and stop cases, `void session.backgroundMcpServerStartup?.(String(action.id ?? ''))`, with no `no(...)` on `false` and none on absence. Nothing is emitted from here, so a backend that cannot background leaves every other client's view of the server alone.
- `packages/sdk/src/nested.ts`: `backgroundMcpServerStartup` delivers `session/mcpServerBackgroundRequested` to the inner host and answers `true`. It does not wait for the inner answer. Whether the server was blocking is the inner session's own state, and the answer is the same action either way.
- `docs/AHP.md`: the `session/*` heading is 29 of 29, and the new row sits under `session/mcpServerStopRequested`. The row is `client`, served, and names the Claude backend as the reason it is a no-op there.

Tests written:

- `packages/sdk/test/host-harness.test.ts`, in `turning a customization on and off`: `says nothing to a request to background a startup, since nothing here waits on one` - no `is not served yet` line, and the action count on the session channel is unchanged - and `hands a background request to a backend that has the call, once, with the id`.
- `packages/sdk/test/nested-proxy.test.ts`: `a background request is handed to the host inside, and its answer comes back out`. The inner host is a real ahpd behind the nested one. Its backend is the scripted session, which emits the action and then `{ kind: 'starting', blocking: false }`, and both reach the outer client.
- `packages/sdk/test/users-gate-dispatch.test.ts`: `asks a role for the session write before it lets one background an MCP startup`. A `session:read` holder is refused at the gate with `session:configure`; a `session:write` holder is not.
- `packages/agent-claude/test/customizations.test.ts`: `reports a server the CLI is still connecting to as starting, with no blocking flag`. A test only: `customizationsOf` already maps the CLI's `pending` to `{ kind: 'starting' }` with no `blocking` key.
- `packages/sdk/test/conformance.test.ts`: `sends a background request to a 0.9.0 connection`.
- `packages/sdk/test/ahp-test-cases.test.ts`: the protocol's three cases for this action left `NOT_REPLAYED` and `HOST_REFUSED` and now replay with an empty difference. The suite's counts move from 208 and 62 to 205 and 59. The trailing count of cases that ran and agreed moves from 29 to 32.

Departures from the task:

- The task names `packages/sdk/test/users-gate.test.ts`, which host/55 split into one file per area; the dispatch gate's cases live in `packages/sdk/test/users-gate-dispatch.test.ts`.
- `packages/sdk/test/ahp-test-cases.test.ts` and `packages/sdk/test/conformance.test.ts` are not in the task's Files list. The suite asserts exactly this claim about the action, so it moves with it. `conformance.test.ts` is the action's one Validation bullet, and it is listed as a file for that reason.
- The case no longer produces `is not served yet`. No test asserted that line for this action. `ahp-test-cases.test.ts` counted the action's three cases in `HOST_REFUSED`, though, so the refusal's end shows in the counts.

Not verified: a backend that holds a turn back on a starting server. None in this repository does. No test drives a real `blocking: true` to `blocking: false` transition. The nested case's inner backend is the scripted one that emits the state. The gates ran green on 2026-10-09: `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck`, `pnpm boundary`, and the full suite at 4690 tests in 265 files.
