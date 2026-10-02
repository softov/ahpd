---
title: A plugin hears when a session needs a person - implemented
date: 2026-10-01
refs:
  - "[code://packages/sdk/src/types/events.ts](../../../../packages/sdk/src/types/events.ts)"
  - "[code://packages/sdk/src/host.ts#L3598-L3619](../../../../packages/sdk/src/host.ts#L3598-L3619)"
---

A plugin subscribes to `input_needed_set` and `input_needed_removed` and is called when a session starts and stops waiting on a person, with the session, chat, request id and kind.

## What was built

- [`code://packages/sdk/src/types/events.ts`](../../../../packages/sdk/src/types/events.ts) - the two names, `InputNeededSetEvent` and `InputNeededRemovedEvent`, and the rewritten rule above `EventName`.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - the two `fire` calls in `emit`, after dispatch, skipped when the id (or the set's chat) is missing.
- `docs/PLUGINS.md` - both events in the table, the line on events that repeat an action, and the `@ahpd/<name>` naming convention.

## Verified

- `packages/sdk/test/plugin-events-fire.test.ts`: a set, the same set again and a removal arrive as two sets and one removal in order; missing ids raise nothing; a throwing handler is reported against its plugin and the action still reaches a client.
- `pnpm exec tsc --noEmit` clean; `pnpm boundary` clean; `pnpm test` 136 files, 2040 tests passed.

## Departures from the plan

- `kind` is typed as the spec's `SessionInputRequestKind` values and is not checked at run time; the shipped backends send only `chatInput` and `toolConfirmation`.

## Left for later

- The notify plugin, and who started a session or whether a client watches it.
