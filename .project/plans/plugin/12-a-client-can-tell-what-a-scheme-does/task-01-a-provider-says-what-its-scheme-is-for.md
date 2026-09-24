---
title: A provider says what its scheme is for
status: done
depends: []
layer: packages/sdk, packages/computer
refs:
  - "[code://packages/sdk/src/types/resources.ts#L204-L211](../../../../packages/sdk/src/types/resources.ts#L204-L211) - `ResourceProvider`, which gains the optional method"
  - "[code://packages/sdk/src/validate.ts](../../../../packages/sdk/src/validate.ts) - `checkResourceProvider`, the boundary that must allow it"
  - "[code://packages/computer/src/manifest.ts](../../../../packages/computer/src/manifest.ts) - `manifestOf`, whose rules the schema has to say"
  - "[code://packages/computer/src/provider.ts#L78-L100](../../../../packages/computer/src/provider.ts#L78-L100) - `capabilities`, which already names the fields in prose"
  - "[code://test/computer.test.ts](../../../../test/computer.test.ts) - where the provider's answer is asserted"
  - "[code://test/plugin-validate.test.ts](../../../../test/plugin-validate.test.ts) - where a registration the boundary allows is asserted"
---

## Objective

`ResourceProvider` has an optional `describe()` answering a title, a line of prose and an optional manifest schema, the plugin boundary allows it, and `computerProvider` answers with the title, the description and a schema for the create body it already validates.

## Files

- `UPDATE: packages/sdk/src/types/resources.ts` - `SchemeDescription { title, description?, manifest? }` and `describe?(): SchemeDescription` on `ResourceProvider`.
- `UPDATE: packages/sdk/src/validate.ts` - `describe` accepted as an optional function on a provider registration.
- `UPDATE: packages/computer/src/manifest.ts` - `MANIFEST_SCHEMA`, the fields `manifestOf` reads, built from the same defaults the parser uses.
- `UPDATE: packages/computer/src/provider.ts` - `describe()` answering the title, the description and `MANIFEST_SCHEMA`.
- `UPDATE: test/computer.test.ts` - the provider's description.
- `UPDATE: test/plugin-validate.test.ts` - a provider with `describe` is accepted, and one with `describe: 7` is refused.

## Steps

1. Add the type and the optional method, documented as a claim about the scheme rather than a guarantee.
2. Allow it in the provider check, by kind, so a non-function is still a refusal.
3. Lift the create body into `MANIFEST_SCHEMA`: `image` with the provider's default, `cpus`, `memory`, `mounts` as an array of strings, `workdir`; the runtime is the host's and is not a field a client chooses unless more than one runtime exists.
4. Answer `describe()` from the provider's options, so the default image it names is the one it will use.
5. Make `capabilities()` and `describe()` read the same list of fields, so the two cannot drift.

## Validation

- `test/computer.test.ts` - `describe()` names `Computer`, `computer://` is the host's business and not the provider's, and the manifest names the five fields with the configured default image.
- `test/plugin-validate.test.ts` - `describe` as a function is accepted, as anything else is refused.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Not started.
The provider describes itself; the host decides `root` and `operations`, so a provider never claims an operation it does not implement.
