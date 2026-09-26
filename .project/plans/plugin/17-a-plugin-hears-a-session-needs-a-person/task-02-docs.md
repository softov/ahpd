---
title: The plugin docs list the two input events
status: todo
depends: [task-01-the-host-raises-input-needed.md]
layer: "docs"
refs:
  - "[code://docs/PLUGINS.md#L200-L249](../../../../docs/PLUGINS.md#L200-L249) - the Events section and its table"
---

## Objective

`docs/PLUGINS.md` lists `input_needed_set` and `input_needed_removed` with their payloads, like every other event.

## Files

- `UPDATE: docs/PLUGINS.md:200-249` - two rows in the events table, and the sentence about which events repeat a client's action.

## Steps

1. Add the two rows with their fields.
2. Say in one line that an event may repeat a state action when a plugin acts on it without watching the session, and link the decision.

## Validation

- The table names every member of `EventName`; checked by hand against `packages/sdk/src/types/events.ts`.

## Resume

