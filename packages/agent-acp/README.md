# @ahpd/agent-acp

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fagent-acp)](https://www.npmjs.com/package/@ahpd/agent-acp)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

An [Agent Client Protocol](https://agentclientprotocol.com) backend for [`@ahpd/sdk`](https://www.npmjs.com/package/@ahpd/sdk), and a plugin for the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon.

Any program that speaks ACP over its stdio is one configured command, not a package of its own, so `copilot --acp`, `codex-acp`, `gemini --acp` and `@deepseek-ai/dsh-acp` all run through this one package.

Part of [ahpd](https://github.com/softov/ahpd). The source is in [`packages/agent-acp`](https://github.com/softov/ahpd/tree/main/packages/agent-acp).

## In the daemon

```bash
ahpd plugin install @ahpd/agent-acp
```

Then add one entry to `plugins` in the daemon's `config.json`, and one key per ACP server under its `presets`:

```json
{
  "plugins": [
    {
      "name": "@ahpd/agent-acp",
      "options": {
        "presets": {
          "copilot": {},
          "codex": {},
          "my-agent": { "name": "My agent", "command": "my-agent", "args": ["--acp"], "env": { "MY_AGENT_KEY": { "$secret": "host:my-agent" } } }
        },
        "hostTools": true,
        "toolsChanged": "notify"
      }
    }
  ]
}
```

Each key registers an agent of its own, under that key as the provider id, so `copilot`, `codex` and `my-agent` are three entries in the picker out of one load.

The shipped presets are `codex`, `gemini`, `copilot`, `opencode`, `kilo`, `goose`, `pi`, `dsh`, `devin`, `cursor`, `amp` and `qwen`. A key that names none of them writes a `command` of its own, and a key that names one takes its command, its arguments and its environment. The command has to be on the daemon's `PATH`. The `codex` CLI has no ACP mode of its own; `codex-acp` comes from `npm i -g @agentclientprotocol/codex-acp`. `cursor` runs `cursor-agent acp`, the name Cursor's installer puts on the host and its part ships. A command that is missing fails that provider's turns with a message and leaves the daemon running.

## Options

Every option below is a key under `options` in the plugin's entry, and the daemon checks each value against the schema before `apply` runs.

| Option | Default | What it does |
| --- | --- | --- |
| `presets` | required | The agents this load registers, by the id clients name. A key that names a shipped preset takes it; a key that names none writes a `command` of its own |
| `hostTools` | `true` | Offer the host's own tools to each session as an MCP server. A preset may set its own |
| `toolsChanged` | `notify` | How a session's agent hears that the tools it listed have moved: `notify` sends `notifications/tools/list_changed` down a stream the host holds open, `list` sends nothing. A preset may set its own |

### `presets.<id>`

| Option | Default | What it does |
| --- | --- | --- |
| `base` | the key, when it names a shipped preset | The shipped preset this one takes, for a key that is not itself one |
| `name` | the shipped preset's name, then the key | What a client reads instead of the id |
| `command` | the shipped preset's | The program to spawn as the ACP server. Required for a key that names no shipped preset and no `base` |
| `args` | the shipped preset's | The arguments to give it, replacing the preset's own |
| `env` | none | Environment variables merged over the daemon's own for the child, by variable name. A value written `{ "$secret": "host:<name>" }` is read from the vault when the daemon loads |
| `cwd` | the session's working directory | The directory the server runs in |
| `description` | none | One line about what this agent is |
| `model` | the server's own | The model a session that names none runs on |
| `authenticate` | none | `{ "methodId": "<id>" }`, the sign-in to send after the handshake, for a server that refuses a session until one has happened |
| `hostTools` | the plugin-wide `hostTools` | Whether this agent's sessions are offered the host's own tools |
| `honoursTrust` | the shipped preset's, else `false` | Whether this agent asks before it loads a project's own settings and hooks. Absent, a session in a folder the host did not vouch for is refused, because ACP carries no trust field |
| `toolsChanged` | the plugin-wide `toolsChanged` | How this agent hears that the tools it listed have moved |
| `machine` | the shipped preset's | What a machine needs to run this agent, laid over the shipped preset's by key |

### `presets.<id>.machine`

| Option | Default | What it does |
| --- | --- | --- |
| `env` | the shipped preset's | Variables set only inside the machine: a string, `{ "fromEnv": "NAME" }` read when the daemon loads, or `{ "$secret": "<scope>:<name>" }` read when the machine is made. Laid over the preset's by variable |
| `copy` | none | Host paths copied into the machine, each `{ "source", "target" }`, with `target` an absolute path |
| `part` | the shipped preset's | The part the CLI comes from |
| `state` | `/ahpd/<id>` for a shipped preset | The absolute directory the agent keeps its configuration in, as a state volume |
| `seed` | the agent's own host files | The host files `state` is seeded from, each `{ "source", "target", "keep", "drop" }` |

Every shipped preset brings a `machine`: its CLI's part, a state directory at `/ahpd/<id>` seeded from the agent's own host files and never its login file, and the variables that point the CLI there. So a preset in a machine runs from its part on any glibc image, and signs in with the key a person adds in `machine.env`. A vault-filled key reaches only this agent's commands in the machine. See [ACP agents in a machine](https://github.com/softov/ahpd/blob/main/docs/COMPUTER.md#acp-agents-in-a-machine).

A per-agent option written at the top level fails the load and says where it goes now. A preset that cannot be resolved is skipped with one line naming it, and the rest register: a `base` naming no shipped preset, no `command` where one is needed, an `authenticate` with no `methodId`, a `$secret` the vault does not hold, or a `machine` that is wrongly written or reads a variable the daemon does not have. A row whose sign-in depends on a variable sends it only when the daemon's own environment or that preset's `env` has the variable, and for a session placed in a machine also when the preset's `machine.env` sets it.

## Commands

| Command | What it does |
| --- | --- |
| `ahpd plugin install @ahpd/agent-acp` | Install the package into the configuration directory and name it in `config.json` |
| `ahpd plugin update @ahpd/agent-acp` | Move it to the version that matches the daemon; `all` in place of the name moves every installed plugin |
| `ahpd plugin list` | What the configuration names, and what a run would load, without loading it |
| `ahpd vault set host:<name>` | Keep the credential a preset's `env` reads with `{ "$secret": "host:<name>" }`, from standard input |

See [DAEMON.md](https://github.com/softov/ahpd/blob/main/docs/DAEMON.md#--plugin-and-what-naming-one-runs) for what naming a plugin runs, and [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/PLUGINS.md#naming-a-secret-instead-of-holding-one) for a `$secret`.

## In your own host

```bash
pnpm add @ahpd/agent-acp @ahpd/sdk
```

```ts
import { createHost, listen } from '@ahpd/sdk';
import { acpAgent } from '@ahpd/agent-acp';

const path = process.cwd();
const host = createHost({
  path,
  agents: [
    acpAgent({ provider: 'copilot', displayName: 'Copilot', command: 'copilot', args: ['--acp'] }),
  ],
});
await listen({ port: 9187 }, (peer) => host.accept(peer));
```

`createHost` takes a list of agents, so several ACP servers run beside each other and beside any other backend.

## What it does

It spawns the command, completes the ACP handshake over its stdio, opens one session, and turns each `session/update` into the `chat/*` action a client already knows. A turn ends as the server's own stop reason says: `chat/turnComplete` for `end_turn`, `chat/turnCancelled` for `cancelled`, and `chat/error` carrying the reason for `max_tokens`, `max_turn_requests` and `refusal`, which are a turn that stopped early rather than an answer. `cancel` reaches the server as its notification, after every permission it was still waiting on has been answered `cancelled`.

The host's own tools, and with them the tools a session's clients provide, are offered to the agent as one HTTP MCP server named `ahp`, where `hostTools` is on, which it is by default. A call the agent makes to a client's tool is reported against the client that provides it and waits for that client's answer, which reaches the agent as the tool result with everything the client sent, images and resources included. A client that arrives after the agent listed its tools is heard of as `toolsChanged` says: under `notify`, the default, the host holds a stream open and sends `notifications/tools/list_changed` down it, and under `list` nothing is sent. Both serve the current list either way, so an agent that ignores the notification and never lists again is one that misses every tool a client announced after it looked.

A session this process never watched is loaded when a client reads it, where the server advertised `loadSession`; the read and the turn after it each load it, and what the server replays becomes the session's earlier turns. A replayed turn the server sent no user message for is kept, with no user text on it.

A `session/request_permission` is a confirmation offering the server's own options, approvals first, and the one the person picks is the `optionId` the server receives. An answer that picked none selects the server's once option of that kind, never an `always`.

## Documentation

| | |
| --- | --- |
| [PLUGINS.md](https://github.com/softov/ahpd/blob/main/docs/PLUGINS.md) | The ACP options in the daemon, and what the server may ask the host for |
| [AGENT.md](https://github.com/softov/ahpd/blob/main/docs/AGENT.md) | The `Agent` and `Session` contracts this implements |
| [AHP.md](https://github.com/softov/ahpd/blob/main/docs/AHP.md) | Which actions are served, which are refused, and why |

## License

MIT © Softov
