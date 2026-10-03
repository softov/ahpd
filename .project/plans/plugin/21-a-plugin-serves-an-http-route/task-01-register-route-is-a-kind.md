---
title: registerRoute is a registration kind
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L139-L279](../../../../packages/sdk/src/types/plugin.ts#L139-L279) - `PluginHost`"
  - "[code://packages/sdk/src/types/plugin.ts#L329-L364](../../../../packages/sdk/src/types/plugin.ts#L329-L364) - `Contribution`"
  - "[code://packages/sdk/src/plugins.ts#L299](../../../../packages/sdk/src/plugins.ts#L299) - `pluginHost`, beside which the fold is"
  - "[code://packages/sdk/test/plugin-validate.test.ts](../../../../packages/sdk/test/plugin-validate.test.ts) - where each registration's check is paired with a good and an empty value"
---

## Objective

A plugin may call `registerRoute(handler)` once, the handler is checked to be a function, and the fold carries every plugin's route by plugin name.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:139-279` - `registerRoute`, documented.
- `UPDATE: packages/sdk/src/types/plugin.ts:329-364` - `Contribution.routes`.
- `UPDATE: packages/sdk/src/plugins.ts` - the recording, the check and the fold into a new `routes` result keyed by plugin name.
- `UPDATE: packages/sdk/test/plugin-validate.test.ts`, `packages/sdk/test/plugin-fold.test.ts` - the cases below.

## Steps

1. A second `registerRoute` from one plugin throws, naming the plugin.
2. A handler that is not a function throws, naming the plugin and the method.
3. The prefix is `/plugins/` and the plugin's name with each `/`-separated segment percent-encoded (`@ahpd/x` is `/plugins/%40ahpd/x/`); no name is refused, because a throw here discards the plugin's whole contribution. A helper answers the prefix, so task 02 matches the same one.

## Validation

- A good handler folds into `routes` under its plugin name; a second one and a non-function are each refused with a message.
- A scoped name folds with its encoded prefix, and the plugin's other registrations are kept.
- `pnpm test`, `pnpm typecheck` green.

## Resume

