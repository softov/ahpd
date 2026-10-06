---
title: A runs cursor the host did not issue is refused
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/automations.ts#L51-L59](../../../../packages/sdk/src/automations.ts#L51-L59) - `entry`, which issues `runsNextCursor` as `String(PAGE)`"
  - "[code://packages/sdk/src/automations.ts#L260-L269](../../../../packages/sdk/src/automations.ts#L260-L269) - `runs`, which reads any cursor it cannot parse as 0"
  - "[code://packages/sdk/src/types/automations.ts#L208-L209](../../../../packages/sdk/src/types/automations.ts#L208-L209) - the port's `runs`"
  - "[code://packages/sdk/src/host/automations.ts#L306-L310](../../../../packages/sdk/src/host/automations.ts#L306-L310) - `fetchAutomationRuns`"
  - "[code://packages/sdk/src/paging.ts#L39-L56](../../../../packages/sdk/src/paging.ts#L39-L56) - `older`, the shape to mirror"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L182-L190](../../../../packages/sdk/src/host/sessionmethods.ts#L182-L190) - `fetchTurns`'s refusal, the sentence to reuse"
  - "[code://packages/sdk/test/automations.test.ts#L438-L454](../../../../packages/sdk/test/automations.test.ts#L438-L454) - `records what it has run, and pages it`"
---

## Objective

`fetchAutomationRuns` with a cursor this host did not issue answers `-32602 Unrecognised cursor <cursor>`, and a cursor it did issue pages as today.

## Files

- `UPDATE: packages/sdk/src/types/automations.ts:208-209` - `runs` answers `{ items; nextCursor? } | undefined`, `undefined` for a cursor the store did not issue; the doc line says so.
- `UPDATE: packages/sdk/src/automations.ts:260-269` - a cursor that is not `/^\d+$/`, is 0, or is past the end of the history answers `undefined`.
- `UPDATE: packages/sdk/src/host/automations.ts:306-310` - `undefined` from the store throws `new RpcError(-32602, \`Unrecognised cursor ${cursor}\`)`.
- `UPDATE: packages/sdk/test/automations.test.ts` - the cases below.

## Steps

1. Mirror `older`: the store says "not mine" by answering nothing, and the host words the refusal.
2. An omitted cursor is the first page, as today.
3. A cursor equal to the history's length is past the end and refused, as `older` refuses `at > turns.length`.

## Validation

- Written first and seen failing (today each answers the first page): `cursor: "x"`, `cursor: "-1"` and `cursor: "999"` against an automation with three runs each answer `-32602` with `Unrecognised cursor`.
- The existing `records what it has run, and pages it` stays green, and a new case with `PAGE + 1` runs pages twice with the issued cursor.
- `pnpm exec tsc --noEmit`, `pnpm test packages/sdk/test/automations.test.ts`.

## Resume
