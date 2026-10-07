---
title: An older page of runs arrives on automation/set, and fetchAutomationRuns only acknowledges
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/automations.ts#L319-L324](../../../../packages/sdk/src/host/automations.ts#L319-L324) - `fetchAutomationRuns`"
  - "[code://packages/sdk/src/automations.ts#L25](../../../../packages/sdk/src/automations.ts#L25) - `PAGE = 20`"
  - "[code://packages/sdk/src/automations.ts#L62-L90](../../../../packages/sdk/src/automations.ts#L62-L90) - `shown()` and `entry()`, which carry the runs in view"
  - "[code://packages/sdk/src/automations.ts#L294-L303](../../../../packages/sdk/src/automations.ts#L294-L303) - `runs()`, which advances how many are shown"
  - "[code://packages/sdk/src/types/automations.ts#L221](../../../../packages/sdk/src/types/automations.ts#L221) - the port's `runs` signature"
  - "[code://packages/sdk/test/automations.test.ts](../../../../packages/sdk/test/automations.test.ts) - the paging tests, which read the entry"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `FetchAutomationRunsParams.cursor` is the entry's `runsNextCursor`, `FetchAutomationRunsResult {}` (`channels-automation/commands.ts:95-125`), `AutomationEntry.runs` and `runsNextCursor` (`channels-automation/state.ts:434-438`)"
  - "file:///github/ahpapp/src/useAutomations.ts - already reads the page from the entry"
---

## Objective

`fetchAutomationRuns` answers `{}` after the automation's entry has grown by one page, which every subscriber of `ahp-automations://` receives as `automation/set` with the longer `runs` and the next `runsNextCursor`, or none when the history is exhausted.

## Files

- `UPDATE: packages/sdk/src/automations.ts` - the store keeps how many runs each automation shows (`PAGE` to start); `entry()` slices that many and offers `runsNextCursor` when more exist; `runs(resource, cursor)` checks the cursor against the entry's own, advances the count, and announces the automation through `said()`.
- `UPDATE: packages/sdk/src/types/automations.ts:221` - `runs` answers nothing the wire carries; its doc says the page arrives on `automation/set`.
- `UPDATE: packages/sdk/src/host/automations.ts:319-324` - answers `{}`; a cursor the store does not recognise is `-32602`.
- `UPDATE: packages/sdk/test/automations.test.ts` - the paging tests read the entry.
- `UPDATE: packages/sdk/test/wire.test.ts` - the `FetchAutomationRunsResult` line leaves `KNOWN`.
- `UPDATE: docs/AHP.md` - the `fetchAutomationRuns` row says what is acknowledged and where the page arrives.

## Steps

1. Add the loaded count beside `history` in the memory store; a new run keeps the count it had, so the newest runs stay in view.
2. Make `runs()` advance the count by `PAGE` when `cursor` equals the entry's `runsNextCursor`, or when it is omitted and more runs exist; refuse any other cursor.
3. Announce the automation the way `run()` already does, so `automation/set` is dispatched before the request answers.
4. Answer `{}` from the host.

## Validation

- `packages/sdk/test/wire.test.ts` passes with the `FetchAutomationRunsResult` line gone from `KNOWN`; its automation has more than `PAGE` runs, and the fetch is followed by an `automation/set` whose entry validates as `AutomationEntry`.
- `packages/sdk/test/automations.test.ts`: 45 runs give an entry of 20 with a cursor; one fetch gives 40 and a cursor; a second gives 45 and no cursor; a stale cursor is `-32602`; a second subscriber receives the same `automation/set`.
- `pnpm test` passes.

## Resume
