---
title: The host names the client that wrote, created or opened
status: done
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

- **Done:** implemented 2026-10-09. `SessionStartEvent` gained `client?: string` and a new `SessionOpenedEvent` (`session`, `client`) joins `EventName` and `HostEvent`; `ResourceStore.write` and `ResourceProvider.write` gained `client?: string` after `owner`. The host names the client: `openSession` fires `session_start` with the sender's client id, `routing.ts` gained `openedBy(channel, client)` which fires `session_opened` once per `(session, client)`, and `handshake.ts` (both `initialize` and `reconnect`) and `sessionmethods.ts` (subscribe) call it; `resourcemethods.ts` passes `connection.clientId` to a provider's `write`. `docs/PLUGINS.md` names the new field and event.
- **Tests:** `packages/sdk/test/plugin-events-fire.test.ts` gained `session_opened` in `EVENT_NAMES`, a test that a second client's subscribe fires `session_opened` with the second id, one that an automation's session carries no `client`, and one that a provider's `write` is handed the writing client. The third failed first, as intended.
- **Gates:** `npx tsc -p tsconfig.json --noEmit` and `pnpm boundary` pass; `packages/sdk` is 129 files and 2601 tests, all passing (schema generated first with `node tools/schema.mjs`, else five tests fail ENOENT).
- **Next action:** [task-01-a-device-registers-under-push.md](task-01-a-device-registers-under-push.md).
- **Open questions:** none.
- **Watch out for:** the `client` sits at position 4 of `write`, between `owner` and `reader`; three call sites moved for it - `packages/bot/src/provider.ts` (interface and implementation) and `packages/sdk/test/plugin-boundary.test.ts`. `openedBy` lives in `routing.ts` because that is where `heldAs`, `sessionOfChat` and `sessionChannel` are, and it shares one `opened: Set` per host keyed `<session>\u0000<client>`, so a subscribe to a session and then to a chat of it fires once.
