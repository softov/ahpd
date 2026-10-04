---
title: The host's own surfaces are advertised with their operations, and a role grants an operation - implemented
date: 2026-10-04
refs:
  - git://6795e9b
  - "[code://packages/sdk/src/users.ts](../../../../packages/sdk/src/users.ts)"
  - "[code://packages/sdk/src/host/gate.ts](../../../../packages/sdk/src/host/gate.ts)"
  - "[code://packages/sdk/src/host/root.ts](../../../../packages/sdk/src/host/root.ts)"
---

A grant names one operation of a subject, and `read` and `write` are only groups of those operations.
Every gated method and client-dispatchable action asks for one operation, and the host advertises its eight subjects with their operations and groups in `_meta['ahpd.grants']`, so a client can build a role editor without a hardcoded list.

## What was built

- [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts) - `OPERATIONS`, the one table of subjects, operations and groups; `holds` answers an operation held exactly, through its group, through `*:*`, `*:<group>` or `<subject>:*`, and for `chat` through the same `session` group.
- [`code://packages/sdk/src/host/gate.ts`](../../../../packages/sdk/src/host/gate.ts) - `NEEDS` in operations and `ACTION_NEEDS` with all 47 client-dispatchable actions; an action with no row is refused as not served.
- [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts) - `advertisedGrants()`, on every root state and on `initialize` through [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts).
- [`code://packages/sdk/src/people.ts`](../../../../packages/sdk/src/people.ts) - the `role:` scheme writes `<subject>:<operation>` and names the subject's operations in a refusal.
- `docs/USERS.md` lists every subject with its operations and its read and write groups.

## Verified

- Every one of the 39 gated methods asks for the same group under the new table as it asked for on `main` before the plan; `fetchTurns`, `createChat` and `disposeChat` moved from `session` to `chat`, which `session` still covers.
- Every one of the 47 actions asks for a write operation, as every action family asked for write before.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (180 files, 2786 tests, with plugin 21) pass on `main` at `22e5c2e`.

## Departures from the plan

- `seesConfig` asks `config:settings` and `root/configChanged` asks `config:change`, rather than the groups task 03 named; Softov, 2026-10-04.
- The matrix test asserts the invariant over `admin`, `member`, `guest`, `viewer` and `editor`, because the `operators` role the plan names is not in `docs/USERS.md`.
- Tests outside the task files changed with the task that broke them: `containers`, `policy-scheme`, `people`, `computer-plugin`, `plugin-host`, `root-config`, `users-gate`, and the regenerated `fixtures/wire.jsonl`.

## Left for later

- `ahpd.resourceProviders` lists `get` and `put` where it listed `read` and `write`; ahpapp has to read the new names before it relies on them.
- The tasks stay `implemented` until Softov reviews them.
