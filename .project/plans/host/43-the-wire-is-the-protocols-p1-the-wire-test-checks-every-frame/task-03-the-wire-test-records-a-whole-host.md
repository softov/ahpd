---
title: The wire test records what the host sends, over a host with people, automations and root config
status: done
depends: [task-02-the-checker-routes-by-the-protocols-maps.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/test/wire.test.ts#L117-L129](../../../../packages/sdk/test/wire.test.ts#L117-L129) - `ana` on a team and a project, on a host given a users directory"
  - "[code://packages/sdk/test/wire.test.ts#L199-L210](../../../../packages/sdk/test/wire.test.ts#L199-L210) - `asking` records the frame `rpc.ts` sends"
  - "[code://packages/sdk/test/wire.test.ts#L442-L452](../../../../packages/sdk/test/wire.test.ts#L442-L452) - `kind`, `offset`, `property` and `claim`, the protocol's own names"
  - "[code://packages/sdk/test/wire.test.ts#L670](../../../../packages/sdk/test/wire.test.ts#L670) - the comparison with the known list and the departures"
  - "[code://packages/sdk/src/rpc.ts#L168-L182](../../../../packages/sdk/src/rpc.ts#L168-L182) - `resultFrame`, the one function the wire and the recording both use"
  - "[code://packages/server/src/rootconfig.ts](../../../../packages/server/src/rootconfig.ts) - `daemonRootConfig`, the port a `config:read` connection reads"
  - "[code://docs/AHP.md#L146](../../../../docs/AHP.md#L146) - `activity: null`, already written down as the reference's"
---

## Objective

The wire test records each answer as the frame `rpc.ts` sends, over a host whose traffic includes every field the audit found. It sends only the protocol's param names. It compares its findings with a named list of today's defects and a named list of deliberate departures.

## Files

- `UPDATE: packages/sdk/src/rpc.ts:168-182` - the result frame's `result` comes from one exported function (`resultFrame`), so the test records what the wire carries.
- `UPDATE: packages/sdk/test/wire.test.ts` - the traffic, the recorder, the param names, the two lists.
- `UPDATE: packages/sdk/src/host/facts.ts:145-212` - `describes` composes the agent's `_meta` with the host's, so a backend's own key survives on the state and on the row.

## Steps

1. Record `{ asked, params, result }` through the exported function, and `{ asked, params, error }` for a refusal.
2. Sign the connection in as `ana`, who belongs to a team and a project. The directory lists both.
3. Build the host with `daemonRootConfig` over a temporary config file. The file holds one plugin whose `optionsSchema` has a `writeOnly` string, an `integer` with `minimum`, and no titles. `ana` holds `config:read`.
4. Give the automation an owner, and run it more than once. Ask `fetchAutomationRuns` with a cursor.
5. Raise `chat/inputRequested` from a claude turn through an `AskUserQuestion` call. Create and subscribe an echo session, and ask `resolveSessionConfig` for `provider: 'echo'`.
6. Send `completions` with `kind`, `text`, `offset`; `sessionConfigCompletions` with `property`; `createTerminal` with a `claim` and no `command`.
7. Replace `expect(found).toEqual([])` with `expect(found).toEqual(KNOWN)`. `KNOWN` holds today's findings, each line with a comment naming the plan that removes it (`p2`, `p3`). A fix that removes a defect must remove its line.
8. `DEPARTURES` holds every method `skipped()` reports, and each entry names the `docs/AHP.md` heading that records it. It also holds the `activity: null` finding on `root/sessionSummaryChanged`. The list covers `shutdown`, `getNetworkDiagnosticsInfo`, `getManagedSettingsDiagnostics`, `diagnosticsFetch`, the `vscode/*` requests and the `vscode/devContainers/*` notifications. The test calls at least `getManagedSettingsDiagnostics` and one `vscode/*` request. That exercises the list. `moveChat` is in `CommandMap` and not served. It is not an entry: nothing calls it, so it is not in the traffic.
9. In `describes`, compose what the agent put in `_meta` with what the host puts there. A signed-in person makes the host write its own map. Replacing `_meta` whole erased a backend's key on the state and on the row.

## Validation

- `pnpm exec vitest run packages/sdk/test/wire.test.ts` passes, with `KNOWN` holding at least the seven `result is {}` lines. It also holds `FetchAutomationRunsResult` `items`, `ChatInputRequestedAction` `turnId`, `ResolveSessionConfigResult` and `SessionState` `config.schema` missing `type`, `SessionState` `resource`, and the `RootState /config/schema/...` lines.
- Removing a line from `KNOWN` fails the test, and adding an undeclared key to any frame fails it.
- `checked()` is well above today's 60, and the test asserts the count.

## Resume

Built. `packages/sdk/test/wire.test.ts` passes with 236 payloads checked against 508 declarations, the findings matching `KNOWN ∪ WIDENED` exactly, and `refused` holding the one deliberate departure.
