---
title: A plugin hears when a session needs a person
domain: plugin
status: built
priority: high
created: 2026-09-26
revalidated: 2026-10-01
requires:
  - plans/plugin/02-plugins-subscribe-to-host-events/plan.md
changes: []
creates: []
decisions:
  - decisions/a-plugin-hears-input-needed-though-a-client-does-too.md
refs:
  - "[code://packages/sdk/src/types/events.ts#L18-L39](../../../../packages/sdk/src/types/events.ts#L18-L39) - `EventName` and the rule it states, which this plan rewrites"
  - "[code://packages/sdk/src/host.ts#L3575-L3597](../../../../packages/sdk/src/host.ts#L3575-L3597) - `emit`, where `turn_start` and `turn_end` are raised from the backend's own actions; the new events are raised beside them"
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts) - one backend that emits `session/inputNeededSet`"
  - "[code://packages/agent-acp/src/session.ts](../../../../packages/agent-acp/src/session.ts) - another"
  - "[code://packages/agent-cofold/src/mapping.ts](../../../../packages/agent-cofold/src/mapping.ts) - and the third"
  - "[code://docs/PLUGINS.md#L241-L290](../../../../docs/PLUGINS.md#L241-L290) - the Events section and its table"
  - https://github.com/microsoft/agent-host-protocol/blob/main/docs/specification/session-channel.md#aggregated-input-requests - `session/inputNeededSet` and `session/inputNeededRemoved`, and the entry's `id`, `chat` and `kind`
---

## Goal

A plugin that tells a person their session is waiting on them subscribes to two events and is called when a session starts waiting and when it stops.
It needs nothing else: no client, no subscription, no host method.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "inputNeededSet|inputNeededRemoved" packages --glob '!dist'` - emitted by all three backends, never by the host itself, so every one passes through `emit` in `host.ts`.
- `rg -n "'turn_end'|'turn_start'" packages/sdk/src/host.ts` - both raised in `emit` from `chat/*` actions a client also receives, so the rule in `events.ts` is already bent there.

### Runtime path

```
backend emit('session', session/inputNeededSet) -> host.ts emit -> dispatch to the session channel
  -> [new] fire({ type: 'input_needed_set', session, chat, id, kind }) -> each plugin's handler
backend emit('session', session/inputNeededRemoved) -> host.ts emit -> dispatch
  -> [new] fire({ type: 'input_needed_removed', session, id })
```

### Gaps

- `EventName` has no event for a session that waits on a person.
- The rule in `events.ts` says such an event is refused, and the code beside it already raises two that repeat an action.
- `Not found: who started a session, or whether a client watches it, on any event - searched "principal" and "watching" in packages/sdk/src/types/events.ts.` A notifier's per-person routing and its idle delay both wait on that, and neither is in this plan.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A plugin hears a session's input needed set and removed, although a client receives the same actions](../../../decisions/a-plugin-hears-input-needed-though-a-client-does-too.md) | Softov, 2026-09-26, accepted |

| What | Source | Task |
| --- | --- | --- |
| The events are `input_needed_set` and `input_needed_removed`, named after the spec's actions | decision 1 | 01 |
| `input_needed_set` carries `session`, `chat`, `id` and `kind`; `input_needed_removed` carries `session` and `id` | the spec's `SessionInputRequestBase` and `SessionInputNeededRemovedAction` | 01 |
| Raised in `emit`, after the action is dispatched, as `turn_end` is | [`code://packages/sdk/src/host.ts#L3575-L3597`](../../../../packages/sdk/src/host.ts#L3575-L3597) | 01 |
| The rule in `events.ts` is rewritten to what decision 1 says | decision 1 | 01 |
| `docs/PLUGINS.md` lists both events | the Events table lists every event | 02 |
| "Naming a plugin" states the `@ahpd/<name>` convention | Softov, 2026-09-26 | 03 |

## Proposed architecture

- **Data flow** - a backend's action reaches `emit`, is dispatched as today, and its identifiers are copied onto the event.
- **Event flow** - `fire` calls each handler in plugin order, awaited, exactly as for every other event.
- **State flow** - none; the host keeps no copy of what it raised.
- **Layer responsibilities** - `packages/sdk/src/types/events.ts`: the two names and payloads · `packages/sdk/src/host.ts`: the two `fire` calls · `docs/PLUGINS.md`: the table.
- **Source-of-truth files** - [`code://packages/sdk/src/types/events.ts`](../../../../packages/sdk/src/types/events.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host raises input needed set and removed](task-01-the-host-raises-input-needed.md) | done | - |
| [02 - Docs](task-02-docs.md) | done | 01 |
| [03 - Naming a plugin states the @ahpd/<name> convention](task-03-naming-a-plugin.md) | done | - |

## Risks and tradeoffs

- A backend that sets an entry again under the same `id` raises the event again - the spec calls the action an upsert, so the event is one per action and a notifier dedupes by `id`.
- A handler is on the path of `emit` - the same cost every event has, and the docs already say to return and do the work after.

## Resume state

- **Done so far:** built 2026-10-01; see [implemented.md](implemented.md).
- **Next action:** the notify plugin.
- **Open questions:** none.

## Final verification checklist

- [x] A fixture plugin subscribed to both events is called once for each action a scripted backend emits, with the session, chat, id and kind.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [x] `docs/PLUGINS.md` lists both events, and "Naming a plugin" states the convention.
- [x] `plans/index.md` updated.
