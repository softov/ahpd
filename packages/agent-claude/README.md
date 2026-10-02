# @ahpd/agent-claude

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fagent-claude)](https://www.npmjs.com/package/@ahpd/agent-claude)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

Claude Code as a backend for [`@ahpd/sdk`](https://www.npmjs.com/package/@ahpd/sdk), and the plugin that lets the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon run it.

Part of [ahpd](https://github.com/softov/ahpd). The source is in [`packages/agent-claude`](https://github.com/softov/ahpd/tree/main/packages/agent-claude).

## In the daemon

Install it where the daemon resolves a plugin name from, and name it:

```bash
ahpd plugin install @ahpd/agent-claude
ahpd --plugin @ahpd/agent-claude
```

```json
{
  "plugins": ["@ahpd/agent-claude"]
}
```

It takes no options in the ordinary install: it catalogues whatever directories the daemon was started on. A configuration may narrow or rename that:

| option | |
| --- | --- |
| `paths` | the directories it catalogues, and where a session goes by default. Defaults to the host's |
| `provider` | the id clients name. `claude` unless something else already is |
| `displayName` | what a client reads instead of the id. `Claude Code` by default |
| `computerExecutable` | where the CLI is *inside a machine*. `claude` on the image's PATH by default |
| `computerConfigDir` | the configuration directory the CLI reads *inside a machine*. `/ahpd/claude` by default; `false` leaves the image's own |
| `workerStop` | what a stop given in a subagent's chat stops. `worker` by default, which stops that subagent and lets the turn that started it go on; `session` cancels that turn instead |
| `presets` | named sets of Claude options, by name. One is what every session runs on; two or more offer a session a choice, and the first is the default |

### Presets

A preset is a set of Claude options an operator writes once and sessions run on, rather than options each session offers a control for. Two of them give a session a `preset` to choose from, fixed when the session is created:

```json
{
  "plugins": [
    { "name": "@ahpd/agent-claude", "options": {
      "presets": {
        "work": { "thinking": "adaptive", "sandbox": "on" },
        "read-only": { "thinking": "disabled", "sandbox": "on", "outputStyle": "concise" }
      }
    } }
  ]
}
```

A preset holds five fields, and each is checked when the plugin loads, so a preset that names anything else is the daemon refusing this package rather than a session quietly running on something nobody wrote:

| field | |
| --- | --- |
| `sandbox` | the CLI's own sandbox for shell commands: `default` leaves it to the settings files, `on` and `off` set it |
| `thinking` | extended thinking: `adaptive` lets the agent decide when to think, `disabled` is none |
| `outputStyle` | the name of a style from the CLI's own settings |
| `env` | variables for the CLI's process, laid over the daemon's own environment. A value is a string, `null` to unset the variable, or `{ "fromEnv": "NAME" }` for the daemon's own `NAME`, which must be set when the plugin loads |
| `extraArgs` | arguments the CLI is started with beyond the ones this backend builds, by name without the `--`, and `null` for a flag that takes none |

With one preset there is nothing to choose and every session runs on it; with none, a session runs on what this backend has always run on, which is `thinking: "adaptive"` and no sandbox layer. The first preset is the default in both senses, and a session whose own stored `preset` names one that has since been renamed or removed runs on the first, which is what is left of a choice that no longer resolves.

### A second Claude on another endpoint

Load the package twice, the second time under its own `provider` and `displayName` and with one preset that points the CLI elsewhere. It is listed as a harness of its own, and the key stays in the daemon's environment:

```json
{
  "plugins": [
    "@ahpd/agent-claude",
    { "name": "@ahpd/agent-claude", "options": {
      "provider": "claude-openrouter",
      "displayName": "Claude Code (OpenRouter)",
      "presets": {
        "openrouter": { "env": {
          "ANTHROPIC_BASE_URL": "https://openrouter.ai/api",
          "ANTHROPIC_AUTH_TOKEN": { "fromEnv": "OPENROUTER_API_KEY" },
          "ANTHROPIC_API_KEY": "",
          "ANTHROPIC_MODEL": "stealth/space-bunny-alpha",
          "ANTHROPIC_SMALL_FAST_MODEL": "stealth/space-bunny-alpha"
        } }
      }
    } }
  ]
}
```

## In your own host

```bash
pnpm add @ahpd/agent-claude @ahpd/sdk @microsoft/agent-host-protocol
```

```ts
import { createHost, listen } from '@ahpd/sdk';
import { claude } from '@ahpd/agent-claude';

const path = process.cwd();
const host = createHost({ path, agents: [claude({ paths: [path] })] });
await listen({ port: 9187 }, (peer) => host.accept(peer));
```

`createHost` takes a list of agents, so this can run alongside other backends. The plugin entry wraps the same `claude()`.

## What it does

It starts the [Claude agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), converts its message stream into AHP state actions, and reads Claude's transcript files.

| export | |
| --- | --- |
| `claude(options)` | the `Agent` to pass to `createHost` |
| `createSession(options)` | one live session |
| `catalogue(dir)` | Claude's sessions in a directory, as rows a host can list |
| `turnsOf(sessionId, dir)` | a past session read from its transcript, as turns |
| `subagentsOf(sessionId, dir, turns)` | the subagent chats a past session ran, linked to the calls that spawned them |
| `probe(options)` | runs a CLI at startup to read the available models and commands |
| `apply(host, options)` | the plugin entry, with `name` and `title` beside it |

## Supported

Turns and streaming, tool calls and approvals, questions from the agent, model and effort selection, permission modes, MCP servers and OAuth sign-in, skills and slash commands, multiple chats per session, forking a chat from a turn, truncating a chat back to a turn, session titles, token usage, and context compaction.

An approval offers Allow once, an "always" choice and Deny when the SDK suggests a permission to keep for the call. The "always" choice is labelled by what the suggestions do, and picking it returns them to the SDK as `updatedPermissions`. With no suggestion, the approval is approve or deny.

A subagent Claude runs is its own chat. Every `Task` and `Agent` call opens one through the host's `Start.subagent`, read-only and named `ahp-chat://subagent/…`, and the subagent's text, thinking, tool calls and permission asks are drawn there instead of in the turn that spawned it. A stop given in the subagent's chat stops that subagent through the SDK's `stopTask`, and the turn that started it goes on and sees the call end. With `workerStop: "session"`, or before Claude has named the subagent's task, it cancels that turn instead. On a host without `Start.subagent` the subagent's output stays inline. A session read back from disk rebuilds each subagent's chat from the CLI's `subagents/*.meta.json` and `.jsonl` files.

Sessions the host is not running are read from Claude's transcripts, so clients can browse and read them without starting a process. The agent starts when a turn is sent.

## Credentials

Sessions use whatever the Claude CLI is signed in with. A client can push a token instead. Pushed tokens are held per connection and are not used for other clients' sessions.

## Documentation

| | |
| --- | --- |
| [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/PLUGINS.md) | Loading a plugin into the daemon |
| [AGENT.md](https://github.com/softov/ahpd/blob/main/docs/AGENT.md) | The `Agent` and `Session` contracts this implements |
| [AHP.md](https://github.com/softov/ahpd/blob/main/docs/AHP.md) | Which actions are served, which are refused, and why |

## License

MIT © Softov

