---
title: The host raises input needed set and removed
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/events.ts#L18-L39](../../../../packages/sdk/src/types/events.ts#L18-L39) - `EventName`, and the rule comment to rewrite"
  - "[code://packages/sdk/src/types/events.ts#L203-L218](../../../../packages/sdk/src/types/events.ts#L203-L218) - `HostEvent`, which gains two members"
  - "[code://packages/sdk/src/host.ts#L3575-L3597](../../../../packages/sdk/src/host.ts#L3575-L3597) - `emit`, where the two `fire` calls go"
  - "[code://packages/sdk/test/plugin-events-fire.test.ts](../../../../packages/sdk/test/plugin-events-fire.test.ts) - where each event is already shown to fire for a fixture plugin"
---

## Objective

A plugin that subscribes to `input_needed_set` and `input_needed_removed` is called each time a backend emits `session/inputNeededSet` or `session/inputNeededRemoved`.

## Files

- `UPDATE: packages/sdk/src/types/events.ts:18-39` - two names in `EventName`, and the rule comment rewritten to decision `a-plugin-hears-input-needed-though-a-client-does-too`.
- `UPDATE: packages/sdk/src/types/events.ts:203-218` - `InputNeededSetEvent` (`session`, `chat`, `id`, `kind`) and `InputNeededRemovedEvent` (`session`, `id`) added to `HostEvent`.
- `UPDATE: packages/sdk/src/host.ts:3575-3597` - two `fire` calls after the dispatch, beside the turn events.
- `UPDATE: packages/sdk/test/plugin-events-fire.test.ts` - the cases below.

## Steps

1. Add the two payload interfaces, each field documented, and add both to `EventName` and `HostEvent`.
2. Rewrite the comment above `EventName`: an event that repeats a state action is added only for a moment a plugin acts on without watching the session, never for a per-token delta.
3. In `emit`, after `dispatch`, raise `input_needed_set` from `action.request.id`, `action.request.chat` and `action.request.kind` when `action.type === 'session/inputNeededSet'`, and `input_needed_removed` from `action.id` when it is `session/inputNeededRemoved`.
4. Leave the event out when the identifiers are missing rather than raising one with empty strings.

## Validation

- `packages/sdk/test/plugin-events-fire.test.ts`: a scripted backend emits a set, the same set again, and a removal; the fixture sees two sets and one removal, in order, with the session, chat, id and kind.
- A handler that throws on `input_needed_set` is reported against its plugin and the action still reaches a subscribed client.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.

## Resume

Done. `EventName` carries `input_needed_set` and `input_needed_removed`, `HostEvent` gains `InputNeededSetEvent` and `InputNeededRemovedEvent`, and both are exported from `types/index.ts`. `kind` is typed `` `${SessionInputRequestKind}` ``, the const enum widened to the strings the backend sends, the same way `automations.ts` types `origin.kind`.

In `emit`, the two `fire` calls sit beside the turn events, after the dispatch, guarded on a non-empty `id` and, for the set, a non-empty `chat`.

Tests: three cases in `plugin-events-fire.test.ts` on a scripted backend that hands the test its emitter - a set, the same set again and a removal arrive as two sets and one removal in order with the session, chat, id and kind; a set and a removal with no id raise nothing; and a handler that throws on `input_needed_set` is reported against `probe` while the action still reaches a subscribed client.

`pnpm test` 2040 passed, `pnpm exec tsc --noEmit` clean, `pnpm boundary` clean.

