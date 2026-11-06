---
title: A client sees the task list
domain: plugin
status: built
priority: medium
created: 2026-10-18
revalidated: 2026-10-18
requires:
  - plans/plugin/52-p1-the-host-keeps-one-task-list/plan.md
changes: []
creates: []
refs:
  - "[code://packages/agent-acp/src/mapping.ts#L399-L412](../../../../packages/agent-acp/src/mapping.ts#L399-L412) - `plan`, the turn's one Plan call, drawn from the ACP entries today"
  - "[code://packages/agent-acp/src/mapping.ts#L420](../../../../packages/agent-acp/src/mapping.ts#L420) - `closePlan`, which completes the Plan call as the turn ends"
  - "[code://packages/agent-claude/src/input.ts#L307](../../../../packages/agent-claude/src/input.ts#L307) - `TodoWrite`, a row of its own in a Claude turn"
  - "[code://packages/sdk/src/host/facts.ts#L40-L60](../../../../packages/sdk/src/host/facts.ts#L40-L60) - `metaOf`, which composes a session's `_meta`"
  - "[code://packages/sdk/src/types/plugin.ts#L240-L268](../../../../packages/sdk/src/types/plugin.ts#L240-L268) - `PluginChannel`, a channel a plugin serves under an `x-` scheme"
  - "[code://packages/sdk/src/types/plugin.ts#L773](../../../../packages/sdk/src/types/plugin.ts#L773) - `registerChannel`"
  - "[code://packages/bot/src/catalogue.ts#L85-L96](../../../../packages/bot/src/catalogue.ts#L85-L96) - the bots channel, a plugin channel to copy"
  - "[code://.project/proposals/agent-host-protocol-extension-methods.md](../../../../.project/proposals/agent-host-protocol-extension-methods.md) - an upstream proposal, the shape to copy"
  - https://github.com/microsoft/agent-host-protocol - the protocol a plan channel is proposed to
---

## Goal

A client sees the task list in three ways.
A turn shows one Plan tool call, drawn from the host model rather than from a harness's own list.
A session's `_meta` holds the count of its open tasks, so a list of sessions can show it.
A plan channel under `x-ahpd` holds a plan as its state, and sends each change to a task as an action.
The plan channel is proposed upstream as well, and Softov reads the text before anything is filed.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "title: 'Plan'" packages/agent-acp/src` - only the ACP bridge draws a Plan call, from its own entries.
- `rg -n "metaOf" packages/sdk/src/host/facts.ts` - a session's `_meta` is composed in one place, with no part from a plugin.
- `rg -n "registerChannel" packages/bot/src` - the bots channel is the pattern for a plugin channel.

### Runtime path

```
tasks records -> tasks plugin -> Plan call in the turn / `_meta` on the session / `x-ahpd` plan channel -> client
```

### Gaps

- The Plan call shows a harness's own list, and a Claude turn shows `TodoWrite` rows.
- A plugin cannot add a key to a session's `_meta`.
- No channel holds a plan.
- No upstream text for a plan channel.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A client sees the list as one Plan tool call, an open count in the session's `_meta`, and a plan channel | Softov, 2026-10-18, "tool call, count on _meta and a channel." for "How does a client see the list first?" | 01, 02, 03 |
| The plan channel ships under `x-ahpd`, and is proposed upstream in parallel; Softov sees the text first | Softov, 2026-10-18, chose "x-ahpd now, propose too" for "The plan channel is a protocol addition. How does it ship?" | 03, 04 |
| The channel's state is the plan, and a change is an action such as `plan/taskSet` or `plan/taskAdded` | (defaulted: the request to write this plan, 2026-10-18) | 03 |
| The proposal task ends with the text shown to Softov, and nothing is posted | (defaulted: the request to write this plan, 2026-10-18) | 04 |
| The host sends one Plan call per turn, built from the session's plan; it replaces the ACP Plan call and Claude's `TodoWrite` rows | Softov, 2026-10-18, "the host sends one Plan call per turn, built from the session's plan" for "How does the host draw the Plan call?" | 01 |
| The channel is `x-ahpd-plans://<plan id>`, and its actions are `x-ahpd-plans/taskAdded`, `x-ahpd-plans/taskSet` and `x-ahpd-plans/set` | Softov, 2026-10-18, "`plan/taskAdded`, `plan/taskSet`, `plan/set`, on the channel `x-ahpd-plans://<plan id>`" for "Which form does the plan channel use?", which also answers "What is the channel's scheme and URI?"; the `x-ahpd-plans/` prefix is (defaulted: proposed by the builder, 2026-10-18; Softov may change it), because `registerChannel` refuses an action type that does not start with the scheme | 03 |
| A plugin adds to a session's `_meta` with a new registration, `registerSessionMeta(key, read)`, composed in `metaOf` | (defaulted: proposed by the planner, 2026-10-18; Softov may change it) | 02 |
| The host tells a plugin when a registered key's value moved with `host.sessionMetaChanged(uri)` beside `recordUsage`, and `metaOf` returns a map once a registered key has a value | (defaulted: proposed by the builder, 2026-10-18; Softov may change it) | 02 |
| A session's plan is the plan whose scope is `{kind:'session'}` naming the session, plus the tasks whose `session` field names it | (defaulted: proposed by the builder, 2026-10-18; Softov may change it) | 01 |
| A plugin draws the Plan call through `host.registerPlan(read)`, the host announces a change with `host.planChanged(uri)`, and `Start.plan` tells a backend the host draws the call | (defaulted: proposed by the builder, 2026-10-18; Softov may change it) | 01 |
| The key is `ahpd.tasks`, as `{ open: n }`, and it counts every status but `done` and `dropped` | (defaulted: proposed by the planner, 2026-10-18; Softov may change it) | 02 |
| A session counts the tasks of its plan and the tasks whose `session` names it | (defaulted: proposed by the planner, 2026-10-18; Softov may change it) | 02 |
| The channel asks `session:read`, which every built-in role holds | (defaulted: proposed by the planner, 2026-10-18; Softov may change it) | 03 |
| The channel state holds the plan record and the tasks that name it | (defaulted: proposed by the planner, 2026-10-18; Softov may change it) | 03 |
| When a turn end arrives while a plan update from that turn is in flight, the host holds the ending back until the row is drawn, or for two seconds, then sends the row's completion and the ending in that order | Softov, 2026-10-18, chose "Host holds turn end" for "When a list change reaches the host after its turn has ended, what should the turn's Plan row show?" | 01 |
| An update is in flight from the backend's `planUpdate` to the row being drawn: the tasks plugin's `plan_update` handler settles only after `planChanged`, and the host waits on that `fire` promise | (defaulted: proposed by the builder, 2026-10-18; Softov may change it) | 01 |
| A task removed from the store is published as `x-ahpd-plans/taskRemoved` with the task id, on the plan it was last seen on | Softov, 2026-10-18, chose "A taskRemoved action" for "When a task is removed from the store, what does a plan channel subscriber get?" | 03 |

## Proposed architecture

- **Data flow** - a write to the `tasks` or `plans` records -> the tasks plugin -> the Plan call, the session's `_meta` and the plan channel.
- **Event flow** - the tasks plugin watches its two collections, and each change publishes one channel action and one `session/metaChanged`.
- **State flow** - the records are the one source. The Plan call, the count and the channel state are views of them.
- **Layer responsibilities** - The sdk lets a plugin add a key to a session's `_meta` and draw the Plan call. The tasks plugin gives the count, the plan lines and the channel.
- **Source-of-truth files** - [`code://packages/sdk/src/host/facts.ts`](../../../../packages/sdk/src/host/facts.ts), [`code://packages/sdk/src/types/plugin.ts`](../../../../packages/sdk/src/types/plugin.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the-plan-call-is-drawn-from-the-host](task-01-the-plan-call-is-drawn-from-the-host.md) | done | - |
| [02 - a-sessions-meta-counts-its-open-tasks](task-02-a-sessions-meta-counts-its-open-tasks.md) | done | - |
| [03 - the-plan-channel-holds-a-plan](task-03-the-plan-channel-holds-a-plan.md) | done | - |
| [04 - the-upstream-text-is-shown-to-softov](task-04-the-upstream-text-is-shown-to-softov.md) | done | 03 |
| [05 - the-docs-say-how-a-client-sees-the-list](task-05-the-docs-say-how-a-client-sees-the-list.md) | done | 01, 02, 03 |

## Risks and tradeoffs

- A client that knows no `x-ahpd` channel sees only the Plan call and the count. The channel is extra, so such a client still works.
- An `x-ahpd` channel and an upstream channel can differ later. The proposal starts from the shipped shape, so a rename is the likely change.
- Each record write sends a `session/metaChanged`. A harness that rewrites its list often sends many of them.
- A turn end waits for a plan update in flight, for at most two seconds. A plugin that never settles costs the turn that wait, and the row is lost where the cap is what released it.

## Resume state

- **Done so far:** plan and tasks written 2026-10-18, with the rows moved from p1. Open questions answered 2026-10-18: the seam, the `sessionMetaChanged` announcement, the channel action names, "Host holds turn end" for a plan change that lands as the turn ends, and `x-ahpd-plans/taskRemoved` for a task taken out of the store. Tasks 01, 02, 03 and 05 are implemented and their tests pass. Task 01 holds a turn end behind a plan update in flight, capped at two seconds, and announces the sessions of session-scoped plans. Task 03 publishes a removal with the task id. Softov read task 04's proposal on 2026-10-19, and it is not filed.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none. The in-flight detection is the builder default in the answers table.
- **Watch out for:** the records are the one source. Nothing in the Plan call, the count or the channel is written back. A removal's plan is the one the channel last saw the task on, not one read at removal time.

## Final verification checklist

- [ ] A Claude turn and an ACP turn each show one Plan call, with the lines of the session's plan.
- [ ] A session's `_meta` holds its open count, and the count changes when a task is `done`.
- [ ] A client subscribed to the plan channel gets the plan, then an action for each task change.
- [ ] Softov read the proposal text, and nothing is filed.
- [ ] `docs/plugins/TASK-LIST.md` updated.
