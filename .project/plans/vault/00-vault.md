---
title: Vault - what exists today
domain: vault
revalidated: 2026-10-03
---

The vault is where a host keeps the secrets its plugins and machines are given, so `config.json` holds a reference rather than a key.
Nothing of it exists yet: a credential is plain text in `config.json`, a client is only told whether it is set, and two plugins read a key from the daemon's environment instead.
Plan [01 - Secrets live in a vault](01-secrets-live-in-a-vault/plan.md) builds it.

## Packages

- [`code://packages/sdk`](../../../packages/sdk) - the host and its ports; the `vault` port joins them here.
- [`code://packages/server`](../../../packages/server) - the daemon; its local vault (a plain file until [it is encrypted](../../ideas/the-local-vault-is-encrypted.md)), the `ahpd vault` commands and the plugin option loading that resolves a reference.
- [`code://packages/computer`](../../../packages/computer) - the computer plugin, which resolves a machine need that names a secret when it makes the machine.

## Contracts

- [`code://packages/sdk/src/types/plugin.ts#L31-L44`](../../../packages/sdk/src/types/plugin.ts#L31-L44) - `PortKey`, the closed union of ports a plugin may replace.
- [`code://packages/sdk/src/types/plugin.ts#L233-L240`](../../../packages/sdk/src/types/plugin.ts#L233-L240) - `registerUsage`, the registration a `registerVault` mirrors.
- [`code://packages/sdk/src/types/sessions.ts#L60-L85`](../../../packages/sdk/src/types/sessions.ts#L60-L85) - a session's scope and owner (host/34, host/35), which a `team:` or `user:` secret is resolved against.
- [`code://packages/sdk/src/types/computers.ts#L74-L108`](../../../packages/sdk/src/types/computers.ts#L74-L108) - `MachineSource`, which carries the owner, team and project a machine is made for.

## Runtime path

Today a secret reaches a plugin three ways:

```
config.json plugins[].options.<key> (plain text) -> loadOne -> optionsSchema check -> apply(host, values)
root config / GET /api/config -> maskValue: an option the schema marks writeOnly answers <set>
claude env { "fromEnv": "NAME" } -> process.env[NAME] when the CLI is started
proxy providers key { env: NAME } -> process.env[NAME] when a provider is called
```

- [`code://packages/server/src/plugins.ts#L515-L533`](../../../packages/server/src/plugins.ts#L515-L533) - a plugin's options, merged over its defaults and held to its schema.
- [`code://packages/server/src/commands/config.ts#L62-L69`](../../../packages/server/src/commands/config.ts#L62-L69) - `walk`, the one mask every answer about a plugin's options goes through.
- [`code://packages/agent-claude/src/options.ts#L225-L243`](../../../packages/agent-claude/src/options.ts#L225-L243) - claude/12's `{ "fromEnv": "NAME" }`, read by Claude's own options.
- [`code://packages/server/src/proxy/providers.ts#L25-L38`](../../../packages/server/src/proxy/providers.ts#L25-L38) - a proxy provider's key, named by the variable holding it.

## Tests

None yet.

## Known gaps

- No secret has anywhere to live but `config.json` or the daemon's environment.
- A person's or a team's own token cannot be kept apart from the host's.
- A repository provider's token (the idea [repositories are resources](../../ideas/repositories-are-resources.md)) waits on this domain.
