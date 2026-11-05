---
title: An adapter can serve models
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/connectors.ts#L26](../../../../packages/sdk/src/types/connectors.ts#L26) - `CapabilityType`, which gets `models`"
  - "[code://packages/sdk/src/types/connectors.ts#L105](../../../../packages/sdk/src/types/connectors.ts#L105) - `Adapter`, which gets `provider`"
  - "[code://packages/sdk/src/connectors/channel.ts](../../../../packages/sdk/src/connectors/channel.ts) - `ConnectorsChannel`, which gets `providers`"
  - "[code://packages/server/src/proxy/providers.ts#L19-L23](../../../../packages/server/src/proxy/providers.ts#L19-L23) - `DIALECTS` and `Dialect`, which move to the sdk"
---

## Objective

An adapter can say that its connectors serve models, and tell the host where and how to call them.
The connectors channel lists its open provider connectors for host code.

## Files

- `UPDATE: packages/sdk/src/types/connectors.ts` - `models` in `CapabilityType`, the `ModelDialect` type, the `ModelProvider` type and `Adapter.provider`.
- `UPDATE: packages/sdk/src/connectors/channel.ts` - `providers()` on `ConnectorsChannel`.
- `UPDATE: packages/sdk/src/index.ts` - export the new types and `MODEL_DIALECTS`.
- `UPDATE: packages/sdk/src/types/index.ts` - export the new types.
- `UPDATE: packages/server/src/proxy/providers.ts` - import `MODEL_DIALECTS` and `ModelDialect` from the sdk in place of its own.
- `UPDATE: packages/sdk/test/connectors-channel.test.ts` - cases for `providers()`.

## Steps

1. Add `'models'` to `CapabilityType`.
2. Move `DIALECTS` to the sdk as `MODEL_DIALECTS`, with its type `ModelDialect`.
3. Keep `DIALECTS` and `Dialect` in the server as names for the sdk's, so the proxy code does not change.
4. Add `ModelProvider { endpoint: string; accepts: ModelDialect[]; key?: string }`.
5. Add `provider?(connector: Connector): ModelProvider` to `Adapter`, with a comment that it reads the connector's resolved config.
6. Add `providers()` to `ConnectorsChannel`, which answers each open connector whose adapter has `provider`.
7. Give each listed connector its `id`, `adapter`, `owner` and the `ModelProvider` the adapter answers.
8. Skip a connector whose `provider` throws, and report the problem once through `onProblem`.
9. Test that `providers()` lists a provider adapter, and skips other adapters, closed connectors and throws.

## Validation

- The new tests pass, and the gate passes: `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test`.
- `providers()` is a method of the returned object, and no channel or command sends its answer.

## Resume

- **Done so far:** `packages/sdk/src/types/connectors.ts` has `MODEL_DIALECTS` and `ModelDialect`, `ModelProvider`, `ProviderConnector`, `'models'` in `CapabilityType`, and `Adapter.provider`. `ConnectorsChannel.providers()` answers each open connector whose adapter has `provider`, sorted by id, with its `id`, `adapter`, `owner` and resolved `ModelProvider`. A `provider` that throws leaves the connector out and says its problem once per connector. The sdk and its type index export the new names. The server's `DIALECTS` and `Dialect` are now names for the sdk's.
- **Next action:** none for this task.
- **Open questions:** none.
- **Watch out for:** a listed `ModelProvider.key` is the resolved secret, so only host code reads the list, and no channel or command sends it.
