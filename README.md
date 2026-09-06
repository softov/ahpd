# ahpd

![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)
![runs on Node, Bun, Deno](https://img.shields.io/badge/runs%20on-Node%20%7C%20Bun%20%7C%20Deno-495057)

An [Agent Host Protocol](https://microsoft.github.io/agent-host-protocol/) server, and the library parts to build a host yourself. It ships with a Claude backend, which is the only one so far.

`ahpd` can be used in two ways:

- **`ahpd`**: a process that serves the [Agent Host Protocol](https://github.com/microsoft/agent-host-protocol) over a WebSocket, running agent sessions behind it.
- **`@ahpd/server`**: the library it is built from, `createHost()` and the ports around it.

## Why

AHP's model is a **sessions server**: several clients watch and drive the same agent sessions, and none of them owns the process running the agent. That is what makes a session watchable from somewhere other than where it runs.

Today the only host that speaks it is an editor - so a session is only watchable while somebody's VS Code is open. This is the missing piece: the same protocol, the same clients, no editor.

The Claude Agent SDK is the opposite shape - it spawns a CLI that your process alone owns. `ahpd` bridges the two.

```mermaid
flowchart LR
    AHPC["ahpc"]
    VSC["VS Code"]
    OTHER["Other AHP client"]

    HOST["ahpd<br/>AHP host"]
    CLAUDE["Claude Code"]

    AHPC -->|AHP / WebSocket| HOST
    VSC -->|AHP / WebSocket| HOST
    OTHER -->|AHP / WebSocket| HOST

    HOST --> CLAUDE

    HOST --- RES["resources"]
    HOST --- TERM["terminals"]
    HOST --- CHG["changes"]
    HOST --- AUTO["automations"]
```

The clients on the left are interchangeable and none of them owns the session. `Claude Code` on the right is one agent, reached through `Agent` - `examples/` has two more. The four below are the **ports**: everything that touches the machine, handed to the host rather than reached for by it.

## What you can do with it

- Run agent sessions on one machine and drive them from another, from more than one client at a time, with the turn surviving the client that started it.
- Point **VS Code** at it (`chat.remoteAgentHosts`) or any other AHP client; [`ahpc`](https://github.com/softov/ahpc) is the terminal one used here.
- Read and write files, open a shell, and see what a session changed in the working tree - each through a port the host is given rather than one it reaches for.
- Run an agent on a clock, with nobody connected: `scheduledAutomations({ file })` is a cron in a named time zone that starts sessions by itself.
- Serve a backend that is not Claude, on the same host, with none of the protocol re-implemented.

## Install and run the daemon

**Not published yet.** `ahpd` is not on npm, so the install is from source:

```bash
git clone https://github.com/softov/ahpd && cd ahpd
pnpm install && pnpm build
node packages/ahpd/dist/main.js --path /work/project
```

The rest of this README writes `ahpd` for `node packages/ahpd/dist/main.js`.

Once it is published this will be the shorter form, and every flag is the same:

```bash
npm i -g ahpd
ahpd --path /work/project
```

### Run in the background
```bash
ahpd start --path /work
ahpd status
ahpd stop
ahpd config                  # where the configuration is, and what it says
```

`start` detaches, so the daemon outlives the shell that began it - which is the point of a sessions server: close the terminal and the turn keeps running, attach again from somewhere else.

### Serve more than one directory

`--path` names a directory on the **host machine** and can be repeated:

```bash
ahpd \
  --path /work/api \
  --path /work/web
```

The first path is the default when a client does not choose one.

A client cannot point the host at an arbitrary directory. Paths outside the served set are refused.

### To expose it elsewhere:

The daemon binds loopback and takes no token, which needs no secret: anything reaching `127.0.0.1` is already on this machine. Binding anything else without one of `--connection-token`, `--connection-token-file` or `--without-connection-token` refuses to start.

```bash
ahpd \
  --host 0.0.0.0 \
  --connection-token-file ~/.ahpd/token
```

See [docs/DAEMON.md](docs/DAEMON.md) for the complete CLI, the configuration file, tokens, and running on Bun or Deno.

## Connect a client

With [`ahpc`](https://github.com/softov/ahpc):

```bash
ahpc --host ws://127.0.0.1:9187
```

Or VS Code, in `settings.json`:

```json
"chat.remoteAgentHostsEnabled": true,
"chat.remoteAgentHosts": [
  { "name": "ahpd", "address": "ws://127.0.0.1:9187" }
]
```

A path named by a client always refers to the **host's filesystem**, never the client's.

## Use it as a library

`createHost()` implements the AHP side:

* negotiation;
* channels and subscriptions;
* snapshots;
* sequence numbers;
* reconnects;
* sessions and chats;
* actions;
* transcript paging.

You provide the agents and, optionally, the things that touch the machine.

### Minimal host

The smallest host that works is three things: a backend, a host to serve it, and a socket to serve it on.

```ts
import { createHost, listen } from '@ahpd/server';
import { claude } from '@ahpd/agent-claude';

const host = createHost({
  path: process.cwd(),
  agents: [claude({ paths: [process.cwd()] })],
});

await listen({ port: 9187 }, (peer) => host.accept(peer));
```

That is already a working AHP conversation host.

What it does *not* serve is anything that touches the machine, because `createHost` imports no filesystem, no subprocess and no `git`.

Those arrive as **ports**, and each is optional and independent:

```ts
import { createHost, listen, fileResources, shellTerminals, gitBranches, gitChanges, scheduledAutomations, hostTools } from '@ahpd/server';
import { claude } from '@ahpd/agent-claude';

const host = createHost({
  path: process.cwd(),
  agents: [claude({ paths: [process.cwd()] })],

  resources: fileResources(),                 // files a client may read and write, and `@` completion
  terminals: shellTerminals(),                // a shell, as a terminal channel
  changes: gitChanges(),                      // what the working tree has that HEAD does not
  directories: gitBranches(),                 // which branch each served directory is on
  automations: scheduledAutomations({ file: 'automations.json' }),        // agents on a clock, with nobody connected
  tools: hostTools(),                         // tools the host contributes to every session

  onEvent: (line) => process.stdout.write(`${line}\n`),
});
```

Only `path` and `agents` are required.

Leave a port out and the commands behind it answer `-32601` - the same answer this host gives for anything else it does not serve - rather than failing part-way through one.

Reading a file is `node:fs` on one runtime and something else on another; a terminal is a subprocess; a branch is a *binary* that may not be installed at all. A host without one of them is not a broken host, it is a smaller one.

[docs/LIBRARY.md](docs/LIBRARY.md) has `createHost` option by option and what each port has to implement.

## Write an agent

An agent is the thing that answers. It says what it is called, what a session of its kind can be configured with, which sessions it already has, and how to start one - and everything the protocol requires stays the host's.

```ts
import { createHost, listen } from '@ahpd/server';
import { notes } from './agent.js';

const host = createHost({ path, agents: [notes({ path })] });
await listen({ port: 9201 }, (peer) => host.accept(peer));
```

Five members are required - `provider`, `displayName`, `schema`, `defaults`, `create` - and what you leave out is a real answer rather than a gap: no `list` means no sessions to browse, no `probe` means no models until a session of yours reports some. `createHost` cannot tell one agent from another, so a backend of your own and `claude()` are registered the same way and can be served side by side.

[docs/AGENT.md](docs/AGENT.md) is the `Agent` and `Session` contracts, config keys, and the rules that produce a wrong screen rather than an error. The [examples](#examples) below are both complete and both run.

## How compatible is it with AHP

Against **`@microsoft/agent-host-protocol` 0.9.0**, by area rather than by
method. ✅ as specified · 🔀 adapted · 🧩 through a host port · 🚧 partial ·
➖ nothing decided · 🚫 deliberately not.

| AHP area | ahpd | Status | Notes |
| --- | --- | :---: | --- |
| Handshake and channels | `initialize`, `subscribe`, `reconnect` | ✅ | Version negotiated in the client's order of preference; a dropped client replays from its last `serverSeq` |
| Sessions | create, resume, dispose, catalogue | ✅ | Past sessions are reconstructed from Claude transcripts, and resumed only once somebody starts a turn on one |
| Chats and turns | turns, streaming, cancellation, tools | ✅ | Several chats can share one session, each on its own agent process |
| Human in the loop | tool confirmation, agent questions | ✅ | `session/inputNeeded` is a list, so two tools asking at once are answered apart |
| Session configuration | model, permission mode, effort, output style | ✅ | A backend advertises its own properties and a client draws what it is given - the same five approval modes VS Code's own Claude host offers. Keys a client sends anyway (`autoApprove`, `mode`) are mapped onto that. Capabilities are discovered at startup, so a composer draws itself before any turn. `sessionConfigCompletions` is 🚫: every key here is an enum |
| Resources | `resources` port | 🧩 | Optional; reads and writes confined to the served directories, writes behind `resourceRequest` |
| Resource watches | `resources` port | 🧩 | Watch lifetime follows channel subscriptions - the protocol has no dispose command |
| Terminals | `terminals` port | 🧩 | The built-in implementation uses pipes, not a PTY, and says so rather than leaving it to be discovered |
| Changesets | `changes` port | 🧩 | The git implementation serves all four scopes and the working-tree operations |
| Automations | `automations` port | 🧩 | `ahpd` adds scheduled execution: cron in a named time zone, running with nobody connected |
| Authentication | connection token, plus agent credentials | 🔀 | A pushed token is held per connection; Claude otherwise inherits the daemon's own credentials |
| Telemetry | `otlp/exportLogs`, `otlp/exportTraces`, `otlp/exportMetrics` | ✅ | The lines the daemon writes to stdout; a turn as a server span with every tool call a child of it; and cumulative counters against the process start |
| Annotations | - | ➖ | No producer currently |

Method by method that is **31 of the 32 declared commands** and **95 of the 96
state actions**. The rest is `-32601`, said rather than quietly answered: a host
that returns an empty success to a method it lacks leaves the client waiting for
state that is never coming, which reads as a hang rather than as a missing
feature.

[docs/AHP.md](docs/AHP.md) has it command by command and channel by channel,
with what each does differently and why - and the rules a host has to keep that
fail silently rather than loudly.

## Documentation

| | |
| --- | --- |
| [docs/DAEMON.md](docs/DAEMON.md) | The CLI, the configuration file, connection tokens, Node/Bun/Deno |
| [docs/LIBRARY.md](docs/LIBRARY.md) | `createHost` and the ports, for building a host |
| [docs/AGENT.md](docs/AGENT.md) | The `Agent` and `Session` contracts, for writing a backend |
| [docs/AHP.md](docs/AHP.md) | Compatibility area by area, emitted actions, and the rules that fail silently |
| [REFERENCE.md](REFERENCE.md) | The specification and the reference host, and what each has settled |

## Layout

Three packages in one repository, on pnpm. The boundary is real - `@ahpd/server`
imports nothing that runs an agent, and the check for that is that it compiles
with nothing in its `node_modules` but the protocol package: no backend, no
agent SDK, no zod. It did not, at first - `catalogue` reached for the SDK's
session listing from inside the host - and pnpm is why that is now hard to
reintroduce. npm hoists every dependency in the workspace to one directory, so
any package can import anything installed anywhere and it resolves; pnpm links
only what a package declares, so an undeclared import fails where it is written
rather than in somebody else's install.

### `@ahpd/server` - the protocol, and the parts to build a host

| | |
| --- | --- |
| [packages/server/src/types/](packages/server/src/types/)                 | Every shape, importing no runtime value. The contract. |
| [packages/server/src/rpc.ts](packages/server/src/rpc.ts)                 | JSON-RPC framing. Holds no socket. |
| [packages/server/src/listen.ts](packages/server/src/listen.ts)           | Accepts connections on Node, Bun or Deno. |
| [packages/server/src/host.ts](packages/server/src/host.ts)               | Channels, subscriptions, requests and state actions. Imports no backend. |
| [packages/server/src/resources.ts](packages/server/src/resources.ts)     | The `resources` port: files, reads and writes. |
| [packages/server/src/terminals.ts](packages/server/src/terminals.ts)     | The `terminals` port: a shell over pipes. |
| [packages/server/src/changes.ts](packages/server/src/changes.ts)         | The `changes` port: a changeset out of git. |
| [packages/server/src/git.ts](packages/server/src/git.ts)                 | The `directories` port: which branch a directory is on. |
| [packages/server/src/automations.ts](packages/server/src/automations.ts) | The `automations` port, without a clock. |
| [packages/server/src/scheduled.ts](packages/server/src/scheduled.ts)     | The same, with one. |
| [packages/server/src/catalog.ts](packages/server/src/catalog.ts)         | How a session is named, and what its status bits are worth. |
| [packages/server/src/paging.ts](packages/server/src/paging.ts)           | A long list of turns, served a page at a time. |
| [packages/server/src/index.ts](packages/server/src/index.ts)             | The library entry point. |

### `@ahpd/agent-claude` - one backend

| | |
| --- | --- |
| [packages/agent-claude/src/claude.ts](packages/agent-claude/src/claude.ts)         | The `Agent`: what this harness is and how to start one. |
| [packages/agent-claude/src/catalog.ts](packages/agent-claude/src/catalog.ts)       | Claude's own sessions, as rows a host can list. |
| [packages/agent-claude/src/session.ts](packages/agent-claude/src/session.ts)       | One live Claude session, reduced into its channels' state. |
| [packages/agent-claude/src/transcript.ts](packages/agent-claude/src/transcript.ts) | A past Claude session read as turns. |
| [packages/agent-claude/src/probe.ts](packages/agent-claude/src/probe.ts)           | One CLI at startup, to learn what Claude offers. |

### `ahpd` - the daemon

| | |
| --- | --- |
| [packages/ahpd/src/main.ts](packages/ahpd/src/main.ts)     | argv, the filesystem and stdout. The only file that reads any of the three. |
| [packages/ahpd/src/daemon.ts](packages/ahpd/src/daemon.ts) | Running detached, and finding the one that is. |
| [packages/ahpd/src/config.ts](packages/ahpd/src/config.ts) | The config file, and where this tool keeps its things. |

Everything Claude is reached only through `Agent`. It used to be duplicated: `ahpc` had a `--claude` mode that reached the Agent SDK in-process, with its own translation of it. That is gone, and the client now depends on no agent SDK at all - two implementations of one translation meant two answers to every question, and the one nobody is looking at is the one that drifts. This is the only copy.

## Examples

Two agents and a client, each complete and each running. The two agents have a README that is the part of the contract they demonstrate.

| | |
| --- | --- |
| [examples/echo](examples/echo) | The whole of `Agent` and `Session` with nothing behind it - no model, no subprocess, about two hundred lines. Its README is the contract in the order the host asks for it |
| [examples/notes](examples/notes) | The same with tools: one that runs without asking, one that waits to be allowed, and a question that is not about a tool. Its README is the rules for asking |
| [softov/ahpc](https://github.com/softov/ahpc) | An Agent Host Protocol chat and CLI client, depending on no agent SDK at all |

```bash
pnpm echo  -- --port 9200
pnpm notes -- --port 9201
ahpc --host ws://127.0.0.1:9201
```

## Development

```bash
pnpm test        # ~450 tests, no socket and no network
pnpm typecheck
pnpm wire -- test/fixtures/wire.jsonl   # a capture, against the strict schema
```

The host can be tested without opening a socket: `accept()` takes a peer and returns its handler.

[`test/conformance.test.ts`](test/conformance.test.ts): it drives the host and then replays every action it emitted through the protocol package's **own reducers** - `rootReducer`, `sessionReducer`, `chatReducer`, `terminalReducer`, `changesetReducer` - rather than reading state back out of a snapshot this host also wrote. A snapshot is this host agreeing with itself; the reducer is what VS Code and `ahpc` actually run.

That checks the state a real AHP client would see rather than validating `ahpd` against snapshots produced by `ahpd` itself.

[`test/wire.test.ts`](test/wire.test.ts) checks the other half: not whether a client can read what this host sends, but whether the protocol *declares* it. `tools/schema.mjs` generates a strict schema out of the package's own types - every object closed, which the shipped `state.schema.json` is not - and every frame goes through it, so an undeclared key or a missing required one fails the build. A reducer cannot see either, and neither can TypeScript: a conditional spread is not excess-property-checked, which is how three undeclared fields reached the wire from code typed against the package.

The check that cannot be done here is driving it with a client that was not written against it. `ahpc` is lenient in places - a `chat/reasoning` bug in this host went unnoticed for exactly that reason, because no screen ever showed what a conformant client would have - so the reducers above are the strict reader, and VS Code is the one that has to agree. A drive against VS Code found two bugs that were invisible from the source; both are in `git log`, and what they cost is written up in [docs/AHP.md](docs/AHP.md).
