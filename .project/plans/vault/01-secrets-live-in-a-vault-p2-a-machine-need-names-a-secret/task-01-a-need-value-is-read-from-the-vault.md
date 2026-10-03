---
title: A need value is read from the vault when the machine is made
status: done
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L56-L90](../../../../packages/computer/src/plugin.ts#L56-L90) - `optionsSchema`; `needs` at L71, `profiles` at L73"
  - "[code://packages/computer/src/plugin.ts#L95-L100](../../../../packages/computer/src/plugin.ts#L95-L100) - `named`"
  - "[code://packages/computer/src/plugin.ts#L109-L141](../../../../packages/computer/src/plugin.ts#L109-L141) - `profilesOf`; a profile's `needs` at L127"
  - "[code://packages/computer/src/plugin.ts#L253](../../../../packages/computer/src/plugin.ts#L253) - `needValues`"
  - "[code://packages/computer/src/plugin.ts#L538-L552](../../../../packages/computer/src/plugin.ts#L538-L552) - the provider's options"
  - "[code://packages/computer/src/plugin.ts#L693-L711](../../../../packages/computer/src/plugin.ts#L693-L711) - dev container `manifestOf` call"
  - "[code://packages/computer/src/plugin.ts#L742-L762](../../../../packages/computer/src/plugin.ts#L742-L762) - disposable `manifestOf` call"
  - "[code://packages/computer/src/provider.ts#L21-L49](../../../../packages/computer/src/provider.ts#L21-L49) - `ProviderOptions`"
  - "[code://packages/computer/src/provider.ts#L269-L305](../../../../packages/computer/src/provider.ts#L269-L305) - form `manifestOf` call"
  - "[code://packages/computer/src/manifest.ts#L54-L55](../../../../packages/computer/src/manifest.ts#L54-L55) - `Profile.needs`"
  - "[code://packages/computer/src/manifest.ts#L158-L159](../../../../packages/computer/src/manifest.ts#L158-L159) - `ManifestDefaults.needValues`"
---

## Objective

A need value written `{ "$secret": "<name>" }` in the computer plugin's `needs` or a profile's `needs` is the secret's value in the machine it makes, read for that machine's owner and team, and a value that cannot be read refuses the machine naming the need and the secret.

## Files

- `UPDATE: packages/computer/src/plugin.ts:71-73` - `needs` and each profile's `needs` declare `secretAtUse: true` on their values, beside container/05 p1's `writeOnly`, and accept a string or a reference.
- `UPDATE: packages/computer/src/plugin.ts:95-100` - `needValuesOf`, beside `named`: keeps a string or a `secretRef` value, drops the rest; used at L127 and L253.
- `UPDATE: packages/computer/src/manifest.ts:54-55`, `packages/computer/src/manifest.ts:158-159`, `packages/computer/src/provider.ts:21-49` - `Profile.needs` and `needValues` are `Record<string, string | SecretRef>`; `ProviderOptions` gains `secret: PluginHost['secret']`.
- `CREATE: packages/computer/src/secrets.ts` - `revealed(values, work, secret)`: a copy with every reference read through `secret`; a refusal throws `machine need <need> names <name>: <why>`.
- `UPDATE: packages/computer/src/plugin.ts:693-711`, `packages/computer/src/plugin.ts:742-762` - before `manifestOf`, reveal `needValues` and the picked profile's `needs` with `{ owner: asked.owner, team: asked.team }`.
- `UPDATE: packages/computer/src/provider.ts:269-305` - the same with `{ owner }`, and the refusal as `RpcError(-32602, ...)`.
- `UPDATE: packages/computer/src/plugin.ts:538-552` - hand `secret: (name, work) => host.secret(name, work)` to the provider.
- `UPDATE: packages/computer/test/computer-needs.test.ts` - the cases below, with a fake `secret`.

## Steps

1. Only the picked profile's needs are revealed, so a profile nobody picked never reads the vault.
2. `manifestOf` and `resolveNeeds` stay as they are; they only ever see strings.

## Validation

- `computer-needs.test.ts`: a profile need `{ "$secret": "user:ada/token" }` made for `user:ada` lands as the env value; made for `user:bo` it is refused naming the need and the secret; a `host:` value in the option lands for any owner; a name the vault does not hold refuses with `the vault holds no`; a profile not picked is never read.
- `pnpm -F @ahpd/computer test` and `pnpm typecheck`.

## Resume
