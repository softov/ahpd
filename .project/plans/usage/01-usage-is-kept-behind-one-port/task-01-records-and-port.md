---
title: The usage records and the port
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L30-L41](../../../../packages/sdk/src/types/plugin.ts#L30-L41) - `PortKey`"
  - "[code://packages/sdk/src/validate.ts#L126-L164](../../../../packages/sdk/src/validate.ts#L126-L164) - the port tables"
---

## Objective

`@ahpd/sdk` exports the two record types and a `Usage` port, which a plugin can contribute and `HostOptions` accepts.

## Files

- `CREATE: packages/sdk/src/types/usage.ts` - `ModelUse` (`at`, `source: 'proxy' | 'agent'`, `owner`, `team?`, `project?`, `session?`, `chat?`, `turn?`, `agent?`, `model`, `provider?`, `inputTokens?`, `outputTokens?`, `cacheReadTokens?`, `cacheWriteTokens?`, `cost?: { amount, currency, from: 'harness' | 'price' }`, `pools`), `ComputerTime` (`start`, `end`, `owner`, `team?`, `project?`, `computer`, `session?`, `cpu?`, `memory?`, `pools`), and `Usage { record(entry), total(pool, from, until) }`.
- `UPDATE: packages/sdk/src/types/host.ts` - `usage?: Usage` in `HostOptions`.
- `UPDATE: packages/sdk/src/types/plugin.ts:30-41`, `packages/sdk/src/plugins.ts:29-32`, `packages/sdk/src/validate.ts:126-164` - the `usage` port key, its members, `registerUsage`.
- `UPDATE: packages/sdk/src/index.ts` - export the types.

## Steps

1. `total` answers `{ usd?, tokens?, calls?, hours?, ... }`, the measures the pool holds.

## Validation

- `packages/sdk/test/plugin-fold.test.ts`: a plugin contributing `usage` is accepted and folded like other ports.
- `pnpm -F @ahpd/sdk test` and `pnpm -r typecheck`.

## Resume
