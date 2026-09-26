---
title: registerRoute is a registration kind
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L118-L207](../../../../packages/sdk/src/types/plugin.ts#L118-L207) - `PluginHost`"
  - "[code://packages/sdk/src/types/plugin.ts#L247-L282](../../../../packages/sdk/src/types/plugin.ts#L247-L282) - `Contribution`"
  - "[code://packages/sdk/src/plugins.ts](../../../../packages/sdk/src/plugins.ts) - `pluginHost` and `foldHostOptions`"
  - "[code://test/plugin-validate.test.ts](../../../../test/plugin-validate.test.ts) - where each registration's check is paired with a good and an empty value"
---

## Objective

A plugin may call `registerRoute(handler)` once, the handler is checked to be a function, and the fold carries every plugin's route by plugin name.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:118-207` - `registerRoute`, documented.
- `UPDATE: packages/sdk/src/types/plugin.ts:247-282` - `Contribution.route`.
- `UPDATE: packages/sdk/src/plugins.ts` - the recording, the check and the fold into a new `routes` result keyed by plugin name.
- `UPDATE: test/plugin-validate.test.ts`, `test/plugin-fold.test.ts` - the cases below.

## Steps

1. A second `registerRoute` from one plugin throws, naming the plugin.
2. A handler that is not a function throws, naming the plugin and the method.
3. A plugin name that cannot be a URL path is refused.

## Validation

- A good handler folds; a second one, a non-function and an unusable name are each refused with a message.
- `pnpm test`, `pnpm typecheck` green.

## Resume

