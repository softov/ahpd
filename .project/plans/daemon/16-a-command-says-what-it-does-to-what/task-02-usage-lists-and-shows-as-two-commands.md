---
title: usage lists the pools and shows one, as two commands
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/commands/usage.ts#L85-L124](../../../../packages/server/src/commands/usage.ts#L85-L124) - `declareUsage`: one action answering a pool list or one pool's totals"
  - "[code://packages/server/src/commands/served.ts#L84](../../../../packages/server/src/commands/served.ts#L84) - where the served registry declares it"
  - "[code://packages/server/test/usage-command.test.ts](../../../../packages/server/test/usage-command.test.ts) - the usage cases"
---

## Objective

`usage.list` (`ahpd usage`, `GET /usage`) lists the pools the caller may see, and `usage.show` (`ahpd usage <pool>`, `GET /usage/{pool}`) answers one pool's three periods, with `pool` required.
The rows and the refusals are what `usage.list` answers today for each case.

## Files

- `UPDATE: packages/server/src/commands/usage.ts:85-124` - two actions sharing the store and the caller check; `declareUsage` declares both.
- `UPDATE: packages/server/test/usage-command.test.ts` - the cases below.

## Steps

1. Tests first, against the two ids and routes.
2. Split the body at the `pool === undefined` branch; keep `scopes: []` and the caller check on both.
3. Keep the description's pointer to `usage://<pool>/records` on `usage.show`.

## Validation

- `GET /usage` answers the pool rows; `GET /usage/<pool>` answers the periods; another person's pool without `usage:read` is refused as before.
- `ahpd usage` and `ahpd usage <pool>` print what they print today.
- The manifest has `usage.list` at `GET /usage` and `usage.show` at `GET /usage/{pool}`.
- `pnpm test` green.

## Resume

Implemented 2026-10-06. `declareUsage` returns the two actions, so `usage.list` at `GET /usage` and `usage.show` at `GET /usage/{pool}`; the store, the zone, the caller check and the sentences are the ones the single command had, the one-key show of a pool left off the listing and the `usage://<pool>/records` pointer left on the show.
`packages/server/test/usage-command.test.ts` runs a case against whichever of the two the input names, and pins the manifest's pattern, binding and inputs of both.
