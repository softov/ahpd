---
title: Agent settings at the plugin and the record
created: 2026-11-05
refs:
  - git://9c3418cb - the commit of ahpd the facts were checked at
  - "[code://packages/agent-acp/package.json](../../packages/agent-acp/package.json) - the acp plugin's options"
  - "[code://packages/agent-claude/package.json](../../packages/agent-claude/package.json) - the claude plugin's options"
  - "[code://packages/agent-cofold/package.json](../../packages/agent-cofold/package.json) - the cofold plugin's options"
  - "[code://packages/agent-pi/package.json](../../packages/agent-pi/package.json) - the pi plugin's options"
  - "[code://packages/agent-acp/src/plugin.ts#L143-L190](../../packages/agent-acp/src/plugin.ts#L143-L190) - the acp engine's record fields, and the plugin-wide `hostTools` and `toolsChanged`"
  - "[code://packages/agent-acp/src/plugin.ts#L353-L354](../../packages/agent-acp/src/plugin.ts#L353-L354) - a record's `hostTools` and `toolsChanged` win over the plugin's"
  - "[code://packages/agent-claude/src/options.ts#L338](../../packages/agent-claude/src/options.ts#L338) - the claude engine's record fields"
  - "[code://packages/agent-claude/src/plugin.ts#L66](../../packages/agent-claude/src/plugin.ts#L66) - claude's `paths`, which falls back to the host's"
  - "[code://packages/agent-cofold/src/plugin.ts#L138](../../packages/agent-cofold/src/plugin.ts#L138) - the cofold engine's record fields"
  - "[code://packages/agent-pi/src/plugin.ts#L101](../../packages/agent-pi/src/plugin.ts#L101) - the pi engine's record fields"
  - "[code://packages/agent-pi/src/plugin.ts#L200](../../packages/agent-pi/src/plugin.ts#L200) - pi takes the host's paths, with no option of its own"
---

# Agent settings at the plugin and the record

Softov wants one table of every agent setting, at the plugin level and at the engine level, to find where the four agent plugins disagree.
His example, 2026-11-05: "ACP put the hostTools on plugin while claude put on agent."

## The two levels

- A plugin option is in the plugin's `optionsSchema`, in `config.json` under `plugins`. It holds for every record of that plugin.
- A record field is in the engine's `schema`, in `~/.config/ahpd/agents/<id>.json` under `config`. It holds for one agent.
- A record field marked host only may be set only on a record whose owner is `host`.
- Every record also has top-level fields outside `config`: `name`, `description`, `icon`, `model` and `owner`.
- Where a setting is at both levels, the record's value wins, and the plugin's is the default. This holds in the code of all four.

## The table

The table comes from the four `optionsSchema` blocks and from the schema each engine registers at the checked commit.
An empty cell means the plugin has no such setting.

| Setting | acp | claude | cofold | pi |
| --- | --- | --- | --- | --- |
| **Model** | | | | |
| `model` |  |  | plugin | plugin |
| `models` |  | record |  |  |
| `modelSources` |  | record |  |  |
| `keepCliModels` |  | record |  |  |
| `baseUrl` |  |  | plugin + record |  |
| `apiKey` |  |  | plugin + record |  |
| `resource` |  |  | plugin + record |  |
| **Prompt and output** | | | | |
| `instructions` |  |  | plugin + record |  |
| `outputStyle` |  | record |  |  |
| `thinking` |  | record |  |  |
| `autoCompactTokens` |  |  | plugin + record |  |
| **Host tools** | | | | |
| `hostTools` | plugin + record |  |  |  |
| `toolsChanged` | plugin + record |  |  |  |
| `hostTasks` |  | record |  |  |
| `enableTasks` |  | record |  |  |
| `tools` |  |  | plugin + record |  |
| `strictTools` |  |  | plugin |  |
| **Process** | | | | |
| `base` | record, host only |  |  |  |
| `command` | record, host only |  |  |  |
| `args` | record, host only |  |  |  |
| `extraArgs` |  | record, host only |  |  |
| `install` | record, host only |  |  |  |
| `page` | record |  |  |  |
| `env` | record | record |  | record |
| `cwd` | record, host only |  |  |  |
| `authenticate` | record |  |  |  |
| `logins` |  | record |  |  |
| `handshakeTimeoutMs` |  | plugin |  |  |
| `workerStop` |  | plugin |  |  |
| `sandbox` |  | record |  |  |
| **Folders and trust** | | | | |
| `paths` |  | plugin |  |  |
| `honoursTrust` | record |  |  |  |
| `projectTrust` |  |  |  | plugin + record |
| `sessionDir` |  |  |  | plugin + record, host only |
| `store` |  |  | plugin + record, host only |  |
| `memory` |  |  | plugin + record, host only |  |
| **Computers** | | | | |
| `machine` | record, host only |  |  |  |
| `computerExecutable` |  | plugin |  |  |
| `computerCli` |  | plugin |  |  |
| `computerCliFallback` |  | plugin |  |  |
| `computerConfigDir` |  | plugin | plugin + record, host only |  |

## What disagrees

- **Host tools.** Only acp has a `hostTools` switch, at the plugin and on the record. Claude, cofold and pi have none. Their sessions get the host's tools from the daemon's `sessionTools` and `sessionToolsProviders`, which gate acp too. Claude's `hostTasks` is a different thing: it hands Claude's own task tools to the host's.
- **The acp `toolsChanged` description.** The plugin's text says it wins "over each record's own", but the code takes the record's value first.
- **The default model.** cofold and pi set it at the plugin, as `model`. Claude sets a list per record, as `models` and `modelSources`. acp has none, and the agent picks.
- **Folders.** Only claude has `paths`. pi reads the host's paths with no option. acp and cofold read none.
- **Where sessions are kept.** pi has `sessionDir` and cofold has `store`, both at both levels. Claude and acp have none.
- **Project trust.** acp has `honoursTrust` on the record, and pi has `projectTrust` at both levels. Claude and cofold have none.
- **Computers.** Claude has four plugin options, the `computer` ones. cofold has `computerConfigDir` at both levels. acp has `machine` on the record. pi has none.
- **Environment.** acp, claude and pi take `env` on the record. cofold takes `baseUrl`, `apiKey` and `resource` instead.

## Claude's `paths`

- It scopes which past Claude sessions are listed, and its first entry is the default folder of a new session.
- Absent, it is the host's `paths`. pi uses the host's paths with no option at all.
- A client that names an absolute folder runs a session there, inside the list or not.
- So `paths` only narrows the list of past sessions, and moves the default folder away from the host's.

## Open points

- Which disagreements are deliberate, and which settings move to the other level.
- Whether claude's `paths` stays, or claude takes the host's paths as pi does.
- Whether `hostTools` becomes one switch for every agent, at the daemon, the plugin or the record.
