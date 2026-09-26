---
title: Inner chat URIs are rewritten to the outer ones
status: todo
depends: [task-07-the-inner-hosts-pipes-cannot-crash-the-daemon.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/nested.ts#L295-L332](../../../../packages/sdk/src/nested.ts#L295-L332) - `pump`, which emits inner actions unchanged"
  - "[code://packages/sdk/src/nested.ts#L382-L389](../../../../packages/sdk/src/nested.ts#L382-L389) - the two subscriptions, default chat only"
---

## Objective

No action or snapshot the proxy emits names an inner chat URI, per [the decision](../../../decisions/a-nested-sessions-chat-uris-are-the-outer-ones.md).

## Files

- `UPDATE: packages/sdk/src/nested.ts:295-332` - `pump`.
- `UPDATE: packages/sdk/src/nested.ts:426-427` - `sessionState`, whose `chats` and `defaultChat` still name inner URIs.

## Steps

1. Keep a map from inner chat URI to outer: the inner default chat to `start.chatUri`.
2. Rewrite every field that carries a chat URI in a session action (`chat`, `changes.resource`, `session/chatAdded`'s chat and origin) and in `sessionState()`.
3. For an inner chat other than the default (a subagent chat), name an outer URI under `start.uri`, subscribe to the inner one, and forward its actions on that outer channel; if `Emit` cannot address another chat, stop and ask before widening it.

## Validation

- `test/nested-process.test.ts`: a turn through a real inner host, driven by an outer `createHost`, yields `session/chatUpdated` actions that all name the outer chat URI; today 5 of 11 name `ahp-chat://default/<base64 of the inner session>`.
- `node_modules/.bin/vitest run test/nested-process.test.ts` passes.

## Resume
