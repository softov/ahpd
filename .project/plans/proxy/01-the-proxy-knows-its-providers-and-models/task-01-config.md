---
title: Providers and model names in config
status: todo
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/config.ts#L32-L130](../../../../packages/server/src/config.ts#L32-L130) - `Config`"
  - "[code://packages/server/src/commands/options.ts#L143-L295](../../../../packages/server/src/commands/options.ts#L143-L295) - the schema"
---

## Objective

`proxy.providers` and `proxy.models` are checked config keys, and the built-in providers are present without any config.

## Files

- `CREATE: packages/server/src/proxy/providers.ts` - the built-ins and a merge of the user's providers over them.
- `UPDATE: packages/server/src/config.ts:32-130` - the `proxy` key.
- `UPDATE: packages/server/src/commands/options.ts:143-295` - its schema.

## Steps

1. A model name must be `<maker>/<name>`; each entry's `provider` must exist after the merge.
2. `accepts` is a non-empty list of known dialects.

## Validation

- `packages/server/test/config-check.test.ts`: a user provider is added; a built-in's key env is overridden; a model naming a missing provider is refused.
- `pnpm -F @ahpd/server test`.

## Resume
