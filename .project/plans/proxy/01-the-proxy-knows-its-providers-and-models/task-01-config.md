---
title: Providers and model names in config
status: done
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

- **Done so far:** 2026-10-01. `packages/server/src/proxy/providers.ts` holds `ProxyProvider`, `ModelEntry` and `ProxySetting`, the three `BUILT_IN_PROVIDERS`, `proxyConfiguration` (the file's providers over the built-ins) and `proxyProblems`. `proxy` is a checked key in `Config` and in `configSchema` (through `serverFields`, so it has no flag), and `checkConfig` calls `proxyProblems` after the per-key loop, so a bad value stops the start the way one on any other key does. `Options` carries `proxy: ProxyConfiguration`.
- **Next action:** nothing in this task. 02 lists what this holds.
- **Open questions:**
  1. `price` is written as dollars per million tokens, `input` and `output` both optional. The plan names a price but not its shape, so nothing reads the units yet; the routing plan is where they should be settled.
- **Watch out for:**
  - A file entry under a built-in id replaces it whole, field by field merging is not done. So `{ "anthropic": { "key": { "env": "X" } } }` is refused for having no `endpoint`, rather than half-overriding the built-in.
  - The schema subset has no `patternProperties`, so `providers` and `models` are declared as bare objects and their entries are checked in `proxyProblems` with the sentence naming the entry (`proxy.providers.x.endpoint is required`). That is why a list item's message names `accepts` and not `accepts[0]`: `check` only appends a property's key to the name.
  - Nested keys are not a closed set, as `http`'s and a plugin entry's are not: `proxy: { provider: {} }` is ignored rather than refused. Only the top level warns about an unknown key, and that is the one warning channel there is.
  - `checkConfig` reads `file.proxy` off the checked shape, so `proxyProblems` runs for every run including the ones that never look at a proxy. It is a handful of object walks over a small file.
- **Tests:** `packages/server/test/config-check.test.ts` - the three built-ins with no configuration; a provider and its model names added; a built-in replaced whole with another key variable; refusals for a model naming a missing provider, a name that is not `<maker>/<name>`, a missing or unknown `accepts`, a missing `endpoint`, a key with no `env`, a model entry with no `provider`, a models value that is not a list, and a `proxy` that is not an object. Two cases run the daemon over stdio: one starts with a provider and a model name, one refuses to start naming the provider that is not there. `pnpm -F @ahpd/server test` - 19 files, all passing.
