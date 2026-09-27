---
title: A call moves when the agent moves it
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/mapping.ts#L122-L186](../../../../packages/agent-acp/src/mapping.ts#L122-L186) - the mapping"
---

## Objective

Ready is sent when the status leaves `pending`, or on a later `rawInput` once it has; a call that first arrives `completed` or `failed` is started, readied and completed at once.

## Files

- `UPDATE: packages/agent-acp/src/mapping.ts:122-186`.
- `UPDATE: packages/agent-acp/test/` the mapping test.

## Steps

1. Track each call's last status in the mapping.
2. A permission request for a call not yet ready readies it as `pending-confirmation`.

## Validation

- `tool_call` pending then `request_permission`: no `not-needed` sent.
- A call that arrives `completed` ends complete.

## Resume
