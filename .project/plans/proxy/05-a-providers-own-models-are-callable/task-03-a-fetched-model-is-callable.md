---
title: A fetched model is callable
status: implemented
depends: [task-01-an-adapter-lists-its-models.md, task-02-the-host-adapters-list-their-models.md]
layer: "server"
refs:
  - "[code://packages/sdk/src/connectors/channel.ts#L157](../../../../packages/sdk/src/connectors/channel.ts#L157) - `providers()`, the connectors a catalog follows"
  - "[code://packages/server/src/proxy/route.ts#L234](../../../../packages/server/src/proxy/route.ts#L234) - `route`, which reads a name the table does not hold as `<prefix>/<id>`"
  - "[code://packages/server/src/proxy/listener.ts#L279](../../../../packages/server/src/proxy/listener.ts#L279) - `costOf`, which prices a call from the entry"
  - "[code://packages/sdk/src/access/decide.ts#L68](../../../../packages/sdk/src/access/decide.ts#L68) - a policy value with `*`"
---

## Objective

The host keeps each provider connector's list in memory.
A call of `<prefix>/<id>` that the table does not hold goes to the connectors with that prefix, in proxy 04's tier order.

## Files

- `UPDATE: packages/sdk/src/types/connectors.ts` - `ProviderConnector.models`, the list read from the open connector.
- `UPDATE: packages/sdk/src/connectors/channel.ts` - `providers()` binds each row's `models()` to the open connector.
- `UPDATE: packages/sdk/test/connectors-channel.test.ts` - the binding, and the row that carries no config.
- `CREATE: packages/server/src/proxy/catalog.ts` - the catalog: each open provider connector's list, fetched at first sight and each hour.
- `UPDATE: packages/server/src/proxy/route.ts` - a name not in the table is read as `<prefix>/<id>`.
- `UPDATE: packages/server/src/proxy/listener.ts` - `ProxyOptions` gets the catalog, and `costOf` reads a fetched price.
- `UPDATE: packages/server/src/commands/run.ts` - build the catalog from the connectors channel and the adapters, and stop its timer at shutdown.
- `CREATE: packages/server/test/proxy-catalog.test.ts` - the fetch, the hourly fetch, a failed fetch and a closed connector.
- `UPDATE: packages/server/test/proxy-route.test.ts` - fetched names, prefixes and the table's priority.

## Steps

1. Add `models?: () => Promise<ProviderModel[]>` to `ProviderConnector`, with a comment that the channel binds it to the open connector.
2. Bind it in `providers()`, which hands the adapter's `models` the connector it opened.
3. Test that the bound `models()` reads the resolved config, and that the row carries no `config`.
4. Make the catalog read `providers()` and fetch `models` for each connector it has not seen.
5. Key the catalog by owner and connector id, because two owners can use one id.
6. Fetch each connector again each hour, with a timer that does not hold the process open.
7. Keep the last list when a fetch fails, and write one line to the log that names the connector.
8. Remove a connector from the catalog when `providers()` no longer lists it.
9. Give the catalog a `prefixOf(connector)` that answers `provider.prefix` or the adapter name.
10. In `route`, keep the table's entries for a name that the table holds.
11. For any other name, split it at the first slash into a prefix and an id.
12. Take the connectors whose prefix is that prefix, and refuse the name as today when there are none.
13. Order those connectors by proxy 04's tiers, and give each the entry `{ provider: adapter, id }`.
14. Send the call when the list does not hold the id, so the provider answers it.
15. Give the entry the fetched price, per million tokens, when the connector's list holds the id with `pricing`.
16. Keep the policy check on the whole name, so `openrouter/*` allows every OpenRouter model.
17. Test a fetched name, a compatible connector by its id, and a table name that wins.
18. Test a call of a name before the first fetch.

## Validation

- `proxy-catalog.test.ts` and `proxy-route.test.ts` pass.
- The gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.
- The daemon tests end with no open handle, so shutdown stops the timer.

## Resume

- **Done so far:** `ProviderConnector.models()` exists, and `providers()` binds it to the open connector, so a row carries no config and no key. `packages/server/src/proxy/catalog.ts` keeps each open connector's list by owner and id. It reads an unsent connector at once, and every connector each hour. Its timer does not hold the process open. A failed read keeps the last list, and a closed connector leaves. `route` reads a name the table does not hold as `<prefix>/<id>`, matched through `prefixOf`. The order is proxy 04's tiers, and the policy is asked on the whole name. The entry carries the fetched price. `ProxyOptions.catalog` hands the route the lists. `run.ts` builds the catalog and stops its timer at shutdown, and the typecheck and the gate pass.
- **Next action:** none for this task.
- **Open questions:** none. The fork of 2026-10-24 is answered in the plan's Answers table.
- **Watch out for:** a models request awaits `refresh()`, so a connector put since the last read is fetched then. A call never waits, so a name outside the first list is routed with no price.