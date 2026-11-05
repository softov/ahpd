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
- A plugin's `model` is only the default for a record that names none. Two records of one plugin can each name their own `model`.
- Where a setting is at both levels, the record's value wins, and the plugin's is the default. This holds in the code of all four.

## The table

The table comes from the four `optionsSchema` blocks and from the schema each engine registers at the checked commit.

- ✓ is a setting at that level, and ✓ host is a record field only a host record may set.
- `model` is a field at the top of a record, outside `config`. Every other record row is a field of `config`.
- 🔵 is a setting the harness takes, which ahpd does not offer at that level. *Why each blue circle* gives the fact behind each one.
- An empty cell is a setting that does not apply there.

| Setting | acp plugin | acp record | claude plugin | claude record | cofold plugin | cofold record | pi plugin | pi record |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Model** | | | | | | | | |
| `model` (top level) |  | ✓ | 🔵 | 🔵 | ✓ | ✓ | ✓ | ✓ |
| `models` |  |  |  | ✓ |  |  |  | 🔵 |
| `modelSources` |  |  |  | ✓ |  |  |  |  |
| `keepCliModels` |  |  |  | ✓ |  |  |  |  |
| `baseUrl` |  |  |  |  | ✓ | ✓ | 🔵 | 🔵 |
| `apiKey` |  |  |  |  | ✓ | ✓ |  |  |
| `resource` |  |  |  |  | ✓ | ✓ |  |  |
| **Prompt and output** | | | | | | | | |
| `instructions` |  |  | 🔵 | 🔵 | ✓ | ✓ | 🔵 | 🔵 |
| `outputStyle` |  |  |  | ✓ |  |  |  |  |
| `thinking` |  |  |  | ✓ |  | 🔵 |  | 🔵 |
| `autoCompactTokens` |  |  |  |  | ✓ | ✓ |  | 🔵 |
| **Host tools** | | | | | | | | |
| `hostTools` | ✓ | ✓ | 🔵 | 🔵 | 🔵 | 🔵 | 🔵 | 🔵 |
| `toolsChanged` | ✓ | ✓ |  |  |  |  |  |  |
| `hostTasks` |  |  |  | ✓ |  |  |  |  |
| `enableTasks` |  |  |  | ✓ |  |  |  |  |
| `tools` |  |  |  | 🔵 | ✓ | ✓ |  | 🔵 |
| `strictTools` |  |  |  |  | ✓ |  |  |  |
| **Process** | | | | | | | | |
| `base` |  | ✓ host |  |  |  |  |  |  |
| `command` |  | ✓ host |  |  |  |  |  |  |
| `args` |  | ✓ host |  |  |  |  |  |  |
| `extraArgs` |  |  |  | ✓ host |  |  |  |  |
| `install` |  | ✓ host |  |  |  |  |  |  |
| `page` |  | ✓ |  |  |  |  |  |  |
| `env` |  | ✓ |  | ✓ |  |  |  | ✓ |
| `cwd` |  | ✓ host |  |  |  |  |  |  |
| `authenticate` |  | ✓ |  |  |  |  |  |  |
| `logins` |  |  |  | ✓ |  |  |  |  |
| `handshakeTimeoutMs` |  |  | ✓ |  |  |  |  |  |
| `workerStop` |  |  | ✓ |  |  |  |  |  |
| `sandbox` |  |  |  | ✓ |  |  |  |  |
| **Folders and trust** | | | | | | | | |
| `paths` |  |  | ✓ |  |  |  |  |  |
| `honoursTrust` |  | ✓ |  |  |  |  |  |  |
| `projectTrust` |  |  |  |  |  |  | ✓ | ✓ |
| `sessionDir` |  |  |  |  |  |  | ✓ | ✓ host |
| `store` |  |  |  |  | ✓ | ✓ host |  |  |
| `memory` |  |  |  |  | ✓ | ✓ host |  |  |
| **Computers** | | | | | | | | |
| `machine` |  | ✓ host |  |  |  |  |  |  |
| `computerExecutable` |  |  | ✓ |  |  |  |  |  |
| `computerCli` |  |  | ✓ |  |  |  |  |  |
| `computerCliFallback` |  |  | ✓ |  |  |  |  |  |
| `computerConfigDir` |  |  | ✓ | 🔵 | ✓ | ✓ host |  |  |

## Why each blue circle

- **claude `model`.** Every record has a top-level `model`, and acp, cofold and pi start a session on it. Claude's engine does not read it, so a Claude agent starts on the CLI's default. See [`code://packages/agent-claude/src/plugin.ts#L125-L135`](../../packages/agent-claude/src/plugin.ts#L125-L135). A plugin-wide default is missing too.
- **pi record `models`, pi `baseUrl`.** pi's SDK takes a provider at run time with `ModelRegistry.registerProvider(name, { baseUrl, apiKey, api, models })`. ahpd reads only pi's own `models.json` and `auth.json`. See [`code://packages/agent-pi/src/backend.ts#L335-L344`](../../packages/agent-pi/src/backend.ts#L335-L344).
- **claude and pi `instructions`.** Claude's SDK takes a prompt to append, and ahpd already sends the host's instructions through it. See [`code://packages/agent-claude/src/session/query.ts#L451`](../../packages/agent-claude/src/session/query.ts#L451). pi's SDK replaces or appends to its system prompt. cofold has `instructions` at both levels.
- **pi record `thinking`.** pi's `createAgentSession` takes a `thinkingLevel`, and claude has `thinking` on the record.
- **cofold record `thinking`.** cofold reads an effort level per session, from the session's `effortLevel` setting. See [`code://packages/agent-cofold/src/agent.ts#L424-L431`](../../packages/agent-cofold/src/agent.ts#L424-L431). A record cannot set a default.
- **claude and pi record `tools`.** Claude's SDK takes `allowedTools` and `disallowedTools`, and ahpd already sends both. See [`code://packages/agent-claude/src/session/query.ts#L135`](../../packages/agent-claude/src/session/query.ts#L135). pi's `createAgentSession` takes `tools` and `excludeTools`.
- **pi record `autoCompactTokens`.** pi's `SettingsManager` holds compaction settings, and cofold has the field on the record.
- **claude, cofold and pi `hostTools`.** The host offers its tools to every session. Only acp can turn them off for one plugin or one agent.
- **claude record `computerConfigDir`.** cofold lets a host record set it, and claude has it at the plugin only.

## What disagrees

- **Host tools.** Only acp has a `hostTools` switch, at the plugin and on the record. Claude, cofold and pi have none. Their sessions get the host's tools from the daemon's `sessionTools` and `sessionToolsProviders`, which gate acp too. Claude's `hostTasks` is a different thing: it hands Claude's own task tools to the host's.
- **The acp `toolsChanged` description.** The plugin's text says it wins "over each record's own", but the code takes the record's value first.
- **The default model.** cofold and pi set it at the plugin, as `model`. Claude sets a list per record, as `models` and `modelSources`. acp has none, and the agent picks.
- **Folders.** Only claude has `paths`. pi reads the host's paths with no option. acp and cofold read none.
- **Where sessions are kept.** pi has `sessionDir` and cofold has `store`, both at both levels. Claude and acp have none.
- **Project trust.** acp has `honoursTrust` on the record, and pi has `projectTrust` at both levels. Claude and cofold have none.
- **Computers.** Claude has four plugin options, the `computer` ones. cofold has `computerConfigDir` at both levels. acp has `machine` on the record. pi has none.
- **Environment.** acp, claude and pi take `env` on the record. cofold takes `baseUrl`, `apiKey` and `resource` instead.
- **pi's provider.** pi takes credentials, and ahpd uses that: a pi record sets keys through `env`, which ahpd hands to pi with `setRuntimeApiKey`. A base URL and a model list come only from pi's own `models.json`, outside ahpd.

## Settings that one agent has

- **`hostTasks` and `enableTasks`, claude only.** Claude ships its own task tools: `TodoWrite`, `TaskCreate`, `TaskUpdate`, `TaskList` and `TaskGet`. `hostTasks` takes them away when the host offers the tasks plugin's `task_add`. pi ships no task tools, and cofold's tool groups have none. An acp agent's tools are its own, and the host cannot take one away. See [`code://packages/agent-claude/src/options.ts#L92-L126`](../../packages/agent-claude/src/options.ts#L92-L126).
- **`tools` and `strictTools`, cofold only.** ahpd configures cofold in code, so its tool groups are ahpd settings: `files`, `shell`, `memory` and `web`. `strictTools: false` drops a tool key cofold does not know, in place of a refusal. The other agents keep their tools in their own settings files.
- **No `env` or `cwd` on cofold.** cofold runs in the daemon's own process, so no child process takes variables or a folder. A session works in its own folder, or in the daemon's folder when it names none. See [`code://packages/agent-cofold/src/session.ts#L102`](../../packages/agent-cofold/src/session.ts#L102).
- **cofold's variables.** cofold reads `COFOLD_CONFIG`, `COFOLD_BASE_URL`, `COFOLD_API_KEY` and `COFOLD_MODEL` from the daemon's environment. See [`code://packages/agent-cofold/src/config.ts#L57-L116`](../../packages/agent-cofold/src/config.ts#L57-L116). In a machine, ahpd sets them as machine needs. A record has `baseUrl`, `apiKey` and `model` for three of them, and nothing for `COFOLD_CONFIG`, so every cofold record reads one config file.
- **No `thinking` on cofold.** The effort is a session setting only, as *Why each blue circle* says.

## The folder settings

| Setting | Agent | What it is |
| --- | --- | --- |
| `cwd` | acp | The folder the ACP server process starts in. Absent, it is the session's folder. |
| `paths` | claude | The folders whose past Claude sessions are listed. The first is the default folder of a new session. |
| `honoursTrust` | acp | Whether the agent asks the person before it loads a project's own settings. Absent, a session in a folder the host did not trust is refused. |
| `projectTrust` | pi | Whether pi loads a project's own extensions, skills and prompts. |
| `sessionDir` | pi | The folder pi keeps its session files in. pi's own folder by default. |
| `store` | cofold | The folder of each record's file store, one folder per record. |
| `memory` | cofold | `true` keeps each record's store in memory, for a test. |

- `cwd` and `paths` say where a session runs. `honoursTrust` and `projectTrust` say what a session may load from that folder. `sessionDir`, `store` and `memory` say where the agent keeps its own data.
- The session's folder itself is not a setting. The client names it, or the agent takes its default.

## Claude's `paths`

- It scopes which past Claude sessions are listed, and its first entry is the default folder of a new session.
- Absent, it is the host's `paths`. pi uses the host's paths with no option at all.
- A client that names an absolute folder runs a session there, inside the list or not.
- So `paths` only narrows the list of past sessions, and moves the default folder away from the host's.

## Open points

- Which disagreements are deliberate, and which settings move to the other level.
- Whether claude's `paths` stays, or claude takes the host's paths as pi does.
- Whether `hostTools` becomes one switch for every agent, at the daemon, the plugin or the record.
- Whether a cofold record gives its shell commands variables of their own. The record has no such field today.
- Whether a cofold record names its own config file, in place of the daemon's `COFOLD_CONFIG`.
