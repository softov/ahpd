---
title: A phone hears when a session needs a person - implemented
date: 2026-10-10
refs:
  - git://154925b
  - "[code://packages/push/src/provider.ts](../../../../packages/push/src/provider.ts)"
  - "[code://packages/push/src/send.ts](../../../../packages/push/src/send.ts)"
  - "[code://packages/push/src/plugin.ts](../../../../packages/push/src/plugin.ts)"
  - "[code://packages/sdk/src/host/routing.ts](../../../../packages/sdk/src/host/routing.ts)"
---

A phone registers for push by writing `push://devices/<id>`, and the host sends it one Expo notification when a session waits for a person.
A device gets only the sessions its client created or opened.
The host now names the client: `session_start` carries the creating client, `session_opened` names a client that subscribes, and a provider's `write` gets the writing client.

## What was built

- [`code://packages/push/src/provider.ts`](../../../../packages/push/src/provider.ts) - the `push:` scheme over `push-devices.json`, written `0600`; a read never returns the token.
- [`code://packages/push/src/send.ts`](../../../../packages/push/src/send.ts) - the Expo POST, its tickets, and the receipts read at the next send.
- [`code://packages/push/src/plugin.ts`](../../../../packages/push/src/plugin.ts) - one push per new `(session, id)` pair of `input_needed_set`.
- [`code://packages/sdk/src/host/routing.ts`](../../../../packages/sdk/src/host/routing.ts) - `openedBy`, which raises `session_opened` once per client and session.
- [`code://packages/sdk/src/types/resources.ts`](../../../../packages/sdk/src/types/resources.ts) - `write` takes the writing client before the reader.
- `packages/push/README.md` and `docs/PLUGINS.md` document the plugin.

## Verified

- `packages/push/test/provider.test.ts` and `packages/push/test/send.test.ts`, and `packages/sdk/test/plugin-events-fire.test.ts` for the two events.
- Full gates on the review tree: 271 files, 4832 tests. The push tests ran again after the token change, and the build and typecheck passed.

## Departures from the plan

- The token is write-only, by decision [a-push-token-is-write-only](../../../decisions/a-push-token-is-write-only.md), made in review.
- The checklist asked for a fixture backend's `inputNeededSet` against a stubbed endpoint. The tests drive the plugin's handlers directly instead.
- A pair is marked seen before its send, so a pair whose send failed is not sent again.
- `heldResources` in `spawn.ts` passes the new `client` argument through, a fix made in review.

## Left for later

- The end-to-end test through a fixture backend.
