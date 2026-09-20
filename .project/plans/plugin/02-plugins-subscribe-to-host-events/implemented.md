---
title: Plugins subscribe to the host's own events - implemented
date: 2026-09-20
refs:
  - git://76aac1d
  - code://packages/sdk/src/types/events.ts
  - code://packages/sdk/src/types/plugin.ts
  - code://packages/sdk/src/types/host.ts
  - code://packages/sdk/src/plugins.ts
  - code://packages/sdk/src/host.ts
  - code://test/plugin-events-wiring.test.ts
  - code://test/plugin-events-fire.test.ts
  - code://test/plugin-events-order.test.ts
---

A plugin can now subscribe to the host's own moments with `on`, and is told about a session opening, a turn beginning and ending, a client connecting, a store write, the host's log and the rest.
A handler observes and cannot answer: its return value is ignored, it cannot refuse or rewrite, and a handler that throws is reported against its plugin and costs a line rather than the turn.
The event set is closed and written down in one file, and a per-token delta is deliberately not one of them, because a plugin that wants the stream of a turn is a client.

## What was built

- `code://packages/sdk/src/types/events.ts` - `EventName`, one payload interface per event, `HostEvent`, `HostEventOf`, `EventHandler`, `EventListener` and `HostHandlers`.
- `code://packages/sdk/src/types/plugin.ts` - `PluginHost.on` and `Contribution.events`; the listener carries the plugin's `by`, its captured `PluginContext`, and the handler.
- `code://packages/sdk/src/types/host.ts` - `HostOptions.events`, beside the `onEvent` the embedder still passes.
- `code://packages/sdk/src/plugins.ts` - `pluginHost`'s `on` records into the contribution, and `foldHostOptions` merges every plugin's listeners after the base's own, in configuration order, leaving `events` absent when nothing subscribed.
- `code://packages/sdk/src/host.ts` - `fire`, the sequential awaiting loop with its report and its `log` re-entrancy guard, and the call sites: `log`, `openSession`, `removeSession`, the agent's `emit` for the turn boundaries, the client's `turnStarted` for `message`, the bound host tool's `run`, `initialize`/`reconnect`/`accept.close`, `authenticate`, `startForAutomation`, `resourceWrite` and `createTerminal`.

## Verified

- `test/plugin-events-wiring.test.ts` - 4 tests: one listener against its plugin, two plugins on one event in configuration order, a base listener kept ahead of them, and a plugin that subscribed to nothing adding no record.
- `test/plugin-events-fire.test.ts` - 11 tests, one per event plus the delta case: a paced turn that streamed several deltas fired `message`, `turn_start` and `turn_end` exactly once each, a cancelled turn ended with `cancelled`, a host tool that threw still fired `tool_call` with its failure, and `log` matched `onEvent` line for line.
- `test/plugin-events-order.test.ts` - 6 tests: configuration order, an asynchronous handler awaited before the next, a throwing handler reported once against its plugin with the next still running, the action not rejecting, a `log` handler that logs raising no second event, and an event with no listeners doing nothing.
- `pnpm test` green: 48 files, 731 tests; `pnpm typecheck` and `pnpm boundary` green.
- `docs/PLUGINS.md` gained the `on` surface and the event table, and the daemon's own docs link to it.

## Departures from the plan

- `EventListener` carries the `context` captured at registration, not only `by` and `handle`: `HostOptions` holds one `path` while the daemon may serve several, so rebuilding the context at fire time would hand a handler a one-directory lie. A handler's `ctx.log` is therefore the loader's writer, the same one `apply` was handed.
- `fire` catches and reports a throwing handler from task 02 rather than task 03, so no commit leaves a handler able to reject the host's action; task 03 adds the guard and the order, awaiting and isolation tests.
- Every call site discards `fire`'s promise with `void`. The host's dispatch core is synchronous and threading promises through `log` and `dispatch` was not worth it; handlers are still sequential and each is awaited, but a synchronous host moment does not block on a slow handler. This is the one place the decision's "a slow handler slows the host" is not literal.
- The `log` guard covers only the synchronous part of the raise. A flag held for the whole awaited chain swallowed unrelated host lines written while a listener was awaiting, which the first version did and `test/plugin-events-order.test.ts` caught.
- `client_connect` is raised where the client gives its id rather than where the socket is accepted, because there is no id to name before `initialize`.
- The event's `chat` is the host's canonical chat URI, which is not always the alias a client addressed.

## Left for later

- Nothing in this plan; customizations, MCP servers, `needs`/`provides`, hot reload and the rest stay in [deferred.md](../01-plugins-load-from-configuration/deferred.md).
- The agent plugins that arrive through plan 01 are still unplanned; [agents as extensions](../../ideas/agents-as-extensions.md) is the order.
