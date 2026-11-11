# @ahpd/agent-acp

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fagent-acp)](https://www.npmjs.com/package/@ahpd/agent-acp)
[![CI](https://github.com/ahpio/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/ahpio/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

An [Agent Client Protocol](https://agentclientprotocol.com) backend for [`@ahpd/sdk`](https://www.npmjs.com/package/@ahpd/sdk), and a plugin for the [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server) daemon.

The plugin registers the engine `acp`: every ACP server is a record on the agents channel, `x-ahpd-agents`, and one load serves all of them. A record's id is the provider a client names, and its `config` holds the program and what that one agent runs on.

Any program that speaks ACP over its stdio is one record, not a package of its own, so `copilot --acp`, `codex-acp`, `gemini --acp` and `@deepseek-ai/dsh-acp` all run through this one package.

Part of [ahpd](https://github.com/ahpio/ahpd). The source is in [`packages/agent-acp`](https://github.com/ahpio/ahpd/tree/main/packages/agent-acp).

## Install

```bash
ahpd plugin install @ahpd/agent-acp
ahpd restart
```

Update, remove and one-run flags such as `--plugin` are in [Plugins](https://github.com/ahpio/ahpd/blob/main/docs/server/PLUGINS.md).

### What it needs

- Each agent's own command on the daemon's `PATH`. A command that is missing fails that provider's turns with a message and leaves the daemon running.
- `codex-acp` for `codex`. The `codex` CLI has no ACP mode of its own; `codex-acp` comes from `npm i -g @agentclientprotocol/codex-acp`.
- `cursor-agent` for `cursor`, which runs `cursor-agent acp`, the name Cursor's installer puts on the host and its part ships.

## Options

The plugin's own options are its answers for every agent it serves:

```json
{
  "plugins": [
    {
      "name": "@ahpd/agent-acp",
      "options": { "hostTools": true, "toolsChanged": "notify" }
    }
  ]
}
```

`{ "plugins": ["@ahpd/agent-acp"] }` is enough when the defaults suit. Every option below is a key under `options` in the plugin's entry, and the daemon checks each value against the schema before `apply` runs. What one agent runs on is its record's `config`, below, and a record wins over the plugin for what it sets.

| Option | Default | What it does |
| --- | --- | --- |
| `hostTools` | `true` | Offer the host's own tools to each session as an MCP server. A record may set its own |
| `toolsChanged` | `notify` | How a session's agent hears that the tools it listed have moved: `notify` sends `notifications/tools/list_changed` down a stream the host holds open, `list` sends nothing. A record may set its own |

### A record of the engine

An agent is a record on `x-ahpd-agents`: `{ id, engine, owner, name, description?, icon?, model?, config }`. The channel owns `name`, `description`, `icon` and `model` on every engine, so a record of this engine declares only the fields below, and a new record starts from one of the engine's templates - one per shipped row, carrying that row's command, arguments, sign-in, trust, machine and key variables set empty.

The shipped rows are `codex`, `gemini`, `copilot`, `opencode`, `kilo`, `goose`, `pi`, `dsh`, `devin`, `cursor`, `amp`, `qwen`, `cline` and `omp`. A record whose id names one of them takes that row's values, and wins over the row wherever it writes its own; a record that names none writes a `command` of its own, so a server nobody has heard of is an agent like any other.

| Field | Default | What it does |
| --- | --- | --- |
| `base` | the row the id names | The shipped row this record takes, for a record id that is not itself one. **Host records only** |
| `command` | the row's | The program to spawn as the ACP server. Required for a record that names no row and no `base`. **Host records only** |
| `args` | the row's | The arguments to give it, replacing the row's own. **Host records only** |
| `env` | none | Environment variables merged over the daemon's own for the child, by variable name. A value written `{ "$secret": "host:<name>" }` is read from the vault |
| `cwd` | the session's working directory, else a scratch folder of the session's own | The directory the server runs in. **Host records only** |
| `authenticate` | the row's | `{ "methodId": "<id>" }`, the sign-in to send after the handshake, for a server that refuses a session until one has happened |
| `hostTools` | the plugin-wide `hostTools` | Whether this agent's sessions are offered the host's own tools |
| `honoursTrust` | the row's, else `false` | Whether this agent asks before it loads a project's own settings and hooks. Absent, a session in a folder the host did not vouch for is refused, because ACP carries no trust field |
| `toolsChanged` | the plugin-wide `toolsChanged` | How this agent hears that the tools it listed have moved |
| `cutTurns` | `error` | How a turn the server stopped at `max_tokens`, `max_turn_requests` or by a refusal ends: `error` ends it in `chat/error` typed by the reason, `complete` completes it, as VS Code's agents do |
| `modes` | `refreshed` | Where this agent's modes come from: `refreshed` lists the row's until a session hears its server's, then the modes the last session's server named; `preset` keeps the row's as declared, as VS Code's agents do |
| `unreportedClientCalls` | `row` | What a request for a client's tool that no reported call matched gets: `row` holds it in a row of its own and asks its owner, `error` answers it with an error result, as VS Code's client tool server does |
| `findFreshMs` | `2000` | How long, in milliseconds, the listing a find made answers the finds after it, a failed one included, so a server that did not start is not spawned again for each id; `0` joins only the listing in flight, as VS Code's agents share a listing |
| `listingIdleMs` | `0` | How long, in milliseconds, the server a listing spawned stays after its last read; `0` closes it once the read is done, as VS Code's Codex closes the connection it opens for an action |
| `sessionListMaxPages` | `50` | How many pages of `session/list` one listing reads at most, as VS Code's Codex stops its own paged listing |
| `exitGraceMs` | `1000` | How long, in milliseconds, a call that failed because the server closed its stream waits for the exit code that says why |
| `stderrBytes` | `8192` | How much of the server's stderr, in bytes, a failure carries, as VS Code keeps the last 8192 of a helper's stderr |
| `killGraceMs` | `5000` | How long, in milliseconds, the server's process group has between SIGTERM and SIGKILL, VS Code's grace for ending a process tree |
| `closeGraceMs` | `1000` | How long, in milliseconds, a session waits for the server to answer `session/close` before the connection goes |
| `stderrTail` | `sentence` | Where the last of a failed server's stderr goes: `sentence` puts it under the failure in the error a client is shown, `log` leaves it to the daemon's log, as VS Code's agents do; each line is logged either way |
| `install` | the row's | How to install this agent, by system, as the vendor's own docs give it. **Host records only** |
| `page` | the row's | The vendor's install page, for a system the install lines do not cover |
| `machine` | the row's | What a machine needs to run this agent, laid over the row's by key. **Host records only** |

`base`, `command`, `args`, `cwd`, `machine` and `install` are host-only: a team's or a person's record that sets one is refused, because a command is where a program would come from. The engine's key variables are the vendors' own - `AMP_API_KEY`, `CLINE_API_KEY`, `CODEX_API_KEY`, `COPILOT_GITHUB_TOKEN`, `CURSOR_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOSE_PROVIDER__API_KEY`, `KILO_API_KEY`, `OMP_AUTH_BROKER_TOKEN`, `OPENAI_API_KEY` and `WINDSURF_API_KEY` - so any owner may set them in `env`; every other `env` variable is the host's alone, because a free environment can run a program.

A record whose `command` is missing, whose `base` names no shipped row, or whose `$secret` the vault cannot answer is written and shown as `invalid` with one line naming it, and no value. A record whose engine no plugin registers any more is kept and shown as `unavailable`.

### `machine`

| Field | Default | What it does |
| --- | --- | --- |
| `env` | the row's | Variables set only inside the machine: a string, `{ "fromEnv": "NAME" }` read when the record opens, or `{ "$secret": "<scope>:<name>" }` read when the machine is made. Laid over the row's by variable |
| `copy` | none | Host paths copied into the machine, each `{ "source", "target" }`, with `target` an absolute path |
| `part` | the row's | The part the CLI comes from |
| `state` | `/ahpd/<id>` for a record from a shipped row | The absolute directory the agent keeps its configuration in, as a state volume |
| `seed` | the agent's own host files | The host files `state` is seeded from, each `{ "source", "target", "keep", "drop" }` |

Each shipped row that names a part brings a `machine`. It holds the CLI's part and a state directory at `/ahpd/<id>`, seeded from the agent's own host files and never its login file. It also holds the variables that point the CLI there. So a record made from one runs from its part on any glibc image, and signs in with the key a person adds in `machine.env`. A vault-filled key reaches only this agent's commands in the machine. `cline` and `omp` came with a row, a command and arguments but no part, so their templates carry no `machine`. See [ACP agents in a machine](https://github.com/ahpio/ahpd/blob/main/docs/plugins/COMPUTERS.md#acp-agents-in-a-machine).

A row whose sign-in depends on a variable sends it only when the daemon's own environment or the record's `env` has the variable, and for a session placed in a machine also when the record's `machine.env` sets it.

`ahpd vault set host:<name>` keeps the credential a record's `env` reads with `{ "$secret": "host:<name>" }`, from standard input. See [PLUGINS.md](https://github.com/ahpio/ahpd/blob/main/docs/plugins/PLUGINS.md#naming-a-secret-instead-of-holding-one) for a `$secret`.

### A record, written out

A record that names its own program:

```json
{
  "id": "my-agent",
  "engine": "acp",
  "owner": "host",
  "name": "My agent",
  "config": { "command": "my-agent", "args": ["--acp"] }
}
```

A record made from a shipped row is shorter still, because the row already names the command, the arguments and the sign-in:

```json
{
  "id": "gemini",
  "engine": "acp",
  "owner": "host",
  "name": "Gemini",
  "config": { "env": { "GEMINI_API_KEY": { "$secret": "host:gemini" } } }
}
```

A client puts the key's value, and the channel moves it to the vault under `host:agent/<id>/env.GEMINI_API_KEY` and keeps a `{ "$secret": "<name>" }` in its place, so no client is shown the value again. The record above names `host:gemini`, the form a record written by hand on disk uses.

A client makes either with `x-ahpd/agents/put`, and the daemon keeps it at `agents/<id>.json` in its configuration folder.

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

It spawns the command, completes the ACP handshake over its stdio, and opens one session before the session is answered, so the first state a client reads carries the server's modes, options and models, as VS Code seeds a session's config before its first snapshot. It then turns each `session/update` into the `chat/*` action a client already knows. A turn ends as the server's own stop reason says: `chat/turnComplete` for `end_turn`, `chat/turnCancelled` for `cancelled`, and `chat/error` typed by the reason for `max_tokens`, `max_turn_requests` and `refusal`, which are a turn that stopped early, AHP having no field that says a completed turn was cut short. A prompt that fails is `chat/error` typed `sendFailed` with the failure's own words and the last of what the server wrote on stderr. `cancel` reaches the server as its notification, after everything it was still waiting on has been answered: `cancelled` for a permission, and `cancel` for a question, because nobody said no to one that stopped being asked.

The server's session config options are the session's. The values of its model option are the models a client is offered, said again where the server moves them, and the values of its mode option are the session's `availableApprovalModes`. Every other option is a control of the session's under `<provider>.<id>`, offering the values the server gave as the session opened, and a value the server moves is said with `session/configChanged`. A `thought_level` option holds the reasoning level of the model the server runs on, so each model a session has run on is listed with those levels as its `thinkingLevel`, in the property VS Code's Codex agent gives a model's effort, and the agent keeps them for its later sessions. A turn whose model selection names one of those levels runs at it, and any other turn runs at the session's own value of the control.

A `plan` update is also written into the session's plan. Each update carries the whole list, and the backend hands the host each entry's `content` as its text with its `status` and `priority`. So a `codex-acp` session fills the host task list the tasks plugin keeps - see [The task list](https://github.com/ahpio/ahpd/blob/main/docs/plugins/TASK-LIST.md). A plan update is no tool call the agent made, so the bridge draws no row of the chat for it, as VS Code draws nothing for a plan notification that is no tool call.

The host's own tools, and with them the tools a session's clients provide, are offered to the agent as one HTTP MCP server named `host`, the name VS Code gives the server carrying its host's tools, where `hostTools` is on, which it is by default. A call the agent makes to a client's tool is reported against the client that provides it, named by the tool as the client announced it, `openFile` where the agent called `mcp__host__<clientId>__openFile`, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L626-L638) names a client's call. It waits for that client's answer, which reaches the agent as the tool result with everything the client sent, images and resources included. A client that arrives after the agent listed its tools is heard of as `toolsChanged` says: under `notify`, the default, the host holds a stream open and sends `notifications/tools/list_changed` down it, and under `list` nothing is sent. Both serve the current list either way, so an agent that ignores the notification and never lists again is one that misses every tool a client announced after it looked.

A session this process never watched is loaded when a client reads it, where the server advertised `loadSession`; the read and the turn after it each load it, and what the server replays becomes the session's earlier turns. A replayed turn the server sent no user message for is kept, with no user text on it.

When the server supplies a nonblank `messageId` on `agent_message_chunk`, the first such id in a prompted turn is reported once through `Start.onTurnRecorded`. Replay selects the same first assistant id, and the SDK's recorded-id transcript mode restores the caller's AHP turn id from its existing per-chat session records. Later chunks, tool calls and later assistant messages do not replace that anchor. This requires the server to retain the id across loads and the host to keep its session records; no content hash or turn-position matching is used. A turn with no usable assistant id keeps the existing process-local replay id and no cross-restart identity guarantee. Such unmatched turns stay separate, including in histories that also contain recorded turns.

A `session/request_permission` is a question the host decides, saying what the call asks to do by its ACP kind, its first location and its input, and offering none of the server's options save a mode switch's buttons. The server is answered once, its `allow_once` or `reject_once`, whatever the host keeps of the answer, and a mode switch's button the person picked as itself. A call the host refuses without asking anybody is ended by the failure the server reports for it.

An `elicitation/create` is a question, and it is asked on the chat as a `chat/inputRequested` with one question per field of its form, and the `session/inputNeededSet` entry a permission raises. The person's answer arrives as `chat/inputCompleted` and reaches the server as the elicitation's content, and the kind the client sent reaches it as itself: a decline as a decline and a cancel as a cancel. A page rather than a form carries its `url` on the request and is completed by the server saying so with `elicitation/complete`.

## Documentation

| | |
| --- | --- |
| [PLUGINS.md](https://github.com/ahpio/ahpd/blob/main/docs/plugins/PLUGINS.md) | The ACP options in the daemon, and what the server may ask the host for |
| [AGENT.md](https://github.com/ahpio/ahpd/blob/main/docs/sdk/AGENT.md) | The `Agent` and `Session` contracts this implements |
| [AHP.md](https://github.com/ahpio/ahpd/blob/main/docs/sdk/AHP.md) | Which actions are served, which are refused, and why |

## License

MIT © Softov
