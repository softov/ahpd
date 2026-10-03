---
title: The departures kept for VS Code are written down
status: todo
depends: []
layer: "docs"
refs:
  - "[code://docs/AHP.md#L146](../../../../docs/AHP.md#L146) - `activity: null` on `root/sessionSummaryChanged`, already explained in its row"
  - "[code://docs/AHP.md#L699-L763](../../../../docs/AHP.md#L699-L763) - the worktree and diagnostics requests, described but not marked as outside `CommandMap`"
  - "[code://packages/sdk/src/host.ts#L9284-L9312](../../../../packages/sdk/src/host.ts#L9284-L9312) - the `vscode/devContainers/*` requests and the `relayClose` and `closeConnection` notifications, which `docs/AHP.md` does not mention"
  - "[code://packages/sdk/test/wire.test.ts](../../../../packages/sdk/test/wire.test.ts) - p1's `DEPARTURES` list"
---

## Objective

`docs/AHP.md` has one section listing everything ahpd sends or serves that AHP 0.9.0 does not declare, each kept on purpose for VS Code, and it names the same entries as the wire test's `DEPARTURES` list.

## Files

- `UPDATE: docs/AHP.md` - a section after "What the window asks a host about itself": `activity: null`; `shutdown`, `getNetworkDiagnosticsInfo`, `getManagedSettingsDiagnostics`, `diagnosticsFetch`; the `vscode/*` requests; the `vscode/devContainers/*` requests and notifications; each with the reference's reason in a line and a link to where it is described.
- `UPDATE: packages/sdk/test/wire.test.ts` - reads that section and asserts every `DEPARTURES` entry is named there, and nothing more.

## Steps

1. List the served methods outside `CommandMap` (`comm` of the handler names against the map, as in the plan's searches) and the notifications outside `ServerNotificationMap`.
2. Write the section in the file's own style: it is hard-wrapped at 80 columns, so the new prose is too.
3. Make the test read the section's code spans and compare them with `DEPARTURES`.

## Validation

- `packages/sdk/test/wire.test.ts` passes, and fails when an entry is in `DEPARTURES` and not in the section, or the other way round.
- `pnpm test` passes.

## Resume
