---
title: Options are controls
status: done
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L229-L245](../../../../packages/agent-acp/src/session.ts#L229-L245) - the schema"
  - "[code://packages/agent-acp/src/session.ts#L1099-L1140](../../../../packages/agent-acp/src/session.ts#L1099-L1140) - `setConfig`"
---

## Objective

Each select and boolean option is a schema property `acp.<id>`, set through `session/set_config_option`; a `mode`-category option replaces `permissionMode`'s legacy source; the client advertises boolean options.

## Files

- `UPDATE: packages/agent-acp/src/session.ts`.
- `UPDATE: packages/agent-acp/src/connection.ts` - the capability.

## Steps

1. Keep `model` and `permissionMode` as they are named today.

## Validation

- A fixture with a boolean and a select option: both drawn and set.

## Resume
