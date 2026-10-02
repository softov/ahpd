---
title: The plugin docs list the two input events
status: done
depends: [task-01-the-host-raises-input-needed.md]
layer: "docs"
refs:
  - "[code://docs/PLUGINS.md#L241-L290](../../../../docs/PLUGINS.md#L241-L290) - the Events section and its table"
---

## Objective

`docs/PLUGINS.md` lists `input_needed_set` and `input_needed_removed` with their payloads, like every other event.

## Files

- `UPDATE: docs/PLUGINS.md:241-290` - two rows in the events table, and the sentence about which events repeat a client's action.

## Steps

1. Add the two rows with their fields.
2. Say in one line that an event may repeat a state action when a plugin acts on it without watching the session, and link the decision.

## Validation

- The table names every member of `EventName`; checked by hand against `packages/sdk/src/types/events.ts`.

## Resume

Done. Two rows in the events table, after `tool_call` and in the order `EventName` declares them, and a paragraph under the table saying an event may repeat a client's action when a plugin acts on it without watching the session, linking the decision. It also says the set is an upsert keyed by `id`, so a handler dedupes by `id` rather than counting, which is the tradeoff the plan's risks section names.

Checked by hand: the table lists all 17 members of `EventName`, none missing and none extra.

