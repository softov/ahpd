---
title: An automation wakes on what a session does
domain: host
status: planned
priority: medium
created: 2026-10-07
revalidated: 2026-10-07
decisions:
  - decisions/a-trigger-rule-has-a-fixed-shape.md
  - decisions/a-pinned-automation-runs-as-turns-in-one-chat.md
  - decisions/an-automation-says-what-an-overlapping-event-does.md
  - decisions/a-run-is-told-what-woke-it.md
refs:
  - "[code://packages/sdk/src/automations.ts#L94](../../../../packages/sdk/src/automations.ts#L94) - `triggers` answers no event trigger types today"
  - "[code://packages/sdk/src/host/automations.ts#L170-L205](../../../../packages/sdk/src/host/automations.ts#L170-L205) - `beginAutomation`, which makes a session and begins a turn"
  - "[code://packages/sdk/src/host/automations.ts#L233-L247](../../../../packages/sdk/src/host/automations.ts#L233-L247) - `due`, the one way a run starts without a person"
  - "[code://packages/sdk/src/scheduled.ts](../../../../packages/sdk/src/scheduled.ts) - the schedule clock, the pattern a trigger clock mirrors"
  - "[code://packages/sdk/src/types/automations.ts#L151](../../../../packages/sdk/src/types/automations.ts#L151) - `AutomationStore`"
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
| Presets: looks stuck, failing tools, long silent turn, idle after failure, waiting while busy; each a rule with editable numbers | Softov, 2026-10-07, "ship presets?": "Yes, tunable presets" | 03 |
| "No reply posted" waits for `post_message`, step 3 of the bot study | `(defaulted: the event does not exist yet)` | - |
| A plugin declares a trigger type and fires it through the SDK | Softov, 2026-10-07, "Plugins add trigger types" | 06 |
| A rule only sees sessions the automation's owner may `session:read` | `(defaulted: an event names a session and its title)` | 04 |
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
- **Source-of-truth files** - [`code://packages/sdk/src/triggers.ts`](../../../../packages/sdk/src/triggers.ts)

```ts
// packages/sdk/src/types/triggers.ts
export type SessionEventKind =
  | 'turnCompleted' | 'turnFailed' | 'turnCancelled'
  | 'toolFailed' | 'toolCalled' | 'messageQueued'
  | 'idle' | 'childFinished';

export interface SessionEvent {
  kind: SessionEventKind;
  session: string;            // ahp-session URI
  at: string;                 // ISO time
  owner?: string;
  provider?: string;
  project?: string;
  tool?: { name: string; inputHash: string };   // toolFailed, toolCalled
  turnToolCalls?: number;     // tool calls in the running turn so far
  running?: boolean;
  queued?: number;
}

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
// PluginApi
registerTriggerType(definition: TriggerTypeDefinition): void;
fireTrigger(type: string, event: string, data: Record<string, unknown>): void;
```

Trigger types the host lists: `session` (the events above, config `SessionRule` without `on`) and `watch` (the presets, config = the preset's numbers and `filter`).
Durations are `30s`, `5m`, `2h`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host emits session events](task-01-the-host-emits-session-events.md) | todo | - |
| [02 - The rule engine matches a rule](task-02-the-rule-engine-matches-a-rule.md) | todo | - |
| [03 - The host lists its trigger types and presets](task-03-the-host-lists-its-trigger-types.md) | todo | 02 |
| [04 - A matched rule starts a run that knows what woke it](task-04-a-matched-rule-starts-a-run.md) | todo | 01, 02, 03 |
| [05 - Pinned sessions and the overlap modes](task-05-pinned-sessions-and-overlap.md) | todo | 04 |
| [06 - A plugin adds a trigger type](task-06-a-plugin-adds-a-trigger-type.md) | todo | 04 |
| [07 - Docs](task-07-docs.md) | todo | 01-06 |

## Risks and tradeoffs

- A rule on every turn end of every session can fire often. The owner filter, the loop guard and the hourly cap bound it.
- A pinned chat grows with each run. The backend compacts it as it compacts any chat.
- A restart loses counts and timers, so a wake that was halfway is missed once.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-host-emits-session-events.md](task-01-the-host-emits-session-events.md).
- **Open questions:** none.
- **Watch out for:** the rule engine is pure and takes a clock, so every test runs with fake time.

## Final verification checklist

- [ ] `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` pass, every package.
- [ ] VS Code lists the `session` and `watch` trigger types in its automation editor.
- [ ] `plans/index.md` updated.
