---
title: A pi turn runs on the record's endpoint
status: implemented
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/plugin.ts](../../../../packages/agent-pi/src/plugin.ts) - the options, `kindSchema` and `RECORD_FIELDS`"
  - "[code://packages/agent-pi/src/backend.ts](../../../../packages/agent-pi/src/backend.ts) - the session's runtime, where the provider is registered"
  - "[code://packages/agent-pi/package.json](../../../../packages/agent-pi/package.json) - the plugin's options schema"
---

## Objective

A pi agent with `baseUrl` registers one OpenAI-compatible provider under its id on each session's runtime.
The provider carries the record's `apiKey`, or a placeholder key when the record has none.
A turn on `<id>/<model>` runs through it, carrying the key or no `Authorization` header.

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
- A record with `baseUrl` and no `apiKey` runs a turn on the stub with no `Authorization` header.
- A record with no `baseUrl` makes no request to the stub.
- `pnpm typecheck`, then `pnpm exec vitest run packages/agent-pi`.

## Resume

- **Done so far:** `PiOptions` has `baseUrl` and `apiKey`, and `BackendOptions` has `provider`, `baseUrl` and `apiKey`; `provider` is added to the object `piSession` hands the backend, and `RECORD_FIELDS` and `kindSchema` carry the record's two, `apiKey` as `secret: true`. `openPi` calls `registerEndpoint` after the session is made and before `wrap`: it reads `<baseUrl>/models` with the key, and registers one provider under `options.provider ?? 'pi'` on `session.modelRuntime` through `new sdk.ModelRegistry(...).registerProvider(id, { name, baseUrl, apiKey, api: 'openai-completions', models })`. `Pi` takes `ModelRegistry` from the SDK. A record with no `baseUrl` registers nothing and makes no request. `useEnv` leaves the provider's key in place, because `keyOf` resolves it through the provider's auth. The plugin's `apiKey` option is `writeOnly`, and the README names both fields. A record with no `apiKey` registers `KEYLESS_API_KEY`, because pi counts a provider configured only with a key. The session then gets an `ahpd-endpoint` inline extension whose `before_provider_headers` handler sets `Authorization` to `null`, so the adapter's `Bearer <placeholder>` never leaves the process; a turn on that record reaches the stub with no `Authorization` header.
- **Next action:** [task-02-the-probe-lists-the-endpoint.md](task-02-the-probe-lists-the-endpoint.md).
- **Open questions:** none.
- **Watch out for:** the suite is 275 of 276 on this box; `agent-pi-lazy.test.ts` fails only at its own 4000 ms import budget, with a cold import of the plugin entry measured at about 4.0 s on an idle retry and at 7.985 s and 8.389 s under the other builds' load, and the same case passes with a 30 s budget. The endpoint case's stub binds an ephemeral port on 127.0.0.1.

Files changed by this task: `packages/agent-pi/package.json`, `packages/agent-pi/src/backend.ts`, `packages/agent-pi/src/pi.ts`, `packages/agent-pi/src/plugin.ts`, `packages/agent-pi/src/session.ts`, `packages/agent-pi/src/types.ts`, `packages/agent-pi/test/agent-pi-delete.test.ts`, `packages/agent-pi/test/agent-pi-lazy.test.ts`, `packages/agent-pi/test/engine.test.ts`, `packages/agent-pi/test/agent-pi-endpoint.test.ts`, `packages/agent-pi/README.md`.

