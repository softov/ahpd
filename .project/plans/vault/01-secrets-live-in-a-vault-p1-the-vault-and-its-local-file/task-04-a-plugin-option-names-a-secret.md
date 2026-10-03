---
title: A plugin option names a secret
status: done
depends: [task-08-the-daemon-holds-its-vault.md]
layer: "server"
refs:
  - "[code://packages/server/src/plugins.ts#L320-L371](../../../../packages/server/src/plugins.ts#L320-L371) - `LoadOneOptions` and its `usage` function"
  - "[code://packages/server/src/plugins.ts#L515-L533](../../../../packages/server/src/plugins.ts#L515-L533) - options merged over defaults, then checked"
  - "[code://packages/server/src/plugins.ts#L542-L553](../../../../packages/server/src/plugins.ts#L542-L553) - `pluginHost` handed the live usage port"
  - "[code://packages/server/src/plugins.ts#L686-L698](../../../../packages/server/src/plugins.ts#L686-L698) - `loadPlugins` calling `loadOne`"
  - "[code://packages/server/src/commands/config.ts#L52-L59](../../../../packages/server/src/commands/config.ts#L52-L59) - `schemaOf`, the schema one option is held to"
  - "[code://packages/agent-claude/src/options.ts#L100-L116](../../../../packages/agent-claude/src/options.ts#L100-L116) - `fromEnv: true`, a keyword on a plugin's own schema node"
  - "[code://packages/server/test/fixtures/plugin-secret/index.ts](../../../../packages/server/test/fixtures/plugin-secret/index.ts) - the mask tests' fixture with a `writeOnly` option, the shape the new one copies"
---

## Objective

Any plugin's option written `{ "$secret": "host:<name>" }` is the secret's value when the plugin's schema is checked and when `apply` runs; a plugin whose secret cannot be read is skipped with one line that says why.

## Files

- `UPDATE: packages/server/src/plugins.ts:320-371` - `vault?: () => Vault | undefined` in `LoadOneOptions`, beside `usage`.
- `UPDATE: packages/server/src/plugins.ts:515-533` - resolve references in `values` before `check`.
- `UPDATE: packages/server/src/plugins.ts:542-553` - hand `vault` to `pluginHost`, as `usage` is.
- `UPDATE: packages/server/src/plugins.ts:686-698` - `vaultInForce()`, one function: the daemon's file vault, unless a plugin listed earlier in `plugins` set `ports.vault` with `replace`; every load reads its vault through it, so the rule can change.
- `UPDATE: packages/server/src/commands/config.ts:52-59` - `schemaOf` moves out; the mask imports it.
- `CREATE: packages/server/test/fixtures/plugin-secret-ref/index.ts` - a `writeOnly` string option, a `secretAtUse` option, and an `apply` that records what each arrived as; the mask tests' `plugin-secret` stays as it is.
- `CREATE: packages/server/test/plugin-secret-ref.test.ts` - the cases below.

## Steps

1. Move `schemaOf` from `commands/config.ts:52-59` into `plugins.ts` and export it; `commands/config.ts` already imports from `plugins.ts`, so the mask and the loader read a schema the same way.
2. Walk `values` with the plugin's schema beside it, through `schemaOf`: every `secretRef` found is replaced by `await readSecret(vault, name, {})`, so a `team:` or `user:` name is refused as out of scope at load.
3. A schema node with `"secretAtUse": true` is left as written, references and all, for the plugin to read through `host.secret`, as the plan's second table says. The schema check runs on a copy where each reference left in place is its name, so a node declared `type: string` still passes; `apply` gets the reference.
4. A refusal skips the plugin: `plugin <name> skipped: plugins.<name>.options.<path> names <secret>: <why>`, where why is the `readSecret` message.
5. A plugin that registers a vault cannot name a secret in its own options: when a plugin whose options held a `$secret` reference sets `ports.vault`, the load is refused and the plugin skipped with the sentence `a vault plugin's own options cannot name a secret`, so a vault never depends on itself or on the one it replaces.
6. `Loaded.options` keeps what `apply` was given; nothing that answers a client reads it (root config reads the file).

## Validation

- `packages/server/test/plugin-secret-ref.test.ts`: a `host:` reference arrives as the value and passes a `type: string` schema; a `user:` reference is skipped as out of scope; a missing name skips with `the vault holds no`; a `secretAtUse` option arrives as the reference; with a fake vault plugin listed first and `replace`, a later plugin's reference is read from it; a vault plugin with a `$secret` in its own options is skipped with the sentence.
- `pnpm -F @ahpd/server test`.

## Resume
