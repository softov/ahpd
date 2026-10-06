# @ahpd/sdk

[![npm](https://img.shields.io/npm/v/%40ahpd%2Fsdk)](https://www.npmjs.com/package/@ahpd/sdk)
[![CI](https://github.com/softov/ahpd/actions/workflows/ci.yml/badge.svg)](https://github.com/softov/ahpd/actions/workflows/ci.yml)
![license MIT](https://img.shields.io/badge/license-MIT-blue)
![node >=22](https://img.shields.io/badge/node-%3E%3D22-5fa04e)
![Agent Host Protocol 0.9.0](https://img.shields.io/badge/AHP-0.9.0-0b7285)

A server library for the [Agent Host Protocol](https://github.com/microsoft/agent-host-protocol). It has no agent in it: you pass one in when you create the host.

Part of [ahpd](https://github.com/softov/ahpd). The source is in [`packages/sdk`](https://github.com/softov/ahpd/tree/main/packages/sdk), and the daemon built on it is [`@ahpd/server`](https://www.npmjs.com/package/@ahpd/server).

## Install

```bash
pnpm add @ahpd/sdk
```

The protocol package, `@microsoft/agent-host-protocol`, is a dependency and comes with it.

## Use

A small host with the Claude backend:

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

`createHost()` creates the host. Once a client connects, it handles version negotiation, snapshots, subscriptions, sequence numbers, transcript paging, completions, queued messages, shared drafts, read and archived flags, several chats per session, and turns.

`accept(peer)` takes anything that can `send`, `notify` and `close`, and returns a handler. `listen()` is the WebSocket listener for Node, Bun and Deno; the host itself is not tied to WebSockets, and the tests pass their own peer.

## Options

`path` and `agents` are required. Leave out any other option and the host answers the commands that need it with an error, not an empty result.

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
  automations: scheduledAutomations({ file: './automations.json' }),
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
| `worktreesRoot` | an absolute folder every session tree goes under, as `<root>/<repo>/<name>`. Left out, a tree sits at `<repo>.worktrees` beside its repository, which is where VS Code's host looks for it |
| `tools` | tools the host adds to every session. Use `hostTools()` |
| `resourceProviders` | one provider per URI scheme beside `file:`; an optional `describe()` is what the host advertises in `_meta['ahpd.resourceProviders']` |
| `onEvent` | called with one line per notable event, for logging |

The host imports none of these itself. `fileResources` reads files, `shellTerminals` spawns shells and `gitBranches` runs `git`, and you decide which to pass in.

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

`provider` is the id a client names in `createSession`, unique among one host's agents. `schema()` says what a session can be configured with and `defaults()` says where those keys start; both can be empty. `create()` returns the session, which holds the session and chat state and calls `start.emit('chat', ...)` as things happen.

Pass it to the host like any other backend: `createHost({ path, agents: [parrot()] })`. It registers the same way as [`@ahpd/agent-claude`](https://www.npmjs.com/package/@ahpd/agent-claude), and the two can run side by side.

[docs/AGENT.md](https://github.com/softov/ahpd/blob/main/docs/AGENT.md) has the contract, and [examples/echo](https://github.com/softov/ahpd/tree/main/examples/echo) is a working backend in about two hundred lines.

## Types

All types are exported. Nothing under `types/` imports a runtime value, so you can read the contract without loading the implementation.

## Layout

| | |
| --- | --- |
| [src/types/](https://github.com/softov/ahpd/tree/main/packages/sdk/src/types) | Every shape, importing no runtime value |
| [src/rpc.ts](https://github.com/softov/ahpd/blob/main/packages/sdk/src/rpc.ts) | JSON-RPC framing, with no socket |
| [src/listen.ts](https://github.com/softov/ahpd/blob/main/packages/sdk/src/listen.ts) | Accepts connections on Node, Bun or Deno |
| [src/host.ts](https://github.com/softov/ahpd/blob/main/packages/sdk/src/host.ts) | Channels, subscriptions, requests and state actions |
| [src/resources.ts](https://github.com/softov/ahpd/blob/main/packages/sdk/src/resources.ts) | The `resources` port: files, reads and writes |
| [src/terminals.ts](https://github.com/softov/ahpd/blob/main/packages/sdk/src/terminals.ts) | The `terminals` port: a shell over pipes |
| [src/changes.ts](https://github.com/softov/ahpd/blob/main/packages/sdk/src/changes.ts) | The `changes` port: a changeset from git |
| [src/git.ts](https://github.com/softov/ahpd/blob/main/packages/sdk/src/git.ts) | The `directories` port: which branch a directory is on |
| [src/automations.ts](https://github.com/softov/ahpd/blob/main/packages/sdk/src/automations.ts) | The `automations` port, without a clock |
| [src/scheduled.ts](https://github.com/softov/ahpd/blob/main/packages/sdk/src/scheduled.ts) | The `automations` port, with a clock |
| [src/sessiontools.ts](https://github.com/softov/ahpd/blob/main/packages/sdk/src/sessiontools.ts) | The tools a session's agent is given |
| [src/users.ts](https://github.com/softov/ahpd/blob/main/packages/sdk/src/users.ts) | The user directory, roles and grants |
| [src/catalog.ts](https://github.com/softov/ahpd/blob/main/packages/sdk/src/catalog.ts) | Session names and status bits |
| [src/paging.ts](https://github.com/softov/ahpd/blob/main/packages/sdk/src/paging.ts) | A long list of turns, served a page at a time |
| [src/index.ts](https://github.com/softov/ahpd/blob/main/packages/sdk/src/index.ts) | The entry point |

## Documentation

| | |
| --- | --- |
| [LIBRARY.md](https://github.com/softov/ahpd/blob/main/docs/LIBRARY.md) | `createHost` and the ports in full |
| [AGENT.md](https://github.com/softov/ahpd/blob/main/docs/AGENT.md) | The `Agent` and `Session` contracts |
| [AHP.md](https://github.com/softov/ahpd/blob/main/docs/AHP.md) | Protocol coverage, action by action |

## License

MIT © Softov
