---
title: The host advertises its subjects in ahpd.grants
status: todo
depends: [task-01-operations-and-groups-are-one-table.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/root.ts#L171-L186](../../../../packages/sdk/src/host/root.ts#L171-L186) - `advertisedSchemes`, the function this one sits beside, whose `order` at :176 names operations after the provider's methods"
  - "[code://packages/sdk/src/host/root.ts#L204](../../../../packages/sdk/src/host/root.ts#L204) - root state `_meta`"
  - "[code://packages/sdk/src/host/handshake.ts#L262](../../../../packages/sdk/src/host/handshake.ts#L262) - `initialize` `_meta`"
  - "[code://docs/COMPUTER.md#L92-L104](../../../../docs/COMPUTER.md#L92-L104) - the `ahpd.resourceProviders` example, with `read` and `write`"
  - "[code://docs/PLUGINS.md#L250-L274](../../../../docs/PLUGINS.md#L250-L274) - where a plugin author is told the host adds `operations`"
  - "[code://docs/USERS.md#L471-L473](../../../../docs/USERS.md#L471-L473) - the people schemes' advertisement"
  - "[code://packages/computer/test/computer-plugin.test.ts#L180](../../../../packages/computer/test/computer-plugin.test.ts#L180) - asserts `['read', 'list', 'resolve', 'write', 'delete']`, as do `packages/sdk/test/people.test.ts:243`, `plugin-host.test.ts:384` and `:418`, and `policy-scheme.test.ts:230`"
  - "[code://packages/sdk/test/wire.test.ts](../../../../packages/sdk/test/wire.test.ts) - the `_meta` census host/43 p1 task 04 adds"
---

## Objective

`initialize` and every root state carry `_meta['ahpd.grants']`: one entry per built-in subject, `{ title, description, operations, groups: { read, write } }`, read from `OPERATIONS`.
`ahpd.resourceProviders`' `operations` speak the same words: `get` and `put` where they said `read` and `write`, so an advertised operation is the operation a role grants.

## Files

- `UPDATE: packages/sdk/src/host/root.ts:171-186` - `advertisedGrants()` beside `advertisedSchemes()`; `advertisedSchemes()`' `order` becomes `['get', 'list', 'resolve', 'put', 'delete', 'mkdir', 'move', 'copy']`, each looked up on the provider by its method (`get` -> `read`, `put` -> `write`, `delete` -> `remove`).
- `UPDATE: packages/sdk/src/host/root.ts:204` and `packages/sdk/src/host/handshake.ts:262` - the key beside `ahpd.resourceProviders`.
- `UPDATE: packages/computer/test/computer-plugin.test.ts:180`, `packages/sdk/test/people.test.ts:243`, `packages/sdk/test/plugin-host.test.ts:384, 418`, `packages/sdk/test/policy-scheme.test.ts:230` - the advertised lists read `get` and `put`.
- `UPDATE: docs/COMPUTER.md:100` - the example's `operations` is `["get", "list", "resolve", "put", "delete"]`.
- `UPDATE: docs/PLUGINS.md:270-274` - the operations the host adds are the grant's operation words, `get` for a provider's `read` and `put` for its `write`, and they changed from `read` and `write` with this plan.
- `UPDATE: packages/sdk/test/users-host.test.ts` - the cases below.
- `UPDATE: packages/sdk/test/wire.test.ts` - `ahpd.grants` in the census's allowed keys, when host/43 p1 task 04 has landed.

## Steps

1. Build the map from `OPERATIONS` in the table's order, with `chat`'s entry saying in its description that the session's groups cover it.
2. Always present, with or without a users directory: it says what a role could hold, not what anybody holds, and a host with no directory still has a `role:` scheme to write roles into.
3. Each `ahpd.resourceProviders` entry keeps its shape and has `get` and `put` in its `operations` where it had `read` and `write`; a client reads a scheme's groups from `ahpd.grants.file.groups`, which the `file` entry's description says.
4. The provider interface keeps its method names (`read`, `write`, `remove`); only the advertised words change, so no plugin changes.

## Validation

- `packages/sdk/test/users-host.test.ts`: `initialize`'s `_meta['ahpd.grants']` and a root snapshot's are equal, hold the eight subjects, `session.groups.write` contains `dispose` and not `list`, and every operation of every subject is in exactly one of its groups.
- A host with no users directory carries the same map.
- The computer plugin's entry advertises `['get', 'list', 'resolve', 'put', 'delete']`, a people scheme's the same, and a provider with only `read` and `list` advertises `['get', 'list']`; no `ahpd.resourceProviders` entry lists `read` or `write`.
- `pnpm exec vitest run packages/sdk/test/users-host.test.ts packages/sdk/test/wire.test.ts` passes, and `pnpm test` passes with the advertised-list tests updated.

## Resume
