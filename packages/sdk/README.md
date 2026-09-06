# @ahpd/sdk

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fsdk)](https://www.npmjs.com/package/@ahpd/sdk)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

A server library for the [Agent Host Protocol](https://github.com/microsoft/agent-host-protocol).

It has no agent in it. You pass one in when you create the host.

## Install

```bash
pnpm add @ahpd/sdk @microsoft/agent-host-protocol
```

The protocol package is a peer dependency. This package uses runtime values from it, so there should only be one copy in the dependency tree.

## Use

A small host using the Claude backend looks like this:

```ts
import { createHost, listen } from '@ahpd/sdk';
import { claude } from '@ahpd/agent-claude';

const host = createHost({
  path: process.cwd(),
  agents: [claude({ paths: [process.cwd()] })],
});

const listener = await listen({ port: 9187 }, (peer) => host.accept(peer));
console.log(`on ws://${listener.host}:${listener.port} (${listener.runtime})`);
```

`createHost()` creates the AHP host.

`listen()` is the WebSocket listener included for Node, Bun and Deno. The host itself is not tied to WebSockets.

Once a client is connected, the host takes care of version negotiation, snapshots, subscriptions, sequence numbers, transcript paging, completions, queued messages, shared drafts, read and archived flags, multiple chats per session, and turns.

`accept(peer)` takes anything that can `send`, `notify` and `close`, and returns a handler. `listen` is a WebSocket implementation for Node, Bun and Deno. Tests supply their own, which is why the test suite runs without a network.

## Options

`path` and `agents` are required. The rest are optional. If you leave one out, the host returns an error for the commands it cannot serve instead of an empty result.


```ts
import { 
  createHost, 
  fileResources, 
  shellTerminals, 
  gitChanges, 
  gitBranches, 
  gitWorktrees, 
  hostTools, 
  scheduledAutomations,
} from '@ahpd/sdk'; 

const host = createHost({ 
  path, 
  agents, 
  resources: fileResources(), 
  terminals: shellTerminals(), 
  changes: gitChanges(), 
  directories: gitBranches(), 
  worktrees: gitWorktrees(), 
  tools: hostTools(), 
  automations: scheduledAutomations({ file: './automations.json', }),
});

```

| option | |
| --- | --- |
| `path` | the directory whose sessions this host serves |
| `agents` | the backends to serve, as `Agent` implementations |
| `resources` | file reads, writes, and `@` completion. Use `fileResources()` |
| `terminals` | a shell as a terminal channel. Use `shellTerminals()` |
| `changes` | uncommitted changes as a changeset. Use `gitChanges()` |
| `directories` | the current branch of each served directory. Use `gitBranches()` |
| `automations` | triggered agents. Use `memoryAutomations()`, or `scheduledAutomations({ file })` for cron |
| `worktrees` | sessions in their own git worktree. Use `gitWorktrees()` |
| `tools` | tools the host adds to every session. Use `hostTools()` |
| `onEvent` | called with one line per notable event, for logging |

None of these are imported by the host itself. `fileResources` reads files, `shellTerminals` spawns shells, and `gitBranches` runs `git`, and you pass them in.

## Writing a backend

`Agent` has five required members: `provider`, `displayName`, `schema`, `defaults` and `create`.

```ts
import type { Agent, Session, Start } from '@ahpd/sdk';

export function parrot(): Agent {
  return {
    provider: 'parrot',
    displayName: 'Parrot',
    schema: () => ({ properties: {} }),
    defaults: () => ({}),
    create: (start: Start): Session => converse(start),
  };
}
```

`provider` is the id a client names in `createSession`. It has to be unique among the agents one host was given.

`schema()` says what a session of this kind can be configured with, and `defaults()` says where those keys start. Both can be empty.

`create()` returns the session. The session holds the state of the session and chat channels, and calls `start.emit('chat', ...)` as things happen.

Pass it to the host like any other backend: `createHost({ path, agents: [parrot()] })`. Your backend and [`@ahpd/agent-claude`](https://www.npmjs.com/package/@ahpd/agent-claude) register identically and can run side by side.

See [docs/AGENT.md](https://github.com/softov/ahpd/blob/main/docs/AGENT.md) for the contract, and [examples/echo](https://github.com/softov/ahpd/tree/main/examples/echo) for a working backend in about two hundred lines.

## Types

All types are exported. Nothing under `types/` imports a runtime value, so you can read the contract without loading the implementation.

## Documentation

| | |
| --- | --- |
| [LIBRARY.md](https://github.com/softov/ahpd/blob/main/docs/LIBRARY.md) | `createHost` and the ports in full |
| [AGENT.md](https://github.com/softov/ahpd/blob/main/docs/AGENT.md) | The `Agent` and `Session` contracts |
| [AHP.md](https://github.com/softov/ahpd/blob/main/docs/AHP.md) | Protocol coverage action by action |

## License

MIT © Softov

