---
title: A client can tell what a scheme does before it asks one - implemented
date: 2026-09-23
refs:
  - code://packages/sdk/src/types/resources.ts
  - code://packages/sdk/src/types/index.ts
  - code://packages/sdk/src/validate.ts
  - code://packages/sdk/src/host.ts
  - code://packages/sdk/src/resources.ts
  - code://packages/computer/src/manifest.ts
  - code://packages/computer/src/provider.ts
  - code://test/plugin-host.test.ts
  - code://test/computer-plugin.test.ts
  - code://test/plugin-validate.test.ts
  - code://test/uri-resources.test.ts
  - code://docs/PLUGINS.md
  - code://docs/COMPUTER.md
---

A host says which schemes it serves, what each can be asked to do and what a create body takes, before any object exists. A scheme nobody serves answers a code that says so, so a capability probe is a branch rather than a string match.

## What was built

- `code://packages/sdk/src/types/resources.ts` - `SchemeDescription { title, description?, manifest? }` and an optional `describe()` on `ResourceProvider`.
- `code://packages/sdk/src/validate.ts` - `describe` allowed as an optional function on a provider registration.
- `code://packages/sdk/src/host.ts` - `advertisedSchemes()`, merged into `initialize._meta` and set as the root state's `_meta` under `ahpd.resourceProviders`; `root` and `operations` are derived from the provider's own methods, and the key is absent when no provider is registered.
- `code://packages/sdk/src/resources.ts` - `notServedWords` and `notServed`, one sentence and one refusal shared with the file store.
- `code://packages/sdk/src/host.ts` - `storeFor` refuses a non-`file:` scheme no provider owns with `-32601`, before the file store is asked.
- `code://packages/computer/src/manifest.ts` - `MANIFEST_SCHEMA`, the create body as a schema, one source with `manifestOf`.
- `code://packages/computer/src/provider.ts` - `describe()` and a `capabilities.manifest` that is the same schema.
- `code://docs/PLUGINS.md`, `code://docs/COMPUTER.md`, `code://packages/sdk/README.md` - the provider contract, the key a client reads, and the port line.

## Verified

- `test/plugin-host.test.ts` - a folded provider is advertised with its title, description, manifest, `root` and derived operations on both the handshake and the root snapshot; the `vscode.*` flags survive beside it; a host with no provider has no key on either.
- `test/computer-plugin.test.ts` - through the loader, the `computer` entry names `Computer`, `computer://`, the five operations and the manifest whose image default is the configured one.
- `test/computer.test.ts` - `describe()` is the provider's claim alone, with no `root` or `operations`, and `capabilities.manifest` is the same schema.
- `test/plugin-validate.test.ts` - `describe` as a function is accepted; as a string it is refused.
- `test/uri-resources.test.ts` - an unregistered scheme is `-32601` with the sentence naming it, not `-32009`.
- `pnpm test` 73 files / 975 tests, `pnpm typecheck`, `pnpm boundary` and `pnpm schema` green.
- By hand, against a real daemon with the computer plugin: `initialize._meta` carried `ahpd.resourceProviders.computer` exactly as designed, the root snapshot carried the same map, and the ahpapp reader turned that key into a row whose value is `computer` with an action, while an unknown object renders as JSON rather than `[object Object]`.

## Departures from the plan

- `MANIFEST_SCHEMA` is a function of the runtime and the default image rather than a constant, so the default it names is the one this host will use.
- The advertised operations are all of `read`, `list`, `resolve`, `write`, `delete`, `mkdir`, `move` and `copy` that the provider implements, in that order; the computer implements the first five, which is what its entry names.
- `capabilities.manifest` changed from a sentence per field to the same schema, so a client that already reads capabilities now sees the fields it can draw rather than prose.

## Left for later

- The typed `InitializeResult.resourceSchemes` field upstream, which supersedes the `_meta` key when it exists - decision `a-resource-scheme-is-advertised-in-meta`.
- A registered session key still cannot answer `sessionConfigCompletions`, so a picker for the `computer` key is the client's own; `HANDOFF.md` pending 11.
- The ahpapp Computers screen, which reads this key, is built in that repository and is not this plan.
