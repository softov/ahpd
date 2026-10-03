---
title: The wire test records what the host sends, over a host with people, automations and root config
status: todo
depends: [task-02-the-checker-routes-by-the-protocols-maps.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/test/wire.test.ts#L104-L130](../../../../packages/sdk/test/wire.test.ts#L104-L130) - `ana` with no team, and a directory with no teams or projects"
  - "[code://packages/sdk/test/wire.test.ts#L157-L162](../../../../packages/sdk/test/wire.test.ts#L157-L162) - `asking` records the handler's return"
  - "[code://packages/sdk/test/wire.test.ts#L272-L278](../../../../packages/sdk/test/wire.test.ts#L272-L278) - `position`, `key` and `command`, none of them the protocol's"
  - "[code://packages/sdk/test/wire.test.ts#L352](../../../../packages/sdk/test/wire.test.ts#L352) - `expect(found).toEqual([])`, which becomes the known-defects comparison"
  - "[code://packages/sdk/src/rpc.ts#L216-L221](../../../../packages/sdk/src/rpc.ts#L216-L221) - the response frame"
  - "[code://packages/server/src/rootconfig.ts](../../../../packages/server/src/rootconfig.ts) - `daemonRootConfig`, the port a `config:read` connection reads"
  - "[code://docs/AHP.md#L146](../../../../docs/AHP.md#L146) - `activity: null`, already written down as the reference's"
---

## Objective

The wire test records each answer as the frame `rpc.ts` sends, over a host whose traffic includes every field the audit found, sends only the protocol's param names, and compares its findings with a named list of today's defects and a named list of deliberate departures.

## Files

- `UPDATE: packages/sdk/src/rpc.ts:216-221` - the result frame's `result` comes from one exported function (today `result ?? {}`), so the test records what the wire carries.
- `UPDATE: packages/sdk/test/wire.test.ts` - the traffic, the recorder, the param names, the two lists.

## Steps

1. Record `{ asked, params, result }` through the exported function, and `{ asked, params, error }` for a refusal.
2. `ana` belongs to a team and a project, the directory lists them, and the connection is signed in.
3. Build the host with `daemonRootConfig` over a temporary config file holding one plugin whose `optionsSchema` has a `writeOnly` string, an `integer` with `minimum`, and no titles; `ana` holds `config:read`.
4. The automation has an owner, is run more than once, and `fetchAutomationRuns` is asked with a cursor.
5. A claude turn raises `chat/inputRequested` through an `AskUserQuestion` call, and an echo session is created and subscribed, with `resolveSessionConfig` asked for `provider: 'echo'`.
6. Send `completions` with `kind`, `text`, `offset`; `sessionConfigCompletions` with `property`; `createTerminal` with a `claim` and no `command`.
7. Replace `expect(found).toEqual([])` with `expect(found).toEqual(KNOWN)`, where `KNOWN` is today's findings, each line with a comment naming the plan that removes it (`p2`, `p3`); a fix that removes a defect must remove its line.
8. `DEPARTURES`: every method `skipped()` reports must be in it, and the test calls at least `getManagedSettingsDiagnostics` and one `vscode/*` request so the list is exercised (`shutdown`, `getNetworkDiagnosticsInfo`, `getManagedSettingsDiagnostics`, `diagnosticsFetch`, the `vscode/*` requests, the `vscode/devContainers/*` notifications) and the `activity: null` finding on `root/sessionSummaryChanged`; each entry names the `docs/AHP.md` heading that records it.

## Validation

- `pnpm exec vitest run packages/sdk/test/wire.test.ts` passes with `KNOWN` holding at least: the seven `result is {}` lines, `FetchAutomationRunsResult` `items`, `ChatInputRequestedAction` `turnId`, `ResolveSessionConfigResult` and `SessionState` `config.schema` missing `type`, `SessionState` `resource`, and the `RootState /config/schema/...` lines.
- Removing a line from `KNOWN` fails the test, and adding an undeclared key to any frame fails it.
- `checked()` is well above today's 60, and the count is asserted.

## Resume
