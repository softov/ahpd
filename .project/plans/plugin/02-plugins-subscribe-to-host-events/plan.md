---
title: Plugins subscribe to the host's own events
domain: plugin
status: built
priority: high
created: 2026-09-20
revalidated: 2026-09-20
requires:
  - plans/plugin/01-plugins-load-from-configuration/plan.md
changes: []
creates: []
decisions:
  - decisions/plugin-events-are-observed-not-answered.md
refs:
  - code://.project/ideas/plugins.md#L150-L170 - the shape this plan implements
  - code://.project/decisions/plugin-registration-kinds.md - `on` is the one method that is not a `register*`
  - code://.project/plans/plugin/01-plugins-load-from-configuration/plan.md - the loader this plan's handlers fold through
  - code://packages/sdk/src/types/host.ts#L132-L245 - `HostOptions`, which gains `events`
  - code://packages/sdk/src/types/plugin.ts - `PluginHost`, which gains `on`
  - code://packages/sdk/src/plugins.ts - `foldHostOptions`, which merges the handlers
  - code://packages/sdk/src/host.ts#L777-L783 - `log()`, the one place every notable host line already passes through
  - code://packages/sdk/src/host.ts#L3946-L4011 - `openSession`, where a session starts
  - code://packages/sdk/src/host.ts#L2929-L2935 - where a session is disposed
  - file:///github/pi/packages/coding-agent/src/core/extensions/types.ts#L1257-L1324 - `pi.on`, the subscription this mirrors
  - file:///github/deepseek-harness/docs/cookbook/extension-cookbook.md - the per-feature listener map a harness keeps
---

## Goal

A plugin that needs to know when a session started, a turn ended or a tool ran subscribes with `on` and is called, so a hook is a few lines in a plugin rather than a fork of the host.
The host keeps its own copy of what happened and hands it to whoever asked, no plugin can change what the host does by subscribing, and a plugin that throws out of an event is reported and does not stop the turn.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "log\(\`" packages/sdk/src/host.ts` - fifty-two notable lines already pass through one `log()`, so the events that are host moments have a single place to be raised from and a plugin's `log` handler costs one call there.
- `rg -n "turnStarted|turnComplete" packages/sdk/src/host.ts` - the turn boundaries arrive as protocol actions the host applies and dispatches, so a turn event is raised where the action is dispatched rather than where a backend emits it.
- `rg -n "options.onEvent" packages/sdk/src/host.ts` - one call site, inside `log()`, which is why `onEvent` becomes one handler among the rest rather than a second mechanism.
- `rg -n "interface PluginHost" packages/sdk` - it exists only as a plan, in `task-01-contract-and-fold.md`, so `on` is added to a surface that is not written yet rather than bolted onto one that is.
- `Not found: any notion of a host event - searched "event" and "hook" in packages/sdk/src/types; the only listener the SDK has today is the single `onEvent(message: string)` option, which takes no session and no payload.`

### Runtime path

```
plugin apply -> host.on('session_start', handler)
  -> foldHostOptions collects handlers into HostOptions.events, in plugin order
  -> createHost({ ..., events })
  -> a host moment (openSession, a turn action, a tool call, log)
       -> fire(event, context) -> each handler in order, awaited, each inside a try
       -> a handler that throws is reported against its plugin; the host goes on
```

### Gaps

- `HostOptions` has no `events`, and `onEvent` is one function that receives a line with no session, no provider and no turn, so a plugin cannot tell which session a line is about.
- `createHost` has no single place an event is raised from; the notable lines exist only as log strings.
- `PluginHost` has no subscription, so a plugin that wants to know something has no way to say so.
- `Not found: a test for a listener - searched "onEvent" and "events" in test/; the diagnostics test asserts the log lines, and nothing subscribes to a host moment.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A host event is observed and awaited, and a handler cannot answer it](../../../decisions/plugin-events-are-observed-not-answered.md) | Softov, asked 2026-09-20: "the plugin need to enable events.. like pi.on(\"session_start\", (_event, ctx) => {})" |

| What | Source | Task |
| --- | --- | --- |
| The option on `HostOptions` is called `events`, not `hooks` | Softov, asked 2026-09-20: "Plan 02: name the option events - events" | 01 |
| `on` is the one method not named `register*`, because it adds no contribution | [plugin-registration-kinds](../../../decisions/plugin-registration-kinds.md) | 01 |
| The handler's second argument is `PluginContext`, the same read-only context `apply` is handed | decision 1, and `ideas/plugins.md` | 01 |
| `onEvent` stays the embedder's line writer and `log` is also an event, both called from one place rather than one replacing the other | decision 1, Consequences | 01 |
| Handlers run in configuration order, which is plugin order, and a throwing handler is reported rather than fatal | decision 1 | 03 |
| Streaming a turn token by token stays a client's business, not an event | decision 1, Options | 02 |

## Proposed architecture

- **Data flow** - a plugin's `on` calls are collected into its `Contribution`, folded into `HostOptions.events` in plugin order, and `createHost` calls them at named moments.
- **Event flow** - the host raises an event at a moment it already knows about; every handler is called with the event and the read-only context; the return value is ignored.
- **State flow** - none; handlers are held for the life of the host and nothing is written.
- **Layer responsibilities** - packages/sdk/src/types/events.ts: the event union and its payloads · packages/sdk/src/types/plugin.ts: `on` and `PluginContext` · packages/sdk/src/plugins.ts: collecting and folding handlers · packages/sdk/src/host.ts: the `fire` helper and the call sites.
- **Source-of-truth files** - `code://packages/sdk/src/types/events.ts`, `code://packages/sdk/src/host.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The event option and `on`](task-01-event-option-and-on.md) | done | - |
| [02 - The first events fire](task-02-the-first-events-fire.md) | done | 01 |
| [03 - Order, awaiting, and a handler that throws](task-03-order-and-error-isolation.md) | done | 02 |

## Risks and tradeoffs

- Every handler is on the path of the action it observes, so a slow plugin slows the host - the decision says so, the docs say to return and do the work after, and the first events are coarse rather than per-token.
- An event set that grows without a rule becomes the protocol again - the set is named in one file, and an event that only repeats a state action a client already receives is refused rather than added.
- A handler holds a plugin's closure for the life of the host, so a plugin is never unloaded in this plan - hot reload stays deferred, and the handlers go when the process does.
- `onEvent` stays the daemon's own writer while `log` is also an event - the two are called from one place, and task 03 pins that a `log` handler cannot recurse through it.
- An event raised from inside `log()` can recurse if a handler logs - the `log` handler is called outside the lock the host holds while writing and a handler's own `log` call is not re-fired, which task 03 pins with a test.

## Resume state

- **Done so far:** all three tasks, done 2026-09-20, and [implemented.md](implemented.md) written.
- **Next action:** none; the plan is built. The agent plugins that arrive through plan 01 are the next domain work, with [agents as extensions](../../../ideas/agents-as-extensions.md) as the order.
- **Open questions:** none open; both were settled by the build, and the departures are in [implemented.md](implemented.md).
- **Watch out for:** the event union is the contract, so adding an event changes `@ahpd/sdk` and every handler's types; a per-token delta is deliberately not one, and the reasons are in the event file.

## Final verification checklist

- [x] `pnpm test` green, with a plugin that subscribes to two events and a handler that throws.
- [x] `pnpm typecheck` and `pnpm boundary` green.
- [x] By hand: a fixture plugin subscribed to `session_start` and `turn_end` prints on both while a session runs from `ahpc`.
- [x] `plans/index.md` updated.
