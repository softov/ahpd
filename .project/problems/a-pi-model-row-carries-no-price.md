---
title: An offered pi model carries no price, though pi knows it
status: open
date: 2026-10-06
severity: minor
refs:
  - "[code://packages/agent-pi/src/models.ts#L76-L110](../../packages/agent-pi/src/models.ts#L76-L110) - `offered` copies the context window and output limit and not `Model.cost`"
  - "[code://packages/agent-pi/src/mapping.ts#L212-L234](../../packages/agent-pi/src/mapping.ts#L212-L234) - a turn's cost is pi's own `usage.cost.total`, so the turn's price is not what is missing"
  - npm://@microsoft/agent-host-protocol@^1.0.0 - `SessionModelInfo._meta`: "a `pricing` key may carry model pricing metadata"
---

## Symptom

A pi model row in the picker says its context window but not what it costs, so a person choosing between two models cannot compare their prices before a turn.

## Cause

`offered` in `models.ts` reads `contextWindow` and `maxTokens` from pi's `Model` and drops `cost`.
The turn's own cost is unaffected: `mapping.ts` sums pi's `usage.cost.total`.
cofold's rows have the same gap after plugin 35, which keeps the listed price inside the package.

## Impact

Minor: no client is known to draw `_meta.pricing` yet.

## Workaround

none

## Fix

Candidates, none chosen: put pi's `Model.cost` on the row as `_meta.pricing`, in a shape cofold's rows would share; or leave it until a client draws it.
