---
title: A host event is observed and awaited, and a handler cannot answer it
status: accepted
date: 2026-09-20
refs:
  - code://.project/plans/plugin/02-plugins-subscribe-to-host-events/plan.md - the plan this decision governs
  - code://.project/decisions/plugin-registration-kinds.md - `on` and why it is the one method not named `register*`
  - file:///github/pi/packages/coding-agent/src/core/extensions/types.ts#L1262-L1318 - `pi.on`, where some events return a decision and `tool_call` can block
  - file:///github/deepseek-harness/docs/cookbook/extension-cookbook.md - the waterfall listeners that return a typed decision and must call `next()`
---

## Context

Both references let a listener change what happens.
pi's `tool_call` returns `{ block: true, reason }` and its `session_before_*` events can cancel.
deepseek-harness's interception points are waterfalls that return a typed decision and must call `next()` to let the next listener see it.
That is power, and it is also what makes listener order part of the product and a plugin able to stop a turn.

ahpd already has a place for a plugin to change behaviour: it contributes a `HostTool` that decides before it runs, the port that serves, or the `Agent` that answers.
What it has no place for is knowing, which is a different thing from deciding, and the events a plugin wants are mostly the host's own bookkeeping - a session opened, a config resolved, a store written, a session nobody opened being closed - which no protocol frame carries.

## Decision

`on(event, handler)` handlers return nothing, and whatever one returns is ignored.
The host calls handlers in registration order and awaits each one inside a try, so a handler that throws is reported against its plugin and the event continues to the next handler and the host continues what it was doing.
Refusing or rewriting a host action is not available through `on`.
A plugin that wants that contributes a tool, a port or an agent, which is what those three are for.

## Consequences

A plugin can be added to a host that is already running its work without being able to break the work, which is what makes subscribing safe to offer before the hook surface is understood.
Ordering is defined, so two plugins that both log a turn see it in the order the configuration lists them, and the ordering is the loader's rather than an event's.
An event handler is on the path of the action it observes, so a slow handler slows the host: awaiting is a deliberate cost, and a plugin that wants to do something expensive does it after returning rather than inside the handler.
A refusal cannot be expressed, so a plugin whose real need is a policy writes a `HostTool` and gets it exactly, rather than approximating it with an event it cannot influence.

## Options

- **Waterfalls that return a decision**, as both references use.
  Rejected: it makes every plugin a potential stop for a turn before there is a case that needs one, and ahpd's ports and tools already cover changing what happens.
- **Fire and forget, without awaiting.**
  Rejected: an asynchronous handler that fails would have nowhere to report, ordering between two handlers would be undefined, and a test could not tell what had run.
- **An in-process client peer as the only route**, which needs no SDK change at all.
  Rejected as the only route: a client is served by the host and therefore only exists after it is built, it cannot see the host's own bookkeeping, and it would make every listener a subscriber to a channel it does not care about.
- **One named method per event**, `onSessionStart`, `onTurnEnd`, and so on.
  Rejected: the event set will grow, and a keyed `on(event, handler)` with a typed union gives the same checking with one method and one table row.
