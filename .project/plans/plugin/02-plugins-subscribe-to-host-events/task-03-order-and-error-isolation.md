---
title: Handlers run in order, are awaited, and a throwing one is reported
status: done
depends:
  - task-02-the-first-events-fire.md
layer: packages/sdk
refs:
  - code://packages/sdk/src/types/events.ts - `EventListener.by`, which is what a failure is reported against
  - code://packages/sdk/src/host.ts#L777-L783 - `log()`, which is also the only channel a failure can be reported on
  - code://.project/decisions/plugin-events-are-observed-not-answered.md - order, awaiting and isolation
  - file:///github/pi/packages/coding-agent/src/core/extensions/runner.ts#L885-L914 - how pi isolates a throwing handler and reports it through `onError`
---

## Objective

One helper calls the listeners of an event in registration order, awaits each, catches everything, reports a failure against the plugin that registered it through the host's own log, and returns without throwing, so a plugin that fails at an event costs a line and never the turn.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `fire`, the awaiting loop, and the report.
- `CREATE: test/plugin-events-order.test.ts` - the cases below.

## Steps

1. Write the loop in `fire`: for each listener in `options.events?.[name]`, `await listener.handle(event, context)` inside a `try`, and call the next one whatever happened.
2. Report a failure with `options.onEvent?.(...)` directly rather than through `log()`, because `log` is itself an event and reporting a failed `log` handler through `log` is the recursion this avoids.
3. Name the plugin and the event in the report: `<plugin> failed at <event>: <message>`, which is the only thing that makes a broken plugin findable when several are installed.
4. Keep a handler's own `log` call from re-entering `fire` while its `log` listener is already running, with a flag around the `log` raise, so a plugin that logs from a `log` handler is told once rather than recursing.
5. Do not let a handler's return value reach the caller of the action: `fire` returns nothing and every call site ignores it, so a handler cannot change what the host does even by returning a value a later task might be tempted to read.
6. Keep the loop allocation-free on the common path: read the listener list once per event, and return before building anything when there is none, so a host with no plugins pays a property read.

## Validation

- `test/plugin-events-order.test.ts`:
  - two plugins subscribed to `session_start` are called in the order they were configured, pinned with an array they both push to.
  - an async handler that awaits is awaited, so the second handler does not run until the first resolves.
  - a handler that throws is reported once with its plugin name and the event, and the second handler still runs.
  - a handler that throws does not reject the action that raised the event, and the session is created anyway.
  - a `log` handler that itself calls `log` fires once and does not recurse.
  - an event with no listeners does nothing and throws nothing.
- `pnpm test` green, `pnpm typecheck` green, `pnpm boundary` green.

## Resume

Done 2026-09-20.
`fire` in `host.ts` already iterated, awaited and caught from task 02; this task adds the `log` re-entrancy guard and pins everything with `test/plugin-events-order.test.ts`.
Verified: 406 tests across the plugin, host, automation, example, diagnostics and OTLP suites; `pnpm typecheck` green.
The guard covers only the synchronous part of the `log` raise, and that is deliberate: a flag held for the whole awaited chain swallowed unrelated host lines written while a listener was awaiting, which the first version did and this test caught. A handler's `ctx.log` is the loader's writer rather than this host's `log`, so the recursion cannot happen through the public surface; the guard makes it impossible anyway, and the test pins the observable property that a `log` handler which logs raises no second event.
A handler's return value is ignored and every call site discards `fire`'s promise, so a handler cannot answer the moment it observes even by returning something a later change might be tempted to read.
