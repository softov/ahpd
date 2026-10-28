# @ahpd/agent-claude

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fagent-claude)](https://www.npmjs.com/package/@ahpd/agent-claude)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

Claude Code as a backend for [`@ahpd/sdk`](https://www.npmjs.com/package/@ahpd/sdk), and the plugin that lets the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon run it.

The plugin registers the engine `claude`: every Claude Code agent is a record on the agents channel, `x-ahpd-agents`, and one load serves all of them. A record's id is the provider a client names, and its `config` holds what that one agent runs on.

Part of [ahpd](https://github.com/softov/ahpd). The source is in [`packages/agent-claude`](https://github.com/softov/ahpd/tree/main/packages/agent-claude).

## Install

```bash
ahpd plugin install @ahpd/agent-claude
ahpd restart
```

Update, remove and one-run flags such as `--plugin` are in [Plugins](https://github.com/softov/ahpd/blob/main/docs/server/PLUGINS.md).

### What it needs

- Claude Code signed in on this host, with `claude login`, or `ANTHROPIC_API_KEY` in the daemon's environment.

## Options

```json
{
  "plugins": [
    { "name": "@ahpd/agent-claude", "options": { "paths": ["/work/project"] } }
  ]
}
```

The ordinary install takes no options: it catalogues whatever directories the daemon was started on. `paths` is the one option a person sets most often, because it narrows the catalogue the daemon serves. Everything else has a default that fits most installs. The daemon loads the change on its next restart.

Every option below is a key under `options` in the plugin's entry, and the daemon checks each value against the schema before `apply` runs. These are the plugin's answers for every agent it serves, not any one agent's: what one agent runs on is its record's `config`, below. `provider`, `displayName` and `name` are not options at all - a record's id is the provider and its `name` is what a client draws.

| Option | Default | What it does |
| --- | --- | --- |
| `paths` | the host's directories | The directories it catalogues, and where a session goes by default |
| `computerExecutable` | `claude` | Where the CLI is *inside a machine* |
| `computerCli` | `part` | Where the CLI a machine runs comes from |
| `computerCliFallback` | `refuse` | With `computerCli: "part"`, what a machine gets when the `claude` part cannot be built |
| `computerConfigDir` | `/ahpd/<id>`, or `/ahpd/claude` for the first record | The configuration directory the CLI reads *inside a machine*; `false` leaves the image's own |
| `workerStop` | `worker` | What a stop given in a subagent's chat stops |
| `handshakeTimeoutMs` | `120000` | How long the CLI has to answer its handshake before its session treats it as a CLI that died |

`computerCli` is `part`, the `claude` part this host builds at its pinned version, or `host`, which mounts this host's own installed CLI. `computerCliFallback` is `refuse`, which refuses a Claude session in a machine and names the part, or `host`, which mounts this host's own CLI instead and logs that it did. `workerStop` is `worker`, which stops that subagent and lets the turn that started it go on, or `session`, which cancels that turn instead. `handshakeTimeoutMs` is how long a CLI has to take the control request that says it is up: a cold start with several MCP servers is slow, and a machine slower than that is what the option is for. A CLI that misses the bound is treated as one that died, so the turn fails with that reason and the query is closed.

### A record of the engine

An agent is a record on `x-ahpd-agents`: `{ id, engine, owner, name, description?, icon?, model?, config }`. The channel owns `name`, `description`, `icon` and `model` on every engine, so this plugin declares only the fields below, and a new record starts from the engine's one template - Claude Code with nothing set - so an empty `config` is the ordinary agent.

| Field | Default | What it does |
| --- | --- | --- |
| `models` | the CLI's own list | The models that agent offers in the picker, each an `{ "id", "name" }` |
| `modelSources` | none | Endpoints whose model lists that agent also offers, each `{ "fetch", "match", "key" }` |
| `keepCliModels` | `false` | With either list, add them to the CLI's list rather than replace it |
| `sandbox` | `default` | The CLI's own sandbox for shell commands: `default` leaves it to the settings files, `on` and `off` set it |
| `thinking` | `adaptive` | Extended thinking: `adaptive` lets the agent decide when to think, `disabled` is none |
| `outputStyle` | none | The name of a style from the CLI's own settings |
| `env` | none | Variables for the CLI's process, laid over the daemon's own environment on this host, and the whole of it in a machine |
| `extraArgs` | none | Arguments the CLI is started with beyond the ones this backend builds. **Host records only** |
| `hostTasks` | `true` | Whether Claude leaves its own task tools to the host's `task_add`. Off keeps them, and their calls write the session's plan |
| `enableTasks` | `true` | Start the CLI with `CLAUDE_CODE_ENABLE_TASKS=1` whenever Claude keeps its own task tools |

`extraArgs` is host-only: a team's or a person's record that sets one is refused, because an argument is where a command would come from. `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` in `env` are the engine's key variables, so any owner may set them; every other `env` variable is the host's alone, because a free environment can run a program.

A `models` entry is `{ "id": "<model>", "name": "<label>" }`, and `name` may be left out, in which case the picker shows the id. A `modelSources` entry is `{ "fetch": "<url>", "match": "<pattern>", "key": "..." }`, which reads an OpenAI-shaped model list and keeps the ids the pattern covers, where `*` is any run of characters. The written models come first and each source's after them, each id once. `key` is the bearer token sent with the fetch. A key written as text moves to the vault when the record is saved, and a client sees `<set>` in its place. Send it empty to keep it; an entry that changed needs its key again. A host record or a preset may set `key` to `{ "fromEnv": "NAME" }` instead. A fetch that fails is logged, with no key in the line, and offers nothing. A record written before the two lists held one shape is split into them at the next start.

A record's `env` value is a string, `null` to unset the variable, `{ "fromEnv": "NAME" }` for the daemon's own `NAME`, or `{ "$secret": "host:<name>" }` for a credential kept in the vault. A `fromEnv` variable that is not there when the record opens is left unset.

`ahpd vault set host:<name>` keeps the credential a record's `env` reads with `{ "$secret": "host:<name>" }`, from standard input. See [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/plugins/PLUGINS.md#marking-a-credential) for what a credential is.

An `extraArgs` value is given by name without the `--`, and `null` for a flag that takes none. A value that is not a string reaches the CLI as its JSON text, so `"settings": { "permissions": { "allow": ["Read"] } }` is started as `--settings '{"permissions":{"allow":["Read"]}}'`.

A record is checked against the engine's schema when it is put, and opened again on every start. One whose `config` no longer fits, or whose `$secret` the vault cannot answer, is written and shown as `invalid` with one line saying why and naming no value; a record whose engine no plugin registers any more is kept and shown as `unavailable`.

### Tasks

A Claude session uses the host's task tools by default. When the tasks plugin is loaded and offers `task_add`, the session's own `TodoWrite`, `TaskCreate`, `TaskUpdate`, `TaskList` and `TaskGet` are denied. The model adds its tasks with the host's tool, so every session works one list. A host that offers no `task_add` has nothing to put in their place, and the session keeps its own tools there.

`hostTasks: false` in a record keeps Claude's own tools; so does a host with no tasks plugin loaded. In either case the CLI is started with `CLAUDE_CODE_ENABLE_TASKS=1`, which `enableTasks` does and which is on by default. A value the record's own `env` gives the variable is kept rather than written over. Each `TodoWrite`, `TaskCreate` and `TaskUpdate` is then written into the session's plan, and [The task list](https://github.com/softov/ahpd/blob/main/docs/plugins/TASK-LIST.md) says how.

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

## Records

One agent is one record. A client makes or edits one with `x-ahpd/agents/put`, and the daemon keeps it at `agents/<id>.json` in its configuration folder. The host's Claude Code, with nothing set, is the record below; a second agent is another record from the same engine, and a session picks the agent rather than a set of options of it:

```json
{ "id": "claude", "engine": "claude", "owner": "host", "name": "Claude Code", "config": {} }
```

A record that names its own options and its own endpoint is a second agent on the picker, from the one plugin. The key is a `$secret`, so the record holds a reference and the vault holds the value:

```json
{
  "id": "claude-deepseek-build",
  "engine": "claude",
  "owner": "host",
  "name": "DeepSeek build",
  "config": {
    "thinking": "adaptive",
    "models": [{ "id": "deepseek-chat", "name": "DeepSeek Chat" }],
    "env": {
      "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
      "ANTHROPIC_AUTH_TOKEN": { "$secret": "host:deepseek" }
    }
  }
}
```

A client puts the key's value, and the channel moves it to the vault under `host:agent/<id>/env.ANTHROPIC_AUTH_TOKEN` and keeps a `{ "$secret": "<name>" }` in its place, so no client is shown the value again. The record below names `host:deepseek`, the form a record written by hand on disk uses, which may name any entry of the vault; `ahpd vault set host:deepseek` keeps that entry from standard input. The endpoint a record names is the one it is probed at, and an edit of the record reaches a running session at its next turn.

### Project files, and trust

A session in a folder the host was not told to trust loads none of that folder's own files. Nothing of the project is loaded: no settings, so no hooks, no project `CLAUDE.md`, and no `.mcp.json` beside the project. The person's own files are not a project's and are read either way. Trust is the window's answer, pushed in the root config - see [Trusted folders](https://github.com/softov/ahpd/blob/main/docs/sdk/AUTHENTICATION.md#trusted-folders). A session nobody vouched for is untrusted, which is the same answer a host with no window to ask gives.

### A second Claude on another endpoint

A record with its own name, its own models and an `env` that points the CLI elsewhere is a second agent on the picker, from the one plugin. A host record may name a daemon variable instead of a vault entry, which keeps the key where it already is, and fetch the endpoint's model list rather than writing it out:

```json
{
  "id": "claude-openrouter",
  "engine": "claude",
  "owner": "host",
  "name": "Claude OpenRouter",
  "config": {
    "modelSources": [
      { "fetch": "https://openrouter.ai/api/v1/models", "match": "anthropic/*" }
    ],
    "env": {
      "ANTHROPIC_BASE_URL": "https://openrouter.ai/api",
      "ANTHROPIC_AUTH_TOKEN": { "fromEnv": "OPENROUTER_API_KEY" },
      "ANTHROPIC_API_KEY": ""
    }
  }
}
```

Both agents carry their key in the daemon's environment or in the vault, and the endpoint a record names is the one it is probed at.

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

A `Bash` result too large to send shows its whole output in a terminal, as VS Code does. Claude gives the model a notice in place of such an output and saves the output to a file, which the result's `tool_use_result.persistedOutputPath` names. The call keeps the notice as its text, the host keeps the file's text for the call's chat through `Start.terminalOutputs`, and the call's content names the terminal the host rebuilds from it: exited, `isPty: false`, with `exitCode: 0` for a command that worked, Claude's preview and `truncated: true`. It lasts as long as the chat, and goes with its turn, its chat and its session. Claude's transcript holds the notice alone, so a call read back names its terminal again where the host still keeps the output. A file over 10 MB is not read. A subagent's result, a backgrounded command, a session in a machine and a host whose session store keeps no folder get no terminal.

Sessions the host is not running are read from Claude's transcripts, so clients can browse and read them without starting a process. The agent starts when a turn is sent.

A question somebody answered reads back answered, in the session and in a subagent's chat. The CLI writes the answers as the `toolUseResult` of the transcript entry that holds the question's result. The SDK's `getSessionMessages` leaves that field out, so a session's own file is read for it, one line at a time.

## The agent a message picks

A client sends the agent on every message, as `message.agent`, and the turn runs on it. A message naming none runs on the SDK's default agent.

A uri becomes the name the SDK is given: an agent's own file, `file://…/agents/reviewer.md`, gives its frontmatter `name`, or the file's own name when it has none or has been deleted since the listing was made; a built-in agent's `claude-internal:/agent/Explore` gives its last segment; any other uri names no agent, rather than naming one the CLI does not have.

The SDK reads the agent when its query is built and has no way to change it on a CLI already running, so a message picking a different agent closes the query and starts another resumed into the same conversation, before that turn's prompt goes out. The send that switches pays a restart; a client that sends the same agent on every message, which is the usual case, pays nothing.

A session is not tied to an agent: nothing is stored per session, because the next message carries the pick again.

## Credentials

Sessions use whatever the Claude CLI is signed in with. A client can push a token instead. Pushed tokens are held per connection and are not used for other clients' sessions.

### In a machine

A session in a machine runs the CLI from the `claude` part at its pinned version, not this host's: `computerCli: "host"` mounts this host's binary instead, and `computerCliFallback: "host"` mounts it only when the part cannot be built. Its configuration is a state volume at `/ahpd/<id>`, seeded from this host's settings, instructions, skills, agents, commands and the MCP servers of `~/.claude.json`, never the sign-in. A profile with `state: "host"` mounts this host's `~/.claude` instead, sign-in included.

The CLI there runs with the record's own `env`, a pushed token and `CLAUDE_CONFIG_DIR`, and nothing of the daemon's environment: the daemon's `ANTHROPIC_*` and `CLAUDE_CODE_OAUTH_TOKEN` cross only when the record names them with `{ "fromEnv" }`. So a record signs in with `CLAUDE_CODE_OAUTH_TOKEN`, from `claude setup-token`, or `ANTHROPIC_API_KEY` in its `env`, and a machine that used to share this host's sign-in needs one of those or a sign-in made once inside it. See [Claude Code in a machine](https://github.com/softov/ahpd/blob/main/docs/plugins/COMPUTERS.md#claude-code-in-a-machine).

## Documentation

| | |
| --- | --- |
| [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/plugins/PLUGINS.md) | Loading a plugin into the daemon |
| [AGENT.md](https://github.com/softov/ahpd/blob/main/docs/sdk/AGENT.md) | The `Agent` and `Session` contracts this implements |
| [AHP.md](https://github.com/softov/ahpd/blob/main/docs/sdk/AHP.md) | Which actions are served, which are refused, and why |

## License

MIT © Softov
