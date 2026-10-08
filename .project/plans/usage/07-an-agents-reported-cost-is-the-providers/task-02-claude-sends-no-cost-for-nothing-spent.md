---
title: Claude sends no cost for a result that spent nothing
status: implemented
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/parts.ts#L163-L190](../../../../packages/agent-claude/src/session/parts.ts#L163-L190) - `costOf`, which returns amount 0 when no model's `costUSD` changed"
---

## Objective

A `result` whose `modelUsage` shows no model spent anything since the last one sends no cost.
A turn that spent and has no tokens is explained, and its cost goes to the turn that spent it.

## Files

- `UPDATE: packages/agent-claude/src/session/parts.ts:163-190` - `costOf` returns nothing when no model's `costUSD` changed.
- `UPDATE: packages/agent-claude/test/` - the cases below.

## Steps

1. Write a test from the 2026-10-07 20:43 `claude-deepseek-build` record: a `result` with unchanged `modelUsage` sends no cost.
2. Fix `costOf`.
3. Find how a turn with no tokens got a cost on 2026-10-02 (`claude`, $0.68 and $1.36). Check whether `paid` is reset when a new `query()` starts while `modelUsage` carries on, or the reverse. Write a test for the cause and fix it.

## Validation

- A test: two `result` messages with the same `modelUsage` - the second sends no cost.
- A test for the cause step 3 finds.
- `npx vitest run packages/agent-claude` passes.

## Resume

2026-10-08. Two cases in `packages/agent-claude/test/agent-claude-usage.test.ts`. A second `result` carrying the `modelUsage` the first one left behind sends no cost, which is the 2026-10-07 20:43 `claude-deepseek-build` record. A `result` the CLI comes back with zeroed sends no cost either, and the `costUSD` baseline stays where it was, so the `result` that carries the running total back bills only what grew since the last figure that was really a figure: the 2026-10-02 `claude` costs of $0.68 and $1.36 were the second of those, the same total billed again. `costOf` now reads a figure that did not go up as no spend, and moves the baseline only for a model the result spent on. The `paid` map is not reset when a query is rebuilt, because a resumed or forked CLI continues from the total its transcript saved.

