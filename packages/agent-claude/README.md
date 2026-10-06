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

It takes no options in the ordinary install: it catalogues whatever directories the daemon was started on. A configuration may narrow that:

| option | |
| --- | --- |
| `paths` | the directories it catalogues, and where a session goes by default. Defaults to the host's |
| `computerExecutable` | where the CLI is *inside a machine*. `claude` on the image's PATH by default |
| `computerCli` | where the CLI a machine runs comes from. `part` by default, the `claude` part this host builds at its pinned version; `host` mounts this host's own installed CLI |
| `computerCliFallback` | with `computerCli: "part"`, what a machine gets when the `claude` part cannot be built. `refuse` by default, which refuses a Claude session there naming the part; `host` mounts this host's own CLI instead and logs that it did |
| `computerConfigDir` | the configuration directory the CLI reads *inside a machine*. `/ahpd/<variant>` by default, `/ahpd/claude` for the built-in; `false` leaves the image's own |
| `workerStop` | what a stop given in a subagent's chat stops. `worker` by default, which stops that subagent and lets the turn that started it go on; `session` cancels that turn instead |
| `presets` | the variants of this package, by the id clients name. Each key registers an agent of its own, with its own name, models and options |

The package is loaded once. Its variants are written under `presets`, and each one is a harness in the picker of its own.

### Presets

The built-in `claude` is Claude Code as it runs here, named `Claude Code`, and it is registered whether or not it is written. An object under its key is laid over it, and `false` drops it:

```json
{
  "plugins": [
    { "name": "@ahpd/agent-claude", "options": {
      "presets": {
        "claude": { "thinking": "adaptive", "sandbox": "on" },
        "read-only": { "name": "Claude, read only", "thinking": "disabled", "sandbox": "on", "outputStyle": "concise" }
      }
    } }
  ]
}
```

Two presets, two entries in the picker, and a session picks the agent rather than a preset of it. Every key is the id clients name for that agent, and a preset that names none of its own is called by its key.

A preset holds eight fields, and each is checked when the plugin loads. A preset that is wrongly written, whose `fromEnv` variable is not in the daemon's environment or whose `$secret` cannot be read is not registered: it is skipped with one line naming it, which is stamped to the daemon's log and printed by `ahpd start` and `ahpd restart` as `skipped: <plugin>: <the preset and why>`, above the line that says the daemon is up. The other presets register as they were written. The load is refused only when no preset is left to register an agent for.

| field | |
| --- | --- |
| `name` | what a client reads instead of the id. Defaults to the preset's key |
| `models` | the models that agent offers in the picker, in place of the CLI's: a model id, `{ "id", "name" }`, or `{ "fetch": "<url>", "match": "<pattern>", "key": { "fromEnv": "NAME" } }`, which reads an OpenAI-shaped model list and keeps the ids the pattern covers (`*` is any run of characters). A fetch that fails is logged and offers nothing |
| `keepCliModels` | with `models`, add them to the CLI's list rather than replace it |
| `sandbox` | the CLI's own sandbox for shell commands: `default` leaves it to the settings files, `on` and `off` set it |
| `thinking` | extended thinking: `adaptive` lets the agent decide when to think, `disabled` is none |
| `outputStyle` | the name of a style from the CLI's own settings |
| `env` | variables for the CLI's process, laid over the daemon's own environment on this host, and the whole of it in a machine. A value is a string, `null` to unset the variable, `{ "fromEnv": "NAME" }` for the daemon's own `NAME`, or `{ "$secret": "host:<name>" }` for a credential kept in the vault. A variable that is not there when the plugin loads skips the preset that names it |
| `extraArgs` | arguments the CLI is started with beyond the ones this backend builds, by name without the `--`, and `null` for a flag that takes none. A value that is not a string reaches the CLI as its JSON text, so `"settings": { "permissions": { "allow": ["Read"] } }` is started as `--settings '{"permissions":{"allow":["Read"]}}'` |

With nothing written the built-in runs on what this backend has always run on, which is `thinking: "adaptive"` and no sandbox layer.

### A second Claude on another endpoint

A preset with its own name, its own models and an `env` that points the CLI elsewhere is a second agent on the picker, from the one entry:

```json
{
  "plugins": [
    { "name": "@ahpd/agent-claude", "options": {
      "presets": {
        "claude-openrouter": {
          "name": "Claude OpenRouter",
          "models": [
            "stealth/space-bunny-alpha",
            { "fetch": "https://openrouter.ai/api/v1/models", "match": "anthropic/*" }
          ],
          "env": {
            "ANTHROPIC_BASE_URL": "https://openrouter.ai/api",
            "ANTHROPIC_AUTH_TOKEN": { "fromEnv": "OPENROUTER_API_KEY" },
            "ANTHROPIC_API_KEY": "",
            "ANTHROPIC_MODEL": "stealth/space-bunny-alpha",
            "ANTHROPIC_SMALL_FAST_MODEL": "stealth/space-bunny-alpha"
          }
        }
      }
    } }
  ]
}
```

Both agents carry their key in the daemon's environment, and the endpoint a preset names is the one it is probed at.

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

## The agent a message picks

A client sends the agent on every message, as `message.agent`, and the turn runs on it. A message naming none runs on the SDK's default agent.

A uri becomes the name the SDK is given: an agent's own file, `file://…/agents/reviewer.md`, gives its frontmatter `name`, or the file's own name when it has none or has been deleted since the listing was made; a built-in agent's `claude-internal:/agent/Explore` gives its last segment; any other uri names no agent, rather than naming one the CLI does not have.

The SDK reads the agent when its query is built and has no way to change it on a CLI already running, so a message picking a different agent closes the query and starts another resumed into the same conversation, before that turn's prompt goes out. The send that switches pays a restart; a client that sends the same agent on every message, which is the usual case, pays nothing.

A session is not tied to an agent: nothing is stored per session, because the next message carries the pick again.

## Credentials

Sessions use whatever the Claude CLI is signed in with. A client can push a token instead. Pushed tokens are held per connection and are not used for other clients' sessions.

### In a machine

A session in a machine runs the CLI from the `claude` part at its pinned version, not this host's: `computerCli: "host"` mounts this host's binary instead, and `computerCliFallback: "host"` mounts it only when the part cannot be built. Its configuration is a state volume at `/ahpd/<variant>`, seeded from this host's settings, instructions, skills, agents, commands and the MCP servers of `~/.claude.json`, never the sign-in. A profile with `state: "host"` mounts this host's `~/.claude` instead, sign-in included.

The CLI there runs with the variant's own `env`, a pushed token and `CLAUDE_CONFIG_DIR`, and nothing of the daemon's environment: the daemon's `ANTHROPIC_*` and `CLAUDE_CODE_OAUTH_TOKEN` cross only when the variant names them with `{ "fromEnv" }`. So a variant signs in with `CLAUDE_CODE_OAUTH_TOKEN`, from `claude setup-token`, or `ANTHROPIC_API_KEY` in its `env`, and a machine that used to share this host's sign-in needs one of those or a sign-in made once inside it. See [Claude Code in a machine](https://github.com/softov/ahpd/blob/main/docs/COMPUTER.md#claude-code-in-a-machine).

## Documentation

| | |
| --- | --- |
| [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/PLUGINS.md) | Loading a plugin into the daemon |
| [AGENT.md](https://github.com/softov/ahpd/blob/main/docs/AGENT.md) | The `Agent` and `Session` contracts this implements |
| [AHP.md](https://github.com/softov/ahpd/blob/main/docs/AHP.md) | Which actions are served, which are refused, and why |

## License

MIT © Softov

