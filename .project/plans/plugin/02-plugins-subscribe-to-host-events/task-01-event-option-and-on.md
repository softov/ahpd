---
title: The event option and the `on` subscription exist
status: todo
depends: []
layer: packages/sdk
refs:
  - code://packages/sdk/src/types/host.ts#L132-L245 - `HostOptions`, which gains `events`
  - code://packages/sdk/src/types/plugin.ts - `PluginHost`, which gains `on`; `PluginContext` and the `register*` methods arrive with plan 01
  - code://packages/sdk/src/plugins.ts - `foldHostOptions`, which merges the handlers
  - code://.project/decisions/plugin-events-are-observed-not-answered.md - the handler returns nothing and is awaited
  - code://.project/decisions/plugin-registration-kinds.md - `on` is the one method not named `register*`
  - file:///github/pi/packages/coding-agent/src/core/extensions/types.ts#L1262-L1318 - `pi.on` and its per-event overloads
---

## Objective

`@ahpd/sdk` adds a `HostEvent` union and a `PluginHost.on(event, handler)` that records a listener into the plugin's contribution, which `foldHostOptions` merges into `HostOptions.events` in plugin order without disturbing handlers the base already carries. `PluginContext`, the read-only half a handler reads, arrives with plan 01.

## Files

- `CREATE: packages/sdk/src/types/events.ts` - `EventName`, the payload per event, `HostEvent`, `EventListener`, `HostHandlers`.
- `UPDATE: packages/sdk/src/types/plugin.ts` - `on` on `PluginHost` and `events` on `Contribution`; `PluginContext` is plan 01's.
- `UPDATE: packages/sdk/src/types/host.ts` - `HostOptions.events?: HostHandlers`.
- `UPDATE: packages/sdk/src/plugins.ts` - `pluginHost`'s `on` and the merge in `foldHostOptions`.
- `UPDATE: packages/sdk/src/types/index.ts` and `packages/sdk/src/index.ts` - export the types and nothing else new, since the function is `on`.
- `CREATE: test/plugin-events-wiring.test.ts` - the cases below.

## Steps

1. In `types/events.ts`, declare `EventName` as `'session_start' | 'session_end' | 'turn_start' | 'turn_end' | 'message' | 'tool_call' | 'client_connect' | 'client_disconnect' | 'authenticated' | 'automation_fire' | 'resource_write' | 'terminal_open' | 'log'`.
2. Declare one payload interface per event with the fields a handler cannot get anywhere else: the session URI and provider for the session events, the chat and turn for the turn events, the tool name and the session for `tool_call`, the client id for the connection events, the automation name for `automation_fire`, and the URI for `resource_write` and `terminal_open`.
3. Declare `HostEvent` as a discriminated union on `type`, and `HostEventOf<K extends EventName>` as the member whose `type` is `K`, so an overload can be typed per name.
4. Declare `EventListener<K extends EventName = EventName> = { by: string; handle: (event: HostEventOf<K>, context: PluginContext) => void | Promise<void> }`, where `by` is the plugin so a throwing handler can be reported against it, and `HostHandlers = { [K in EventName]?: EventListener<K>[] }`.
5. Add `on` to the `PluginHost` plan 01 declared, which already extends `PluginContext` and carries the `register*` methods.
6. Declare `on<K extends EventName>(event: K, handler: (event: HostEventOf<K>, context: PluginContext) => void | Promise<void>): void`, with a doc comment saying the return value is ignored and the handler is awaited, citing decision 1, and that it is the one method not named `register*` because it adds no contribution.
7. Add `events: HostHandlers` to `Contribution`, filled by `on` and empty when the plugin subscribes to nothing.
8. In `plugins.ts`, make `pluginHost`'s `on` push `{ by, handle: handler }` onto `contribution.events[event]`, and make `foldHostOptions` merge every contribution's `events` into `options.events` after the base's own, in contribution order, creating the record when the base has none.
9. Leave `HostOptions.onEvent` exactly as it is: it is the one line writer an embedder passes, `log` is also an event a plugin may subscribe to, and the two are called from the same place so neither is a second mechanism.
10. Declare the handler parameter as `PluginContext` and not `PluginHost`, so a handler cannot register from inside an event and the recursion that would allow is not expressible.

## Validation

- `test/plugin-events-wiring.test.ts`:
  - `host.on('session_start', fn)` records one listener whose `by` is the plugin's name.
  - two plugins subscribing to the same event fold into one list in plugin order.
  - a base `events` with its own listener keeps it, and the plugin's is appended after it.
  - a plugin that subscribes to nothing contributes `events: {}` and the fold adds nothing.
  - the folded `options.events.log` has whatever the base had plus each plugin's.
- `pnpm test` green, `pnpm typecheck` green, `pnpm boundary` green.

## Resume

Empty until started.
