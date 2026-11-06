---
title: A backend hands its list to the host
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/events.ts#L28-L47](../../../../packages/sdk/src/types/events.ts#L28-L47) - `EventName`, the closed set of host events"
  - "[code://packages/sdk/src/types/events.ts#L184-L196](../../../../packages/sdk/src/types/events.ts#L184-L196) - `ToolCallEvent`, the shape of an event about a call"
  - "[code://packages/sdk/src/types/plugin.ts#L919](../../../../packages/sdk/src/types/plugin.ts#L919) - `on`, how a plugin hears an event"
---

## Objective

A backend hands the host a harness's whole list, or one change to it, for a session and a chat.
A plugin hears it, so the tasks plugin can write the session's plan.

## Files

- `UPDATE: packages/sdk/src/types/events.ts:28-47` - add the event `plan_update`, with its type.
- `UPDATE: packages/sdk/src/types/session.ts` - add the call a backend makes to hand the host a list.
- `UPDATE: packages/sdk/src/host/spawn.ts` - raise the event when a backend makes the call.
- `UPDATE: packages/sdk/test/host-tools.test.ts` - a backend's call reaches a plugin's handler.

## Steps

1. Add the host event `plan_update`, which a plugin hears with `on`.
2. Carry the session, the chat, the turn, the harness, the tool and the sender in the event.
3. Carry the session's title, where the session has one.
4. Carry either a whole list of entries or one change with the harness's own id.
5. Give each entry its text, its status and its priority, as the harness sent them.
6. Add the event to the list in `docs/plugins/PLUGINS.md`.

## Validation

- `packages/sdk/test/host-tools.test.ts`: a fake backend hands a whole list. A plugin's handler gets it with the session, the sender and the title.
- `packages/sdk/test/host-tools.test.ts`: a fake backend hands one change, and the handler gets the harness's id.
- `packages/sdk/test/host-tools.test.ts`: a session with no title hands the event without one.
- `pnpm typecheck` passes.

## Resume

- **Done so far:** every step, and the title answer of 2026-10-18. `plan_update` is in `EventName` and `HostEvent`, and `PlanUpdateEvent` carries `session`, `chat`, `turn`, `harness`, `tool`, `title`, `sender`, and either `entries` or `change`. The payload types are in `packages/sdk/src/types/session.ts`. The backend's call is `Start.planUpdate`. `packages/sdk/src/host/spawn.ts` raises it with the session, the chat, `agent.provider`, the title and `senderOf(turn)`. `docs/plugins/PLUGINS.md` has the row. `packages/sdk/test/host-tools.test.ts` has the whole-list case with the title, the one-change case and the untitled case, and `plugin-events-fire.test.ts` subscribes to the new name.
- **Files:** `packages/sdk/src/types/events.ts`, `packages/sdk/src/types/session.ts`, `packages/sdk/src/types/agent.ts`, `packages/sdk/src/host/spawn.ts`, `packages/sdk/test/host-tools.test.ts`, `packages/sdk/test/plugin-events-fire.test.ts`, `docs/plugins/PLUGINS.md`.
- **Next action:** task 02.
- **Open questions:** none.
- **Watch out for:** the call is declared on `Start` in `types/agent.ts` rather than in `types/session.ts` as the Files list says. `session.ts` holds the payload types, the way it holds `SubagentRequest` for `Start.subagent`. The event's `session` and `chat` are the provider's spellings (`echo:/list`), as `tool_call` already is.