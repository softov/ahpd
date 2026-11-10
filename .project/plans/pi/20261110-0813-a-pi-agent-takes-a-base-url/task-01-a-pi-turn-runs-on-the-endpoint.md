---
title: A pi turn runs on the record's endpoint
status: todo
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/plugin.ts](../../../../packages/agent-pi/src/plugin.ts) - the options, `kindSchema` and `RECORD_FIELDS`"
  - "[code://packages/agent-pi/src/backend.ts](../../../../packages/agent-pi/src/backend.ts) - the session's runtime, where the provider is registered"
  - "[code://packages/agent-pi/package.json](../../../../packages/agent-pi/package.json) - the plugin's options schema"
---

## Objective

A pi agent with `baseUrl` registers one OpenAI-compatible provider under its id on each session's runtime, with its `apiKey`.
A turn on `<id>/<model>` runs through it.

## Files

- `UPDATE: packages/agent-pi/package.json:81` - `baseUrl` and `apiKey` plugin options, `apiKey` `writeOnly`.
- `UPDATE: packages/agent-pi/src/plugin.ts:87` - `RECORD_FIELDS` takes `baseUrl` and `apiKey`.
- `UPDATE: packages/agent-pi/src/plugin.ts:124-136` - `kindSchema` declares both, `apiKey` `secret: true`.
- `UPDATE: packages/agent-pi/src/types.ts` - `PiOptions` and `BackendOptions` take `baseUrl` and `apiKey`.
- `UPDATE: packages/agent-pi/src/backend.ts:270-280` - after the session is made, register the provider on its runtime.
- `UPDATE: packages/agent-pi/test/engine.test.ts` - the schema has both fields.
- `CREATE: packages/agent-pi/test/agent-pi-endpoint.test.ts` - a turn on a stub endpoint.

## Steps

1. Write a test first: a session with a stub server's `baseUrl` answers a turn on `<id>/<model>` through it.
2. Make the test pass with `new sdk.ModelRegistry(session.modelRuntime).registerProvider(id, { baseUrl, apiKey, api, models })`.
3. If the registration does not reach the turn, stop, and ask Softov which seam to take.
4. Add the plugin options and the record fields, the record's value over the plugin's.
5. Skip the registration for a record with no `baseUrl`.
6. Check that `useEnv` leaves the registered provider's key in place.
7. Let a record named like one of pi's providers replace that provider for its own sessions only.

## Validation

- `agent-pi-endpoint.test.ts`: the stub server sees the turn's request with `Authorization: Bearer <apiKey>`.
- A record with no `baseUrl` makes no request to the stub.
- `pnpm typecheck`, then `pnpm exec vitest run packages/agent-pi`.

## Resume

