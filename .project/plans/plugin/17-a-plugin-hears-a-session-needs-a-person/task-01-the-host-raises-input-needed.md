---
title: The host raises input needed set and removed
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/events.ts#L18-L39](../../../../packages/sdk/src/types/events.ts#L18-L39) - `EventName`, and the rule comment to rewrite"
  - "[code://packages/sdk/src/types/events.ts#L202-L218](../../../../packages/sdk/src/types/events.ts#L202-L218) - `HostEvent`, which gains two members"
  - "[code://packages/sdk/src/host.ts#L2992-L3007](../../../../packages/sdk/src/host.ts#L2992-L3007) - `emit`, where the two `fire` calls go"
  - "[code://test/plugin-events-fire.test.ts](../../../../test/plugin-events-fire.test.ts) - where each event is already shown to fire for a fixture plugin"
---

## Objective

A plugin that subscribes to `input_needed_set` and `input_needed_removed` is called each time a backend emits `session/inputNeededSet` or `session/inputNeededRemoved`.

## Files

- `UPDATE: packages/sdk/src/types/events.ts:18-39` - two names in `EventName`, and the rule comment rewritten to decision `a-plugin-hears-input-needed-though-a-client-does-too`.
- `UPDATE: packages/sdk/src/types/events.ts:202-218` - `InputNeededSetEvent` (`session`, `chat`, `id`, `kind`) and `InputNeededRemovedEvent` (`session`, `id`) added to `HostEvent`.
- `UPDATE: packages/sdk/src/host.ts:2992-3007` - two `fire` calls after the dispatch, beside the turn events.
- `UPDATE: test/plugin-events-fire.test.ts` - the cases below.

## Steps

1. Add the two payload interfaces, each field documented, and add both to `EventName` and `HostEvent`.
2. Rewrite the comment above `EventName`: an event that repeats a state action is added only for a moment a plugin acts on without watching the session, never for a per-token delta.
3. In `emit`, after `dispatch`, raise `input_needed_set` from `action.request.id`, `action.request.chat` and `action.request.kind` when `action.type === 'session/inputNeededSet'`, and `input_needed_removed` from `action.id` when it is `session/inputNeededRemoved`.
4. Leave the event out when the identifiers are missing rather than raising one with empty strings.

## Validation

- `test/plugin-events-fire.test.ts`: a scripted backend emits a set, the same set again, and a removal; the fixture sees two sets and one removal, in order, with the session, chat, id and kind.
- A handler that throws on `input_needed_set` is reported against its plugin and the action still reaches a subscribed client.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.

## Resume

