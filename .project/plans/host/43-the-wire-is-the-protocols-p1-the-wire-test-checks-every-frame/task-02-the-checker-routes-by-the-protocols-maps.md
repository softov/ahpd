---
title: The checker routes requests, results and notifications by the protocol's maps
status: todo
depends: [task-01-the-schema-has-one-partial-per-type.md]
layer: "tools"
refs:
  - "[code://tools/wire.mjs#L167-L205](../../../../tools/wire.mjs#L167-L205) - `frame()`, which routes snapshots, a resolved config and `action` only"
  - "[code://tools/validate.mjs](../../../../tools/validate.mjs) - runs the checker over a capture, where a request and its answer are two frames sharing an `id`"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `CommandMap` (`src/types/common/messages.ts:162-194`), `ServerNotificationMap` (`:247-257`)"
---

## Objective

`checker().frame()` checks a recorded exchange's params and result against `CommandMap[method]`, including a declared `null`, and a notification's params against `ServerNotificationMap[method]`; a method in neither map is counted in `skipped()` by name.

## Files

- `UPDATE: tools/wire.mjs:167-205` - `frame()` takes `{ asked, params, result }` and `{ asked, params, error }` beside the frames it takes today, and every `{ method, params }` notification.
- `UPDATE: tools/validate.mjs` - pairs a request and its response by `id` within one capture and hands the pair to `frame()` the same way.

## Steps

1. Read `CommandMap` and `ServerNotificationMap` from the schema's `$defs` once; each property's `params` and `result` is the `$ref` to check against.
2. A result whose declaration is `null` is checked as `{ type: 'null' }`, which the generator already emits for `null`.
3. `subscribe` and `reconnect` results are checked with each snapshot's `state` taken out, and the states are checked by `stateFor` as today, because the state union has no tag.
4. `action` keeps its envelope and payload check; the other notifications go to their params declaration.
5. A method in neither map goes into `skipped()` under its name, so the test can compare the set with its departures list.

## Validation

- `packages/sdk/test/wire.test.ts`, `a capture line` block: `{ asked: 'ping', params: {}, result: {} }` reports a defect and `result: null` none; `{ asked: 'completions', params: { channel, text: '/', position: 1 } }` reports `position` undeclared and `offset`, `kind` missing; `{ method: 'root/sessionSummaryChanged', params }` is routed to `SessionSummaryChangedParams`; `{ asked: 'shutdown' }` lands in `skipped()`.
- `pnpm wire -- packages/sdk/test/fixtures/wire.jsonl` runs and reports.

## Resume
