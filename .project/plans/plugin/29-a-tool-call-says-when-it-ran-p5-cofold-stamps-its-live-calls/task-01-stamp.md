---
title: cofold tool calls carry their start and end live too, and restored calls keep their kind
status: done
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/mapping.ts#L370-L393](../../../../packages/agent-cofold/src/mapping.ts#L370-L393) - `tool.proposed`, which holds the part and sends `toolKind` on `chat/toolCallStart`"
  - "[code://packages/agent-cofold/src/mapping.ts#L517-L542](../../../../packages/agent-cofold/src/mapping.ts#L517-L542) - `tool.started`, which sends `chat/toolCallReady` with no `_meta` and drops the event's `at`"
  - "[code://packages/agent-cofold/src/mapping.ts#L544-L556](../../../../packages/agent-cofold/src/mapping.ts#L544-L556) - `tool.completed`, which drops the event's `at` and `durationMs`"
  - "[code://packages/agent-cofold/src/mapping.ts#L564-L585](../../../../packages/agent-cofold/src/mapping.ts#L564-L585) - `tool.denied`, a call the run refused before it started"
  - "[code://packages/agent-cofold/src/tools.ts#L306-L323](../../../../packages/agent-cofold/src/tools.ts#L306-L323) - `toolCompleteAction`, which takes no `_meta`"
  - "[code://packages/agent-cofold/src/transcript.ts#L107-L133](../../../../packages/agent-cofold/src/transcript.ts#L107-L133) - `callPartOf`: restored calls carry unprefixed `durationMs`, `startedAt` and `endedAt`, and lose `toolKind` because it does not merge `toolMetaOf`"
  - "[code://packages/agent-cofold/src/transcript.ts#L205-L217](../../../../packages/agent-cofold/src/transcript.ts#L205-L217) - the restored times, gathered from each run's `tool.started` and `tool.completed` events"
  - "[code://packages/agent-cofold/test/agent-cofold-store.test.ts#L337](../../../../packages/agent-cofold/test/agent-cofold-store.test.ts#L337) - asserts the bare `durationMs` today"
---

## Objective

Live, a call's `_meta` takes `tool.started`'s `at` as start and `tool.completed`'s `at` and `durationMs` as end.
Restored, a call keeps its `toolKind` beside its times, and the times it already has move to the `ahpd.` names.

## Files

- `UPDATE: packages/agent-cofold/src/mapping.ts:517-542` - `tool.started` writes the start onto the held part's `_meta` and sends that whole `_meta` on its `chat/toolCallReady`.
- `UPDATE: packages/agent-cofold/src/mapping.ts:544-556` - `tool.completed` writes the end and `durationMs` onto the held part and sends the whole `_meta` on its `chat/toolCallComplete`.
- `UPDATE: packages/agent-cofold/src/tools.ts:306-323` - `toolCompleteAction` takes an optional `meta` and sends it as `_meta`, as `toolStartAction` does.
- `UPDATE: packages/agent-cofold/src/transcript.ts:107-133` - `callPartOf` builds `_meta` from `toolMetaOf(call.name)` and the helper's times, and writes no bare timing key.
- `UPDATE: packages/agent-cofold/test/agent-cofold-store.test.ts:337` - the `ahpd.` names, and `toolKind` on a restored shell call.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts` - the live cases below.

## Steps

1. Failing first: the cases under Validation.
2. Stamp through the sdk helper from p1 (`callTimes`, `withCallTimes`, `startOf` from `@ahpd/sdk`); the keys are `ahpd.startedAt`, `ahpd.endedAt` and `ahpd.durationMs`.
3. Live start at `tool.started`: `callTimes(event.at)` merged into the held part's `_meta` beside `toolKind`; `chat/toolCallReady` carries it.
4. Live end at `tool.completed`: `callTimes(startOf(held), event.at, event.durationMs)`; `chat/toolCallComplete` carries the whole `_meta`.
5. `tool.denied` sends no times: the call never started.
6. Restored: `callPartOf` merges `toolMetaOf(call.name)` with `callTimes(startedAt, endedAt, durationMs)`; a call with no `tool.started` takes `endedAt` minus `durationMs` as its start.
7. If [host/43 p4](../../host/43-the-wire-is-the-protocols-p4-ahpds-own-meta-keys-say-ahpd/plan.md) task 05 already renamed the restored keys, step 6 replaces its literal keys with the helper and changes no name.

## Validation

- A live call carries the three `ahpd.` keys on its complete, and `ahpd.startedAt` on its ready; a live shell call keeps `toolKind: 'terminal'` on both.
- A restored call carries `toolKind` where it has one and the three `ahpd.` keys; a restored call with no `tool.started` still has all three.
- A refused call carries none.
- No action or snapshot carries a bare `startedAt`, `endedAt` or `durationMs` in a tool call's `_meta`.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
