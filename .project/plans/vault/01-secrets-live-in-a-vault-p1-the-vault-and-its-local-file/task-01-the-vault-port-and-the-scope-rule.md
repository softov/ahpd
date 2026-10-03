---
title: The vault port and the scope rule
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L31-L44](../../../../packages/sdk/src/types/plugin.ts#L31-L44) - `PortKey`"
  - "[code://packages/sdk/src/types/plugin.ts#L152-L168](../../../../packages/sdk/src/types/plugin.ts#L152-L168) - `recordUsage`, the host call `secret` mirrors"
  - "[code://packages/sdk/src/types/plugin.ts#L233-L240](../../../../packages/sdk/src/types/plugin.ts#L233-L240) - `registerUsage`"
  - "[code://packages/sdk/src/plugins.ts#L30-L42](../../../../packages/sdk/src/plugins.ts#L30-L42) - `PORT_KEYS`"
  - "[code://packages/sdk/src/plugins.ts#L264-L272](../../../../packages/sdk/src/plugins.ts#L264-L272) - the live `usage` port a plugin host is handed"
  - "[code://packages/sdk/src/plugins.ts#L335-L339](../../../../packages/sdk/src/plugins.ts#L335-L339) - `recordUsage` over it"
  - "[code://packages/sdk/src/plugins.ts#L395](../../../../packages/sdk/src/plugins.ts#L395) - `registerUsage` through `setPort`"
  - "[code://packages/sdk/src/validate.ts#L126-L168](../../../../packages/sdk/src/validate.ts#L126-L168) - `PORT_MEMBERS` and `PORT_METHOD`"
  - "[code://packages/sdk/src/types/host.ts#L210-L216](../../../../packages/sdk/src/types/host.ts#L210-L216) - `HostOptions.usage`"
  - "[code://packages/sdk/src/types/usage.ts](../../../../packages/sdk/src/types/usage.ts) - `Owner`, which a `user:` secret is matched against"
---

## Objective

`@ahpd/sdk` exports a `Vault` port a plugin replaces with `registerVault(vault, 'replace')`, the `{ "$secret" }` reference form, and one function that reads a secret for a piece of work under the scope rule.
A plugin reads a secret at use time through `host.secret(name, work)`, the way it writes usage through `host.recordUsage`.

## Files

- `CREATE: packages/sdk/src/types/vault.ts` - `Vault { get(name): Promise<string | undefined>; set(name, value): Promise<void>; delete(name): Promise<boolean>; list(): Promise<string[]> }`, `SecretRef { $secret: string }`, `SecretWork { owner?: Owner; team?: string }`.
- `CREATE: packages/sdk/src/vault.ts` - `secretRef(value)`, `scopeOf(name)`, `readSecret(vault, name, work)`.
- `UPDATE: packages/sdk/src/types/host.ts:210-216` - `vault?: Vault` beside `usage`.
- `UPDATE: packages/sdk/src/types/plugin.ts:31-44` - `'vault'` in `PortKey`.
- `UPDATE: packages/sdk/src/types/plugin.ts:152-168` - `secret(name: string, work?: SecretWork): Promise<string>` on `PluginHost`, after `recordUsage`.
- `UPDATE: packages/sdk/src/types/plugin.ts:233-240` - `registerVault(vault: PortOf<'vault'>, when?: 'replace'): void` after `registerUsage`.
- `UPDATE: packages/sdk/src/plugins.ts:30-33` - `'vault'` in `PORT_KEYS`.
- `UPDATE: packages/sdk/src/plugins.ts:264-272` - `vault?: () => Vault | undefined` beside `usage`.
- `UPDATE: packages/sdk/src/plugins.ts:335-339` - `secret` over it, after `recordUsage`.
- `UPDATE: packages/sdk/src/plugins.ts:395` - `registerVault: (vault, when) => { setPort('vault', 'registerVault', vault, when); }`.
- `UPDATE: packages/sdk/src/validate.ts:126-168` - `vault: { get: 'function', set: 'function', delete: 'function', list: 'function' }` and `vault: 'registerVault'`.
- `UPDATE: packages/sdk/src/types/index.ts`, `packages/sdk/src/index.ts` - export the types and the three functions.
- `CREATE: packages/sdk/test/vault.test.ts` - the reference form and the scope rule.
- `UPDATE: packages/sdk/test/plugin-fold.test.ts` - a plugin's vault, with and without `'replace'`.

## Steps

1. `scopeOf(name)` answers `{ scope: 'host' }`, `{ scope: 'team', team }` or `{ scope: 'user', user }` for `host:<name>`, `team:<team>/<name>`, `user:<id>/<name>`, and throws naming the three forms for anything else, an empty part included.
2. `secretRef(value)` answers the name when `value` is an object whose only key is `$secret` and whose value is a string, else `undefined`.
3. `readSecret(vault, name, work)` checks the scope first: `host:` always; `team:<t>/` only when `work.team === t`; `user:<id>/` only when `work.owner === 'user:<id>'`. Out of scope throws `<name> is not a secret this work may read`.
4. Then: a name the vault does not hold throws `the vault holds no <name>`; otherwise the value.
5. `secret` on the plugin host reads the live port, as `recordUsage` does, and goes through `readSecret`; no port at all throws `<name> cannot be read: this host has no vault`.
6. Comments say what each declaration is; the port's comment names decision `the-local-vault-is-a-plain-file-until-it-is-encrypted` as the `usage` port names its decision.

## Validation

- `packages/sdk/test/vault.test.ts`: each form parsed; a bad form refused; a `team:` secret read for its team and refused for another; a `user:` secret read for `user:<id>` and refused for `root:<host>`; a missing name says so.
- `packages/sdk/test/plugin-fold.test.ts`: a plugin's vault over a base without one is set; over a base with one it is a problem unless `'replace'`.
- `pnpm -F @ahpd/sdk test` and `pnpm typecheck`.

## Resume
