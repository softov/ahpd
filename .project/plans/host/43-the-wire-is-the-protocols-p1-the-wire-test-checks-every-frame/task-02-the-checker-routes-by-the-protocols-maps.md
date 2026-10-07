---
title: The checker routes requests, results and notifications by the protocol's maps
status: done
depends: [task-01-the-schema-has-one-partial-per-type.md]
layer: "tools"
refs:
  - "[code://tools/wire.mjs#L293-L357](../../../../tools/wire.mjs#L293-L357) - `frame()`, which routes by `CommandMap`, `ServerCommandMap`, `ServerNotificationMap` and `ClientNotificationMap`"
  - "[code://tools/validate.mjs](../../../../tools/validate.mjs) - runs the checker over a capture, where a request and its answer are two frames sharing an `id`"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `CommandMap` (`src/types/common/messages.ts:162-194`), `ServerNotificationMap` (`:247-257`)"
---

## Objective

`checker().frame()` checks a recorded exchange's params and result against `CommandMap[method]`, a declared `null` included. It checks a notification's params against `ServerNotificationMap[method]`. A method in neither map is counted in `skipped()` by name.

## Files

- `UPDATE: tools/wire.mjs:293-357` - `frame()` takes `{ asked, params, result }` and `{ asked, params, error }` beside the frames it takes today, and every `{ method, params }` notification.
- `UPDATE: tools/validate.mjs` - pairs a request and its response by `id` within one capture and hands the pair to `frame()` the same way.

## Steps

1. Read `CommandMap` and `ServerNotificationMap` from the schema's `$defs` once; each property's `params` and `result` is the `$ref` to check against.
2. Check a declared `null` result as `{ type: 'null' }`. The generator already emits that for `null`.
3. Check `subscribe` and `reconnect` results with each snapshot's `state` taken out. The states then go through `stateFor` as today, because the state union has no tag.
4. `action` keeps its envelope and payload check; the other notifications go to their params declaration.
5. A method in neither map goes into `skipped()` under its name. The test then compares that set with its departures list.

## Validation

- In `packages/sdk/test/wire.test.ts`, the `a capture line` block. `{ asked: 'ping', params: {}, result: {} }` reports a defect and `result: null` none. `{ asked: 'completions', params: { channel, text: '/', position: 1 } }` reports `position` undeclared and `offset`, `kind` missing. `{ method: 'root/sessionSummaryChanged', params }` routes to `SessionSummaryChangedParams`. `{ asked: 'shutdown' }` lands in `skipped()`.
- `pnpm wire -- packages/sdk/test/fixtures/wire.jsonl` runs and reports.

## Resume

Built. `node tools/validate.mjs packages/sdk/test/fixtures/wire.jsonl` reports the capture's payloads against the declarations, and the `the protocol's maps` block in `packages/sdk/test/wire.test.ts` proves each route.
