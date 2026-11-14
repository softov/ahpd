---
title: A plugin asks for its grants, and a person allows them in the client
created: 2026-11-14
refs:
  - git://9b15ce74a - the commit of ahpd the facts were checked at
  - "[code://docs/plugins/PLUGINS.md#L2073](../../docs/plugins/PLUGINS.md#L2073) - a plugin entry with `grants`, and the paragraph after it: none is the default"
  - "[code://docs/plugins/PLUGINS.md#L1162-L1163](../../docs/plugins/PLUGINS.md#L1162-L1163) - a plugin's connection does what its entry's grants say, and a host with no user directory gates nothing"
  - "[code://docs/plugins/BOTS.md#L310-L315](../../docs/plugins/BOTS.md#L310-L315) - the bot plugin's entry needs session:read and session:write"
  - "[code://docs/plugins/WEBHOOKS.md#L323](../../docs/plugins/WEBHOOKS.md#L323) - the webhook plugin's entry needs four grants"
  - "[code://packages/server/src/pluginschannel.ts#L498-L860](../../packages/server/src/pluginschannel.ts#L498-L860) - the plugins channel's methods: install, remove, write, source, options, apply, reload, update. None of them reads or writes grants"
  - "[code://packages/server/src/rootconfig.ts#L30-L38](../../packages/server/src/rootconfig.ts#L30-L38) - `DAEMON_KEYS`, the keys a client may edit, and why the others are left out"
  - "[code://packages/server/src/commands/options.ts#L1077](../../packages/server/src/commands/options.ts#L1077) - `configSchema`, every key the daemon takes"
---

# A plugin asks for its grants, and a person allows them in the client

Softov's goal: a person who has never seen a JSON file can install a plugin and use it.
Today a plugin that acts on sessions works only after somebody writes its `grants` into the configuration file by hand.
Nothing in a client says that this is needed, and nothing in a client can do it.

## What ahpd has now

- A plugin entry in `config.json` can carry `grants`, such as `["session:read", "session:write"]`. None is the default.
- A plugin's own connection is the principal `plugin:<name>`, and it may do only what its entry's grants say.
- A host with no user directory does not gate a plugin's connection.
- A plugin's `session:trust` is gated on every host. `can` reads only the entry's grants, and the host asks for it when a plugin puts a session in a trusted folder.
- So a bot talk is refused on every host when the bot plugin's entry has no grants: "plugin:bot may not session:trust here". Softov saw it on 2026-11-14, from the new session form.
- ahpw still offers the bot chat agent and the bots in its picker when the plugin cannot open a talk.
- Two first-party plugins need grants: `bot` needs `session:read` and `session:write`, and `webhook` needs `session:read`, `session:create`, `session:write` and `chat:create`.
- The plugins channel can install, remove, update, reload and configure a plugin. No method of it reads or writes `grants`, so ahpw cannot set them.
- A manifest has `contracts`, which says what a plugin registers. It does not say which grants the plugin needs.

## Answers

| Question | Answer | Date |
| --- | --- | --- |
| The manifest key | `asks`. `grants` reads as if the plugin gives the permission | 2026-11-14 |
| Where to start | The plugin grants, before the other settings | 2026-11-14 |
| One "Allow" or one for each grant | One "Allow" for every grant the plugin asks for | 2026-11-14 |
| What the plan covers | Plugin grants only. The feature keys wait for a later plan | 2026-11-14 |
| Which plan comes first | This one. The bot folder's trust follows it, in [a-bots-folder-is-trusted.md](a-bots-folder-is-trusted.md) | 2026-11-14 |
| An agent of a plugin that cannot work | Not offered. A plugin that lacks a grant it asks for shows an alarm and does not run | 2026-11-14 |

## A first draft, for Softov's review

1. **The plugin says what it needs.** The manifest lists the grants the plugin asks for, beside `contracts`, such as `"asks": ["session:read", "session:write"]`.
2. **The host shows the gap.** A plugin that asks for a grant its entry does not have gets a row state, such as "needs permission". Its agents are not offered in a picker until it has the grant. A person sees the alarm before a refusal.
3. **A person allows it in the client.** The plugin's row offers an operation, "Allow". It shows each grant in plain words, such as "Read your sessions" and "Send messages in your sessions". The words come from the host's grant catalogue, in the client's language, as the operations of #323 do. The host writes the grants into the plugin's entry.
4. **Nothing is allowed without a person.** First-party plugins ask too. Only a person who may change plugins can allow, and the operation's grant says who that is.

## Other settings only the file can hold

The daemon takes 69 top-level keys. A client may edit 23 of them, which `DAEMON_KEYS` names. The other 46 are in the file only. They fall in three groups.

### Who may reach the host, left out of a client on purpose

`rootconfig.ts` says why: "a form that could change them would be a form that could take the door off its hinges".

`users`, `connectionToken`, `connectionTokenFile`, `withoutConnectionToken`, `resource`, `origins`, `tunnelHosts`, `issuer`, `issuerVerify`, `requireIssuer`, `tokensPerPerson`.

### Features a person turns on, with no control in a client

| Key | What it turns on |
| --- | --- |
| `plugins[].grants` | What a plugin may do, this brief |
| `policies` | Whether the policies about agents, models and computers are enforced. [the-policy-check-is-a-server-setting.md](the-policy-check-is-a-server-setting.md) is about it |
| `mcpTools` | What `/mcp` serves to a person's MCP client. The default, `none`, answers 404 |
| `automations`, `unownedAutomations` | Where automations are kept, and what an automation with no owner wakes on |
| `sessions`, `usage` | Where a session's settings go, and how a turn is written down |
| `worktreesRoot` | Where session worktrees go |
| `service` | The service that holds the daemon |
| `shellEnv`, `terminalAutoApproveDefaults`, `commandParser` | The shells' environment, and how their commands are approved |
| `managedSettingsPermissions`, `managedSettingsSandbox`, `eligibleForAutoApproval`, `managedRules` | The rules every session is held to. VS Code keeps these in managed settings, which an administrator writes |
| `sleepAfterMinutes`, `sessionResidencyLimit` | How long a session stays loaded, and how many at most |

### Tuning, which a person does not need

`zshFolder`, `pluginEntryOutside`, `iconLimitBytes`, `iconTimeoutMs`, `readyTimeoutMs`, `stopWaitMs`, `rootConfigWrite`, `daemonRecord`, `onPath`, `clientToolTimeoutMs`, `clientToolCallDisconnectTimeoutMs`, `deltaWindowMs`, `attachmentFetchLimitBytes`, `toolResultResourceLimitBytes`, `logLevel`, `logTime`, `nodeRestart`.

### Not counted here

- The fields of a plugin's own options, which the plugins channel writes.
- Files a person writes beside the configuration, such as a bot's `bot.md` or an agent preset in `agents/`. Their fields that no client form shows are a survey of their own.
