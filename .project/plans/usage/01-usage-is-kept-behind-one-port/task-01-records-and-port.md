---
title: The usage records and the port
status: done
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

Implemented. `packages/sdk/src/types/usage.ts` declares `ModelUse`, `ComputerTime`, the `UsageEntry` union, `UsageTotal` and `Usage`, plus `Owner` (`user:`, `team:`, `project:`) and `Cost`, which both records name and the task file did not name a type for. `HostOptions.usage` is the port, and it joins `PortKey`, `PORT_KEYS`, `PORT_MEMBERS`, `PORT_METHOD` and `registerUsage`.

Both port members are promises. `record` settles when the entry is written, so a caller that awaits it and then reads a total sees its own entry, and `total` can be a shared store's own query rather than this machine's memory. A `total` the file store cannot answer exactly is a question the open question below still leaves open; the port takes any `from` and `until`.

Two decisions the plan left open, made here and written into the type:

- `tokens` counts input, output, cache reads and cache writes, because those are tokens the provider billed and a measure that left the cache out would not match the cost beside it.
- `usd` is US dollars and nothing else. A record costed in another currency is kept and is not added to it, because one number cannot be two currencies. There is no exchange rate anywhere in this plan.

The exports went into `packages/sdk/src/types/index.ts`, which `packages/sdk/src/index.ts` re-exports with `export type *`; every other type in the barrel reaches the package's surface that way, so a second line in `index.ts` would name the same types twice.

Validation: `packages/sdk/test/plugin-fold.test.ts` sets a plugin's `usage` on a base without one, reports it against the daemon's, and lets `replace` take it over.
