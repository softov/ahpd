---
title: A plugin contributes a provider for one scheme
status: done
depends: []
layer: plugin
refs:
  - code://packages/sdk/src/types/resources.ts#L125-L183 - `ResourceStore`, whose optional half the provider contract reuses
  - code://packages/sdk/src/types/host.ts#L132-L245 - `HostOptions`, where `resourceProviders` joins
  - code://packages/sdk/src/types/plugin.ts#L98-L130 - `PluginHost`, where the method goes
  - code://packages/sdk/src/types/plugin.ts#L163-L187 - `Contribution`, which gains the keyed bucket
  - code://packages/sdk/src/plugins.ts#L176-L239 - `pluginHost`, where one `apply` records it
  - code://packages/sdk/src/plugins.ts#L78-L156 - `foldHostOptions`, where conflicts are reported
  - code://packages/sdk/src/validate.ts#L148-L183 - `checkPort`, the checker this one is modelled on
  - code://test/plugin-fold.test.ts - the fold's cases, one per operation
  - code://test/plugin-validate.test.ts - the checker cases, complete and empty
  - code://test/plugin-host.test.ts - one `apply` recording what it registered
---

## Objective

A plugin can call `host.registerResourceProvider('computer', store)` and the folded `HostOptions` carries that store under `resourceProviders.computer`, with a duplicate scheme, a reserved scheme and a malformed store each refused where they are registered.

## Files

- `UPDATE: packages/sdk/src/types/resources.ts` - add `ResourceProvider`: everything `ResourceStore` has except `complete`, with `read` required and `list`, `resolve`, `watch` and the five write methods optional, so the signatures are the store's own and a `ResourceStore` satisfies it.
- `UPDATE: packages/sdk/src/types/host.ts` - `resourceProviders?: Record<string, ResourceProvider>`, documented as host-owned schemes beside the `file:` store, with the relay precedence named.
- `UPDATE: packages/sdk/src/types/plugin.ts` - `registerResourceProvider(scheme, provider)` on `PluginHost`, and the keyed bucket on `Contribution`.
- `UPDATE: packages/sdk/src/validate.ts` - `checkResourceProvider(scheme, value, by)`: the scheme's shape, that `read` is a function, and that every other member present is a function.
- `UPDATE: packages/sdk/src/plugins.ts` - `pluginHost` records the registration and refuses one scheme twice inside a plugin; `foldHostOptions` merges the buckets, refuses a scheme another plugin set, refuses `file` and anything on `ahp-`, and puts the result in `options.resourceProviders`.
- `UPDATE: test/plugin-validate.test.ts`, `test/plugin-fold.test.ts`, `test/plugin-host.test.ts` - one case each for the new kind, plus the refusals.

## Steps

1. Write `ResourceProvider` beside `ResourceStore`, with a comment saying what it is for and why `complete` is not in it (decision 2).
2. Add the method and the bucket, following `registerAgent`/`registerTool` for the per-plugin duplicate check and `setPort` for the shape check (decision 1).
3. Fold the bucket in `foldHostOptions` beside the `providers` map the agents use, reporting a clash as `plugin X registers scheme computer, which plugin Y already registered`, and a reserved scheme as its own message.
4. Add the validation case pair the other kinds have: a complete provider, and an empty object, each asserted.
5. Run `pnpm test`, `pnpm typecheck` and `pnpm boundary`.

## Validation

- `test/plugin-validate.test.ts` - a provider with only `read` passes; one with no `read`, or a non-function member, fails with the plugin, method and member named.
- `test/plugin-fold.test.ts` - two plugins with two schemes both reach `resourceProviders`; the same scheme twice is a problem naming both plugins; `file` and `ahp-root` are refused.
- `test/plugin-host.test.ts` - one `apply` registering the same scheme twice throws out of `apply`.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green; no host behaviour changes yet, so no existing case moves.

## Resume

Done 2026-09-22.
Built: `ResourceProvider` in `types/resources.ts`, `HostOptions.resourceProviders`, `registerResourceProvider` and the keyed `Contribution.providers` bucket, `checkScheme` and `checkResourceProvider`, `reservedScheme`, the per-plugin duplicate check and the fold's cross-plugin conflict.
Found: `Contribution` is built as a literal in three test helpers, so a required field moved those too; and `types/index.ts` had to export `ResourceProvider` or the fixture could not name it, even though `types/host.ts` re-exported it.
