---
title: registerRoute is a registration kind
status: implemented
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

- `Route` is a new type in `types/plugin.ts`: `(request: globalThis.Request) => Promise<globalThis.Response>`, written with `globalThis.` the way `types/listen.ts` writes its own `RequestHandler`, because `types/` imports no runtime value.
- `PluginHost.registerRoute(handler)` is documented at the end of the port methods and before `on`, and `Contribution.routes?: Route` is optional - a plugin that registered none has no route, which is different from one that answers 404.
- The recording, the check and the fold are in `plugins.ts`: `checkRoute` (new, in `validate.ts`) refuses anything that is not callable with `miss(by, 'registerRoute', 'handler', ...)`; a second `registerRoute` from one plugin throws the ports' `registered only once` message; and `foldHostOptions` returns `routes: Record<string, Route>` keyed by `contribution.by`. It is beside `options` and `problems`, not inside `options`, because a route is not something `createHost` is built over.
- The prefix lives beside `reservedScheme` in `plugins.ts`, exported: `ROUTE_ROOT` is `/plugins`, `routePrefix(name)` is `/plugins/` plus the name with each `/`-separated segment percent-encoded, and `routeOf(routes, path)` is the matcher - whole segments only, matching the prefix with or without its trailing `/`. `routeOf` builds the prefix through `routePrefix`, so the two halves cannot drift.
- No name is refused, and nothing about the name throws: `@` and `/` are ordinary in a plugin's name and a throw would cost the plugin its whole contribution, which is the watch-out the plan named.
- Tests: `plugin-validate.test.ts` "accepts a route handler and folds it under the plugin's own name" (the recorded handler is the one given, not a copy), "records no route for a plugin that registered none", "refuses a handler that is not a function, naming the plugin and the method" (`{}` and `'nope'`) and "refuses one plugin registering two routes, and leaves two plugins to the fold"; `plugin-fold.test.ts` has a `the routes a fold carries` group - an empty record when none registered, the scoped name under `/plugins/%40ahpd/x/` with its agents and tools kept, whole-segment matching (`/plugins/alpha` and `/plugins/alpha/` both answer, `/plugins/alphabet` and `/plugins/%40ahpad/xy` do not), and `ROUTE_ROOT` owning the whole space.
- `packages/sdk/src/index.ts` exports `routeOf`, `routePrefix`, `ROUTE_ROOT` and the `ServedRoute` type; `types/index.ts` adds `Route`. `FoldedOptions.routes` is required, which is a compile error at any caller that destructures it - there are none that construct it, and the server's `loadPlugins` was the one that dropped it.
- Not known to the plan: where a route's *ordering* sits. `/plugins/` was chosen over a per-plugin path root because `ROUTE_ROOT` is one string a listener can test; nothing in the plan named the alternative.

