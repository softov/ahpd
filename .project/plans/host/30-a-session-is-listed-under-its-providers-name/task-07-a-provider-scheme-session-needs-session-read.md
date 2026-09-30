---
title: A session under its provider's scheme needs session:read
status: implemented
depends: [task-01-a-created-session-is-held-under-its-providers-name.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L6437-L6488](../../../../packages/sdk/src/host.ts#L6437-L6488) - `capabilityFor`, the subscribe gate"
---

## Objective

Subscribing to a session or one of its chats needs `session:read` whatever scheme the session is held or asked for under; any other channel is gated as today.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `capabilityFor` recognises a session channel by the host's own sessions and catalogue, not by its scheme.
- `UPDATE:` the users gate tests.

## Steps

1. Tests first: a member with `session:read` and no `file:read` subscribes to `claude:/<id>` and to its chat; a guest without `session:read` is refused; a `file:` channel still needs `file:read`.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

`capabilityFor` asks `session:read` for a `subscribe` whose channel `meantBy` resolves to a session this host holds or has listed (`sessions`, `owners`) or to a chat of one (`sessionHolding`), an annotations channel by its session; the `ahp-` prefixes are checked first as before, and anything else still needs `file:read`.
Test: `users-gate.test.ts`, `reads a session held under its provider's scheme as a session, and a file as a file`: with a `claude` backend, a member with only `session:read` subscribes to `claude:/one` and its default chat and is refused a `file:` channel, and a guest with only `file:read` is refused both.
It failed first with `m may not file:read here` on `claude:/one`.
Task 08 later gave both gates one answer, `channelKind`, which task 08's Resume describes.
Not in the plan: `dispatchNeeds`, the dispatch half of the gate, is still read by scheme, so a dispatch into `claude:/<id>` needs `file:read` and not `session:write`; it is module-level and does not see the host's sessions.

