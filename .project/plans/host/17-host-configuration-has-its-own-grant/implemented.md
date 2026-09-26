---
title: Host configuration has its own grant - implemented
date: 2026-09-25
refs:
  - "[code://packages/sdk/src/host.ts#L271-L281](../../../../packages/sdk/src/host.ts#L271-L281)"
  - "[code://packages/sdk/src/users.ts#L35](../../../../packages/sdk/src/users.ts#L35)"
---

Changing a host-wide root setting, or replacing the root config, needs `config:write`, which only `admin` has among the built-in roles.
Setting your own `defaultShell` needs only a sign-in.

## What was built

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `dispatchNeeds(channel, action)`, and the gate asking for a grant only when one is needed.
- [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts) - `config` in `SUBJECTS`.
- [`code://docs/USERS.md`](../../../../docs/USERS.md) - the `config` row and the root rule.

## Verified

- `test/users-gate.test.ts` (20 cases): the classification for each shape of root action; a member refused `artifactToolsCompactPrompts` with `m may not config:write here` and left unchanged, while its `defaultShell` is accepted; a guest's `defaultShell` accepted; a `config:write` holder's change reaching another connection; a connection with no sign-in refused.
- `pnpm test` 85 files / 1122 tests, `pnpm typecheck`, `pnpm boundary` green on 2026-09-25, in a tree that also held dsh's in-progress `host/16` and `daemon/03` work.

## Departures from the plan

- None.

## Left for later

- Nothing.
