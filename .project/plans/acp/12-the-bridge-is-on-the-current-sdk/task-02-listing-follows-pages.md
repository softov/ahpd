---
title: Listing follows pages on one connection
status: done
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/catalog.ts#L116-L139](../../../../packages/agent-acp/src/catalog.ts#L116-L139) - `list`"
---

## Objective

`list` follows `nextCursor` to the end and reuses one connection, closed after a minute idle.

## Files

- `UPDATE: packages/agent-acp/src/catalog.ts:116-139`.

## Steps

1. Plan 01 task 01's listeners apply to this connection too.

## Validation

- A fixture with two pages lists both; two lists spawn one process.

## Resume
