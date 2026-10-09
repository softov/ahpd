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

| Option | Default | What it does |
| --- | --- | --- |
| `path` | required | The directory whose sessions this host serves; sessions outside it are neither listed nor openable |
| `agents` | required | The backends to serve, as `Agent` implementations, each with its own `provider`. The first is what a client gets when it names none |
| `hostName` | `host` | What the host is called in the owner `root:<hostName>` of work nobody started as themselves |
| `agentPlugins` | none | The plugin that registered each agent, by provider, so a session of it can run nested in a machine. `foldHostOptions` writes it |
| `resources` | none | File reads, writes and `@` completion. Use `fileResources()`. See [resources](https://github.com/softov/ahpd/blob/main/docs/LIBRARY.md#resources) |
| `resourceProviders` | none | One provider per URI scheme beside `file:`; an optional `describe()` is what the host advertises in `_meta['ahpd.resourceProviders']` |
| `terminals` | none | A shell as a terminal channel. Use `shellTerminals()`. See [terminals](https://github.com/softov/ahpd/blob/main/docs/LIBRARY.md#terminals) |
| `changes` | none | Uncommitted changes as a changeset. Use `gitChanges()`. See [changes](https://github.com/softov/ahpd/blob/main/docs/LIBRARY.md#changes) |
| `directories` | none | The current branch of each served directory. Use `gitBranches()`. See [directories](https://github.com/softov/ahpd/blob/main/docs/LIBRARY.md#directories) |
| `worktrees` | none | Sessions in their own git worktree. Use `gitWorktrees()` |
| `worktreesRoot` | beside the repository | An absolute folder every session tree goes under, as `<root>/<repo>/<name>`. Left out, a tree sits at `<repo>.worktrees` beside its repository, which is where VS Code's host looks for it |
| `github` | none | What GitHub knows about a session's branch, such as its pull request. Use `githubPullRequests()`. See [github](https://github.com/softov/ahpd/blob/main/docs/LIBRARY.md#github) |
| `users` | none | The people who may use this host. Left out, the connection token is the whole of who may connect. Use `fileUsers({ file })` |
| `automations` | none | Triggered agents. Use `memoryAutomations()`, or `scheduledAutomations({ file })` for cron. See [automations](https://github.com/softov/ahpd/blob/main/docs/LIBRARY.md#automations) |
| `unownedAutomations` | `every` | What an automation that names no owner sees: `every` or `none` |
| `sessions` | `memorySessions()` | Where the flags and configuration the host adds to a session are kept. A daemon wants `fileSessions({ dir })`, which outlives a restart |
| `computers` | none | How a backend runs its process inside a named machine. The plugin that owns the `computer:` scheme contributes it |
| `containers` | none | How this host runs another host inside a container. Present, the host serves the dev container requests |
| `usage` | none | Where the cost of the work is kept. Use `fileUsage({ folder })` |
| `usagePer` | `turn` | Whether a turn leaves one usage record (`turn`), or each of its reports leaves one (`report`) |
| `policies` | none | Where the policies that say who may use what are kept. Use `filePolicies({ file })` or `memoryPolicies()` |
| `policiesCheck` | `false` | Whether what the policies say is enforced |
| `vault` | none | Where the secrets the host's work needs are kept, by scoped name. Left out, a plugin that reads a secret is told there is no vault |
| `tools` | none | Tools the host adds to every session, as the protocol's `serverTools`. Use `hostTools()`. See [The tools](https://github.com/softov/ahpd/blob/main/docs/LIBRARY.md#the-tools) |
| `mcpServers` | none | The MCP servers every session is offered, by name, in VS Code's `mcpServers` shape |
| `toolsServers` | none | Where the host serves its own tools as an MCP server. Use `toolServers(...)` and mount its handler on your listener |
| `sessionConfig` | none | Session settings merged into every session's schema. The fold fills it from the plugins' `registerSessionConfig` |
| `sessionConfigCompletions` | none | Who answers `sessionConfigCompletions` for a contributed setting, by key |
| `advancedTools` | `false` | Whether the tools that declare `advancedPermission` are offered |
| `clientToolTimeoutMs` | `600000` | How long a tool call a client runs may wait before the host calls it failed, in milliseconds. `0` is no limit |
| `deltaWindowMs` | `75` | How long a streamed delta waits for the next one before it is sent, in milliseconds. `0` sends every delta as it arrives |
| `rootConfig` | none | The daemon's own settings, shown in root config beside the host's keys, with writes handed back |
| `diagnostics` | none | What the host answers when a window asks for its version, logs, network or shutdown. See [What the window asks](https://github.com/softov/ahpd/blob/main/docs/LIBRARY.md#what-the-window-asks-a-host-about-itself) |
| `onEvent` | none | Called with one line per notable event, for a log |
| `events` | none | What plugins subscribed to, by event. The fold fills it from `pluginHost`; `raise()` calls them |
| `closers` | none | What plugins asked to run when the host closes. The fold fills it from `registerClose` |
| `pluginTriggers` | none | The trigger types plugins offer for automations. The fold fills it from `registerTriggerType` |
| `pluginStarts` | none | Every plugin that may start a session for somebody. The fold fills it |

`agentPlugins`, `sessionConfig`, `sessionConfigCompletions`, `events`, `closers`, `pluginTriggers` and `pluginStarts` are what `foldHostOptions` writes from the plugins a host loads, and a host that loads none can leave them out. `pluginHost()` records what one plugin registers, and the `In your own host` section of each plugin README shows the fold.

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
| [src/repo/git.ts](https://github.com/softov/ahpd/blob/main/packages/sdk/src/repo/git.ts) | The `directories` port: which branch a directory is on |
| [src/automations.ts](https://github.com/softov/ahpd/blob/main/packages/sdk/src/automations.ts) | The `automations` port, without a clock |
| [src/scheduled.ts](https://github.com/softov/ahpd/blob/main/packages/sdk/src/scheduled.ts) | The `automations` port, with a clock |
| [src/tools/session.ts](https://github.com/softov/ahpd/blob/main/packages/sdk/src/tools/session.ts) | The tools a session's agent is given |
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
