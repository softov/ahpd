---
title: The host names the client that wrote, created or opened
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/events.ts#L48-L55](../../../../packages/sdk/src/types/events.ts#L48-L55) - `SessionStartEvent`, which names no client"
  - "[code://packages/sdk/src/types/resources.ts#L165](../../../../packages/sdk/src/types/resources.ts#L165) - a provider's `write`, which is handed the owner and not the client"
---

## Objective

A plugin can tell which client created or opened a session, and which client wrote to its resource, so the push plugin sends a device only the sessions its own client created or opened.

## Files

- `UPDATE: packages/sdk/src/types/events.ts` - `SessionStartEvent` gains `client?: string`, the id of the client that created the session; a new `session_opened` event names `session` and `client` when a client subscribes to a session channel.
- `UPDATE: packages/sdk/src/types/resources.ts` - `write` gains `client?: string` after `owner`.
- `UPDATE:` the host files that emit `session_start`, handle a session subscribe and call a provider's `write`, to pass the client id.
- `UPDATE: docs/PLUGINS.md` - the Events section names the new field and event.

## Steps

1. `session_start` carries the creating client's id; a session no client created (an automation, a session found on disk) carries none.
2. A client subscribing to a session channel emits `session_opened` once per client and session.
3. A provider's `write` is handed the writing connection's client id.

## Validation

- A test in `packages/sdk/test/` fails first: a client creates a session and a plugin hears `session_start` with that client's id; a second client subscribes and the plugin hears `session_opened` with the second id; an automation's session carries no client.
- A provider's `write` called from a client receives that client's id.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.

## Resume

Not started.
