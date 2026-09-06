# @ahpd/server

An [Agent Host Protocol](https://github.com/microsoft/agent-host-protocol) host,
and the parts to build your own. **There is no backend in here** — that is the
point of it being its own package.

```bash
pnpm add @ahpd/server @microsoft/agent-host-protocol
```

The protocol package is a peer dependency: this one uses runtime values from it,
and one copy in the tree is what keeps a host and its clients agreeing on what a
version is.

## The smallest host that works

```ts
import { createHost, listen } from '@ahpd/server';
import { claude } from '@ahpd/agent-claude';

const host = createHost({
  path: process.cwd(),
  agents: [claude({ paths: [process.cwd()] })],
});

const listener = await listen({ port: 9187 }, (peer) => host.accept(peer));
console.log(`on ws://${listener.host}:${listener.port} (${listener.runtime})`);
```

That already serves version negotiation, snapshots, subscriptions, sequence
numbers, transcript paging, completions, queued messages, shared drafts, read
and archived flags, several chats per session, and the whole of a turn.

`accept(peer)` is the seam: it takes something that can `send`, `notify` and
`close`, and answers with a handler. `listen` is one implementation of a peer,
over a WebSocket, on Node, Bun or Deno — a test is another, which is why this
package's whole suite runs with no network.

## What goes into a host

Two things are required and the rest is opt-in. Anything you leave out is a
**real answer**: the host refuses the commands it cannot serve rather than
answering them emptily, because a client left waiting for state that is never
coming reads as a hang and not as a missing feature.

| | |
| --- | --- |
| `path` | the directory whose sessions this host serves |
| `agents` | the backends it serves — anything satisfying `Agent` |
| `resources` | files a client may read and write, and `@` completion — `fileResources()` |
| `terminals` | a shell, as a terminal channel — `shellTerminals()` |
| `changes` | what the working tree has that HEAD does not — `gitChanges()` |
| `directories` | which branch each served directory is on — `gitBranches()` |
| `automations` | agents on a trigger — `memoryAutomations()`, or `scheduledAutomations({ file })` with a clock |
| `worktrees` | a session in a worktree of its own — `gitWorktrees()` |
| `tools` | tools the host contributes to every session — `hostTools()` |
| `onEvent` | one line per notable event, for a log |

Nothing here reaches for the machine on its own. `fileResources` reads files,
`shellTerminals` spawns shells and `gitBranches` spawns `git`, and all three are
*passed in* — so the protocol imports no runtime, and a host without one of them
is a host that says so.

## Writing a backend

`Agent` is five required members — `provider`, `displayName`, `schema`,
`defaults`, `create` — and `createHost` cannot tell one agent from another, so
your own and [`@ahpd/agent-claude`](https://www.npmjs.com/package/@ahpd/agent-claude)
register the same way and can be served side by side.

[docs/AGENT.md](https://github.com/softov/ahpd/blob/main/docs/AGENT.md) is the
contract; [examples/echo](https://github.com/softov/ahpd/tree/main/examples/echo)
is a complete backend in about two hundred lines with no model behind it.

## Types

Every shape is exported, and nothing under `types/` imports a runtime value — so
the contract can be read without loading any of this.

## Documentation

| | |
| --- | --- |
| [LIBRARY.md](https://github.com/softov/ahpd/blob/main/docs/LIBRARY.md) | `createHost` and the ports, in full |
| [AGENT.md](https://github.com/softov/ahpd/blob/main/docs/AGENT.md) | The `Agent` and `Session` contracts |
| [AHP.md](https://github.com/softov/ahpd/blob/main/docs/AHP.md) | Compatibility action by action, and the rules that fail silently |

MIT © Luiz Fernando Softov
