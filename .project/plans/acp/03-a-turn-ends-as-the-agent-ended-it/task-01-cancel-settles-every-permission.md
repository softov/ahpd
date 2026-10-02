---
title: Cancel settles every pending permission
status: done
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L987-L997](../../../../packages/agent-acp/src/session.ts#L987-L997) - cancel"
  - "[code://packages/agent-acp/src/session.ts#L1161](../../../../packages/agent-acp/src/session.ts#L1161) - close already settles them"
---

## Objective

Before `session/cancel`, each pending permission is settled `cancelled` and its input-needed entry removed.

## Files

- `UPDATE: packages/agent-acp/src/session.ts:987-997`.

## Steps

1. Reuse what close does at line 1161.
2. Emit the input-needed removal for each.

## Validation

- A fixture that asks permission, then a cancel: the server receives `cancelled`, and no entry is left.
