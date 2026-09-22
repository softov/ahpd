---
title: A plugin serves a host-owned URI scheme - implemented
date: 2026-09-23
refs:
  - code://packages/sdk/src/types/resources.ts
  - code://packages/sdk/src/types/plugin.ts
  - code://packages/sdk/src/types/host.ts
  - code://packages/sdk/src/plugins.ts
  - code://packages/sdk/src/validate.ts
  - code://packages/sdk/src/host.ts
  - code://test/uri-resources.test.ts
  - code://test/uri-resources-plugin.test.ts
  - code://test/fixtures/plugin-uri-resources
  - code://docs/PLUGINS.md
---

A plugin can serve one host-owned URI scheme beside the daemon's file store with `registerResourceProvider(scheme, provider)`, and the host routes every `resource*` command by the scheme in the URI.
`file:` keeps the store it had, a registered scheme reaches its provider, a URI a client published is still relayed first, and a scheme nobody serves is explained as somebody else's.
A provider implements less than a `ResourceStore`: `read` is required, `list`, `resolve`, `watch` and the write half are optional, and whatever is left out answers `-32601`.

## What was built

- `code://packages/sdk/src/types/resources.ts` - `ResourceProvider`, everything `ResourceStore` has except `complete`, with `read` required.
- `code://packages/sdk/src/types/host.ts` - `HostOptions.resourceProviders`, keyed by scheme, with the order of authority written down.
- `code://packages/sdk/src/types/plugin.ts` - `registerResourceProvider(scheme, provider)` and the keyed `Contribution.providers` bucket.
- `code://packages/sdk/src/validate.ts` - `checkScheme` and `checkResourceProvider`.
- `code://packages/sdk/src/plugins.ts` - `reservedScheme`, the registration and its per-plugin duplicate check, and the fold's cross-plugin conflict.
- `code://packages/sdk/src/host.ts` - `storeFor(uri)`, the nine routed call sites, and the cross-scheme `-32602` on move and copy.
- `code://test/uri-resources.test.ts`, `code://test/uri-resources-plugin.test.ts` - the routing cases and the whole path through the loader.
- `code://test/fixtures/plugin-uri-resources` - a read-only `computer:` serving `computer://local/status` and `computer://local/capabilities`.
- `code://docs/PLUGINS.md`, `code://.project/plans/plugin/00-plugin.md` - the method, the contract table, the fixture and the kinds row.

## Verified

- `test/plugin-fold.test.ts` - 10 tests, two new: two plugins with two schemes, and a scheme the daemon already serves.
- `test/plugin-validate.test.ts` - 12 tests, three new: a provider with only `read`, a non-function member, a scheme that is not one, and the host's own schemes.
- `test/uri-resources.test.ts` - 5 tests: routing to the provider, `file:` unchanged, `-32601` for a method left out, the sentence for an unregistered scheme, and the client relay winning over a provider of the same scheme.
- `test/uri-resources-plugin.test.ts` - 3 tests: the fixture listed `ready` from its manifest without being imported, a `computer:` read through the real loader while `file:` still lists, and the refusals.
- `pnpm test` green: 65 files, 864 tests; `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- By hand: the real daemon loaded a scratch `.mjs` provider and answered `computer://local/status` with its bytes and metadata, listed the served directory for `file:` beside it, refused a `computer:` write `-32601`, and explained `notes://local/x` with the sentence the file store writes.

## Departures from the plan

- The `@` completion is untouched and stays with the file store, as decision 2 says. The research listed completions among the routed calls, and the reason it cannot be routed by scheme is that the typed text is a path with no scheme in it.

## Left for later

- A real `computer:` provider and the master it would call. Docker is available on this machine and `/dev/kvm` exists but is not readable by the user, so a VM path needs the `kvm` group or `--device /dev/kvm` through Docker plus a hypervisor; the plan names both and builds neither.
- Nothing here is released: a `0.6.4` would carry it, together with the transcript fix from `host/05`.
