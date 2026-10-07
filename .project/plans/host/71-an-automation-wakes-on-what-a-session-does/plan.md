---
title: An automation wakes on what a session does
domain: host
status: built
priority: medium
created: 2026-10-07
revalidated: 2026-10-07
decisions:
  - decisions/a-trigger-rule-has-a-fixed-shape.md
  - decisions/a-pinned-automation-runs-as-turns-in-one-chat.md
  - decisions/an-automation-says-what-an-overlapping-event-does.md
  - decisions/a-run-is-told-what-woke-it.md
refs:
  - "[code://packages/sdk/src/automations.ts#L382](../../../../packages/sdk/src/automations.ts#L382) - `triggers`, which answered no event trigger types before task 03"
  - "[code://packages/sdk/src/host/automations.ts#L561-L708](../../../../packages/sdk/src/host/automations.ts#L561-L708) - `beginAutomation`, which makes a session and begins a turn"
  - "[code://packages/sdk/src/host/automations.ts#L1004-L1022](../../../../packages/sdk/src/host/automations.ts#L1004-L1022) - `due`, the one way a run starts without a person"
  - "[code://packages/sdk/src/scheduled.ts](../../../../packages/sdk/src/scheduled.ts) - the schedule clock, the pattern a trigger clock mirrors"
  - "[code://packages/sdk/src/types/automations.ts#L160](../../../../packages/sdk/src/types/automations.ts#L160) - `AutomationStore`"
  - "[code://packages/sdk/src/host/gate.ts#L74](../../../../packages/sdk/src/host/gate.ts#L74) - `automation:run`"
  - npm://@microsoft/agent-host-protocol@1.0.0 - `AutomationEventTrigger`, `AutomationTriggerDefinition`, `listAutomationTriggerDefinitions`, `AutomationTriggeredRunOrigin.event`
  - file:///github/ahp-review/bots/bot-steps.md - step 1 of the bot study: automations wake on events
---

## Goal

An automation can wake on what a session does, not only on a clock.
It wakes on one event, a count of events, or an event followed by quiet or by nothing.
It can also wake on a preset pattern, such as "looks stuck".
A pinned automation keeps one chat and adds a turn to it each run, and each automation says what an event does while it runs.
This is the first step of the bot study: a wake rule is an automation with an event trigger.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.
The diagrams are in [diagrams.md](diagrams.md).

### Searches performed

- `rg "triggers:" packages/sdk/src` - the store answers `[]`.
- `rg "chat/turnComplete|chat/toolCallComplete|chat/error|chat/pendingMessageSet" packages/sdk/src/host` - the host sees each event a rule needs, in its dispatch.
- The protocol's `channels-automation/state.ts` - an event trigger has `type`, `events` and `config`; a trigger type has a `configSchema`.

### Runtime path

```
chat action in dispatch -> session event -> rule engine (per automation, per session) -> fire -> overlap mode -> run: new session or next turn in the pinned chat -> message with placeholders and summary block
```

### Gaps

- The host has no stream of session events that code outside a session can read.
- Nothing evaluates a rule, and nothing keeps a count or a timer per session.
- A run always makes a new session.
- The SDK has no way for a plugin to declare or fire a trigger type.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A trigger rule is one event with an optional count, follow-up and state check](../../../decisions/a-trigger-rule-has-a-fixed-shape.md) | Softov, 2026-10-07 |
| 2 | [A pinned automation runs each time as the next turn in one chat](../../../decisions/a-pinned-automation-runs-as-turns-in-one-chat.md) | Softov, 2026-10-07 |
| 3 | [An automation says what an event does while it runs](../../../decisions/an-automation-says-what-an-overlapping-event-does.md) | Softov, 2026-10-07 |
| 4 | [A run is told what woke it, by placeholders and a summary block](../../../decisions/a-run-is-told-what-woke-it.md) | Softov, 2026-10-07 |

| What | Source | Task |
| --- | --- | --- |
| First events: a turn ends (completed, failed, cancelled), a tool call fails, a message is queued, a session goes idle, a child session finishes | Softov, 2026-10-07, "Which event triggers come first?" | 01 |
| `idle` fires when the last turn ends and nothing waits behind it; a rule that wants a quiet period says so in its own `then` | Softov, 2026-10-07, "Idle: At once, rule sets the wait" | 01 |
| `childFinished` fires for a worker chat on its session, and for a session the `create` tool started on the session that started it, from a parent link kept in the session's stored record | Softov, 2026-10-07, "childFinished: Both, record a parent at create" | 01 |
| `childFinished` for a session the `create` tool started is said when that child goes idle - its last turn ended with nothing queued behind it - and again on every later turn that goes quiet, so it is not only the child being disposed of; a worker chat keeps saying it when its turn ends | Softov, 2026-10-07, "childFinished for a create-tool child": "When the child goes idle" | 01 |
| Presets: looks stuck, failing tools, long silent turn, idle after failure, waiting while busy; each a rule with editable numbers | Softov, 2026-10-07, "ship presets?": "Yes, tunable presets" | 03 |
| "Long silent turn" needs no event to fire on: the host hands the engine each turn start as an internal signal of its own, not a public event kind, and the engine arms a timer for the rule's length | Softov, 2026-10-07, "long silent turn": "Internal timer only" | 01, 02, 03 |
| "Long silent turn" is measured from the turn's last activity rather than from its start: the timer starts again on every tool call, tool result or message chunk in that turn, so it fires only after the rule's length of nothing happening | Softov, 2026-10-07, "The long silent turn": "Really silent: reset on activity" | 01, 02, 03 |
| A rule may name a session's folders and whether a run made it, and ask how long its turn has run: every event carries the first two, and the turn start the engine is handed times the third | Softov, 2026-10-07, "filters: add both": "Yes, add both" | 01, 02, 03 |
| "No reply posted" waits for `post_message`, step 3 of the bot study | `(defaulted: the event does not exist yet)` | - |
| Dropping a plugin's trigger types when the plugin goes waits for a plugin reload, which this host does not have | Softov, 2026-10-07, "Unload: defer or plan more" | - |
| A plugin declares a trigger type and fires it through the SDK | Softov, 2026-10-07, "Plugins add trigger types" | 06 |
| A rule only sees sessions the automation's owner may `session:read`, and an owner this host has not met sees none | `(defaulted: an event names a session and its title)` | 04 |
| An automation that names no owner sees every session, and the daemon's automation settings may narrow that to none | Softov, 2026-10-07, "No owner: configurable maybe default to every?" `(defaulted: the key is unownedAutomations, beside automations, and it reads every or none)` | 04 |
| A run's own sessions never wake the automation that made them | `(defaulted: a loop guard)` | 04 |
| An automation runs at most 20 times an hour; more events are counted and dropped | `(defaulted: a guard against a rule that fires on every turn)` | 04 |
| Counts and timers live in memory and start again when the daemon restarts | `(defaulted: a restart is rare, and a lost timer misses one wake)` | 02 |
| `pinned`, `overlap` and the pinned session live in the automation's `_meta.ahpd` | `(defaulted: the protocol has no field for them)` | 05 |
| A JavaScript predicate is an idea, not this plan | decision 1 | - |

## Proposed architecture

- **Data flow** - the host turns chat actions into `SessionEvent`s. The engine keeps one state per automation and session. A match becomes a run with a trigger origin.
- **Event flow** - dispatch -> `events.emit` -> engine -> `fire(automation, event)` -> overlap -> `startForAutomation` or a turn in the pinned chat.
- **State flow** - counts and timers in the engine, in memory; the pinned session URI in `_meta.ahpd.pinnedSession` on the automation.
- **Layer responsibilities** - `sessionevents.ts`: the event stream · `triggers.ts`: the rule engine, with a clock it is given · `host/automations.ts`: fire, overlap, pinned, placeholders · `automations.ts`: trigger types.
- **Source-of-truth files** - `packages/sdk/src/triggers.ts` (made by task 02), `packages/sdk/src/host/automations.ts`.

```ts
// packages/sdk/src/types/triggers.ts
export type SessionEventKind =
  | 'turnCompleted' | 'turnFailed' | 'turnCancelled'
  | 'toolFailed' | 'toolCalled' | 'messageQueued'
  | 'idle' | 'childFinished';

export interface SessionAbout {          // what everything said about a session says
  session: string;            // ahp-session URI
  at: string;                 // ISO time
  owner?: string;
  provider?: string;
  project?: string;
  folders: string[];          // where the session works, as the catalogue has it
  automated: boolean;         // whether a run made it rather than a person
}

export interface SessionEvent extends SessionAbout {
  kind: SessionEventKind;
  tool?: { name: string; inputHash: string };   // toolFailed, toolCalled
  turnToolCalls?: number;     // tool calls in the running turn so far
  running?: boolean;
  queued?: number;
}

// The host says a turn started through `SessionEvents.turns`, and the engine
// times a long turn from it. Not a `SessionEventKind`: no rule is written on it.
export type SessionTurn = SessionAbout;

export interface SessionRule {
  on: SessionEventKind;
  filter?: { sessions?: string[]; providers?: string[]; owners?: string[]; projects?: string[]; folders?: string[]; automated?: boolean };
  count?: { n: number; consecutive?: boolean; within?: string; sameInput?: boolean };
  then?:
    | { kind: 'event'; event: SessionEventKind; within: string }
    | { kind: 'idle'; for: string }
    | { kind: 'absent'; event: SessionEventKind; for: string };
  when?: { running?: boolean; queuedAtLeast?: number; toolCallsAtLeast?: number; turnLongerThan?: string };
}

export interface AutomationWake {           // _meta.ahpd on the definition
  session?: 'new' | 'pinned';               // default 'new'
  overlap?: 'queue' | 'steer' | 'parallel' | 'skip';   // default 'queue'
  pinnedSession?: string;                   // written by the host
}

// packages/sdk/src/types/plugin.ts
export interface TriggerTypeDefinition {
  type: string; title: string; description?: string;
  events: { id: string; title: string; description?: string }[];
  configSchema?: Record<string, unknown>;
}
// PluginHost
registerTriggerType(definition: TriggerTypeDefinition): void;
fireTrigger(type: string, event: string, data: Record<string, unknown>): void;
```

Trigger types the host lists: `session` (the events above, config `SessionRule` without `on`) and `watch` (the presets, config = the preset's numbers and `filter`).
Durations are `30s`, `5m`, `2h`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host emits session events](task-01-the-host-emits-session-events.md) | done | - |
| [02 - The rule engine matches a rule](task-02-the-rule-engine-matches-a-rule.md) | done | - |
| [03 - The host lists its trigger types and presets](task-03-the-host-lists-its-trigger-types.md) | done | 02 |
| [04 - A matched rule starts a run that knows what woke it](task-04-a-matched-rule-starts-a-run.md) | done | 01, 02, 03 |
| [05 - Pinned sessions and the overlap modes](task-05-pinned-sessions-and-overlap.md) | done | 04 |
| [06 - A plugin adds a trigger type](task-06-a-plugin-adds-a-trigger-type.md) | done | 04 |
| [07 - Docs](task-07-docs.md) | done | 01-06 |

## Risks and tradeoffs

- A rule on every turn end of every session can fire often. The owner filter, the loop guard and the hourly cap bound it.
- A pinned chat grows with each run. The backend compacts it as it compacts any chat.
- A restart loses counts and timers, so a wake that was halfway is missed once.

## Resume state

- **Done so far:** every task, and the two answers of 2026-10-07 built on top of them. Task 01, the stream of session events, the turn start the engine is handed, and the parent link a child session leaves. Task 02, the rule engine, the filter on a session's folders and whether a run made it, and the timer a long turn gets. Task 03, the two trigger types and the five presets a client draws its form from. Task 04, the rules the host watches, the owner gate, the hourly cap, and the message a woken run is given. Task 05, the overlap modes and the pinned chat, with the refusal of `pinned` beside `parallel`. Task 06, a plugin's own trigger type, listed beside the host's two and fired into the automations that watch it. Task 07, the daemon and plugin docs.
- **Next action:** none. Reviewed and closed on 2026-10-07.
- **Open questions:** none. Softov settled the last two on 2026-10-07. The silent turn is the engine's own timer, fed by an internal turn start rather than a public event kind. A filter may name a session's folders and whether a run made it. Both are rows in the table above, and neither is left in [deferred.md](deferred.md).
- **Watch out for:** the rule engine is pure and takes a clock, so every test runs with fake time.

## Final verification checklist

- [x] `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` pass, every package.
- [ ] VS Code lists the `session` and `watch` trigger types in its automation editor.
- [x] `plans/index.md` updated.
