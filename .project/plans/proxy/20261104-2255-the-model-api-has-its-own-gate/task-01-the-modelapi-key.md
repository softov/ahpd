---
title: The modelApi key
status: todo
depends: []
layer: server
refs:
  - "[code://packages/server/src/commands/options.ts#L721-L748](../../../../packages/server/src/commands/options.ts#L721-L748) - the `httpApi` schema to copy"
---

## Objective

The config takes `modelApi`, checked as `httpApi` is, and three short descriptions.

## Files

- `UPDATE: packages/server/src/config.ts:370-402` - `modelApi?: boolean | HttpSetting` in `Config`, and short comments for `httpApi`, `modelApi` and `modelProxy`.
- `UPDATE: packages/server/src/commands/options.ts:721-748` - the `modelApi` schema, and one short description each for `httpApi`, `modelApi` and `modelProxy`.
- `UPDATE: packages/server/src/rootconfig.ts:32` - `modelApi` in `DAEMON_KEYS`.
- `UPDATE: packages/server/src/commands/run.ts:421-445` - refuse `modelApi` with `--stdio`, and without a credential.
- `UPDATE: packages/server/test/config-check.test.ts` - cases for `modelApi` as `true`, as `{ port, host }`, and as a host with no port.

## Steps

1. Add `modelApi` to `Config` with the type of `httpApi`.
2. Add the `modelApi` schema with the `port` and `host` of `httpApi`.
3. Write the description of `httpApi`: "Serve the HTTP API under /api. true uses the daemon's port; a port gives it its own."
4. Write the description of `modelApi`: "Serve the model API under /v1. true uses the HTTP API's port; a port gives it its own."
5. Write the description of `modelProxy`: "The model names the model API serves, each mapped to connectors."
6. Move the `sessionCalls` detail to the description of its own property.
7. Add `modelApi` to `DAEMON_KEYS`.
8. Copy the `--stdio` and credential checks of `httpApi` for `modelApi`.
9. Add the config cases.

## Validation

- The new cases fail without the change and pass with it.
- `pnpm --filter @ahpd/server test` passes, run alone.

## Resume

- **Done so far:** nothing.
- **Found:** nothing yet.
