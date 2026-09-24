---
title: The host advertises them on the handshake
status: done
depends:
  - task-01-a-provider-says-what-its-scheme-is-for.md
layer: packages/sdk
refs:
  - "[code://packages/sdk/src/host.ts#L4779](../../../../packages/sdk/src/host.ts#L4779) - the `initialize` result, where `_meta` is built"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - the root state the snapshot carries"
  - "[code://packages/sdk/src/types/host.ts](../../../../packages/sdk/src/types/host.ts) - `HostOptions.resourceProviders`, the map it reads"
  - "[code://packages/sdk/src/plugins.ts](../../../../packages/sdk/src/plugins.ts) - the fold, which is where the providers are complete"
  - "[code://test/plugin-host.test.ts](../../../../test/plugin-host.test.ts) - where a host built from folded options is asserted"
---

## Objective

`initialize._meta['ahpd.resourceProviders']` and the root state's `_meta` carry one entry per registered scheme - `title`, `description?`, `root`, `operations` and `manifest?` - built from the providers and from what the host can see for itself.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `advertisedSchemes()`, merged into the `initialize` `_meta` beside the `vscode.*` flags, and set as the root state's `_meta`.
- `UPDATE: test/plugin-host.test.ts` - a host with a contributed provider advertises it on both, and a host with none advertises nothing.
- `UPDATE: test/computer-plugin.test.ts` - the computer plugin's advertisement, end to end through the loader.

## Steps

1. Build the map from `options.resourceProviders`: for each scheme, the provider's `describe()` when it has one, plus `root` and the operations the host derives from the methods that are functions.
2. Order the operations the way a client reads them: `read`, `list`, `resolve`, `write`, `delete`.
3. Put the map under `ahpd.resourceProviders` in the `initialize` result's `_meta`, merged with the existing keys rather than replacing them, and only when at least one provider is registered.
4. Set the same map as the root state's `_meta`, from the same function, so the handshake and a later snapshot cannot disagree.
5. Do not advertise an empty map: a host with no provider contributes no key, which is the presence-means-support rule the protocol uses for `automations`.

## Validation

- `test/plugin-host.test.ts` - a folded host with a provider advertises the scheme's title, root and operations on `initialize._meta` and on the root snapshot; a host without one has no `ahpd.resourceProviders` key on either.
- `test/computer-plugin.test.ts` - with the loader, the computer entry names `Computer`, `computer://`, all five operations and a manifest whose `image` default is the configured one.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Not started.
A provider that implements no `write` advertises no `write`; the operations are the host's reading of the provider, not the provider's claim.
