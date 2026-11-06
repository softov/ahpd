---
title: The connectors channel answers a connector's models
status: done
depends: []
layer: "sdk, server, docs"
refs:
  - "[code://packages/sdk/src/connectors/channel.ts](../../../../packages/sdk/src/connectors/channel.ts) - the command and its option"
  - "[code://packages/server/src/proxy/listener.ts](../../../../packages/server/src/proxy/listener.ts) - `connectorModels`"
---

## Objective

`x-ahpd/connectors/models { id }` answers `{ models, at }` for one open provider connector.
Each model carries `model`, the name a caller sends, and `callable`, whether this reader may call it now.

## Files

- `UPDATE: packages/sdk/src/types/connectors.ts:168-189` - adds `ConnectorModel` and `ConnectorModels`.
- `UPDATE: packages/sdk/src/index.ts:70` - exports the two types.
- `UPDATE: packages/sdk/src/connectors/channel.ts` - adds the `models` option, the `models` command and a `providers` function the command and the channel's `providers()` share.
- `UPDATE: packages/server/src/proxy/catalog.ts:66` - adds `listOf`, one connector's list and when it was read.
- `UPDATE: packages/server/src/proxy/listener.ts:560-606` - lifts `firstCandidate` out of `GET /v1/models` and adds `connectorModels`.
- `UPDATE: packages/server/src/commands/run.ts:568-590` - builds the proxy options once, and hands the channel a `models` reader over them.
- `CREATE: packages/sdk/test/connectors-models.test.ts` - the command's own checks.
- `UPDATE: packages/server/test/proxy-listener.test.ts` - `connectorModels` for a person, for root, and for a connector not read yet.
- `UPDATE: docs/plugins/PLUGINS.md` - the command table gets its sixth row.
- `UPDATE: docs/server/PROXY.md` - the models list section names the command.

## Steps

1. Add `ConnectorModel` and `ConnectorModels` to the sdk types and export them.
2. Add `listOf` to the catalog.
3. Lift the per-name route and policy check into `firstCandidate`, and call it from `GET /v1/models`.
4. Add `connectorModels`: refresh the catalog, read the connector's list, and ask `firstCandidate` for each name.
5. Add the `models` option and the `models` command to the connectors channel, served only with the option.
6. Make one proxy options value in `run.ts`, and give the channel a `models` reader over it.
7. Remove `callable` from the answer when the host serves no proxy.
8. Write the tests and the docs.

## Validation

- Run `packages/sdk/test/connectors-models.test.ts`. It checks the option, the reader rule and a connector with no models.
- Run `packages/server/test/proxy-listener.test.ts`. It checks `callable` for a person and for root, and a connector not read yet.
- Run `pnpm typecheck`.

## Resume

Built on 2026-10-28. `pnpm typecheck` and the connector and proxy tests pass. Not committed.
