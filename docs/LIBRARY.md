# Using ahpd as a library

`createHost` is the protocol and nothing else: no agent logic, and nothing that
touches the machine. It is the same function the daemon in
[packages/server/src/main.ts](../packages/server/src/main.ts) calls.

This is the *host* half. Writing the backend that answers is
[AGENT.md](AGENT.md).

Four things go into a host, and only the first two are required:

| | | |
| --- | --- | --- |
| `path` | the directory whose sessions this host serves | required |
| `agents` | the backends it serves. `claude()` is one; anything satisfying `Agent` is another | required |
| ports | `resources`, `terminals`, `changes`, `directories`, `automations`, `worktrees` | opt-in |
| `tools` | tools this host contributes to every session it runs | opt-in |
| `onEvent` | one line per notable event, for a log | opt-in |

## The smallest host

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

That already serves version negotiation, snapshots, subscriptions, sequence
numbers, transcript paging, completions, queued messages, shared drafts, read
and archived flags, several chats per session, and the whole of a turn.

`accept(peer)` is the seam: it takes something that can `send`, `notify` and
`close`, and returns a handler. `listen` is one implementation of a peer over a
WebSocket, on Node, Bun or Deno; a test is another, which is why the whole suite
runs without a network.

## A complete host

```ts
import { createHost, listen, fileResources, shellTerminals, gitChanges, gitBranches, scheduledAutomations } from '@ahpd/sdk';
import { claude } from '@ahpd/agent-claude';

const path = process.cwd();

const host = createHost({
  path,
  agents: [claude({ paths: [path] })],
  resources: fileResources(),
  terminals: shellTerminals(),
  changes: gitChanges(),
  directories: gitBranches(),
  automations: scheduledAutomations({ file: 'automations.json' }),
  onEvent: (line) => process.stdout.write(`${line}\n`),
});

await listen({ port: 9187 }, (peer) => host.accept(peer));
```

## The ports

Each is optional and independent. Leave one out and the commands behind it
answer `-32601`, which is what a client degrades on; a host that half-answered
would fail part-way through instead.

| port | what it is | left out | the one that ships |
| --- | --- | --- | --- |
| `resources` | files a client may read, what `@` completes into, and the write half | no `resource*` command is served | `fileResources()` |
| `terminals` | how a shell is opened | no terminal can be created | `shellTerminals()` |
| `changes` | what the working tree has that HEAD does not | no session advertises a changeset, and the changes screen is honestly empty rather than emptily wrong | `gitChanges()` |
| `directories` | facts about a served directory - the branch it is on | sessions carry their project and nothing more | `gitBranches()` |
| `automations` | agents on a trigger | no `ahp-automations://` channel is advertised | `scheduledAutomations({ file })`, or `memoryAutomations()` without the clock |

### `resources`

```ts
interface ResourceStore {
  list(uri, roots): Promise<Entry[]>;
  read(uri, roots, wanted?): Promise<Read>;
  resolve(uri, roots, followSymlinks?): Promise<Metadata>;
  complete(typed, base, roots, limit?): Promise<string[]>;

  // The write half, all optional. A store without them is read-only, and a
  // write is answered `-32601` rather than refused about a path.
  write?(uri, roots, content): Promise<void>;
  remove?(uri, roots, recursive?): Promise<void>;
  mkdir?(uri, roots): Promise<void>;
  move?(source, destination, roots, failIfExists?): Promise<void>;
  copy?(source, destination, roots, failIfExists?): Promise<void>;

  // Optional. Without it `createResourceWatch` answers `-32601`, which a
  // client degrades on rather than fails on.
  watch?(uri, roots, options, onChange): Promise<Watcher>;
}
```

`roots` is handed in on every call and is the directories this host was told to
serve. The store checks against it; the host does not do it for you, because a
store that resolves symlinks knows things about a path that the host does not.

### `terminals`

`create(options)` returns a `Terminal`. [packages/sdk/src/terminals.ts](../packages/sdk/src/terminals.ts)
is a subprocess over pipes, which is why it reports `isPty: false` - said rather
than left to be discovered, because anything drawing itself with cursor movement
will not look right.

### `changes`

```ts
interface ChangesetSource {
  scopes(dir, session): ChangesetScope[];
  state(dir, session, scope): Promise<ChangesetState | undefined>;
  summary(dir): ChangesSummary | undefined;
  read?(uri): Promise<{ data: string; encoding: string } | undefined>;
  refresh?(dir): Promise<boolean>;
  review?(dir, session, scope, files, reviewed): boolean;
  observe?(dir, session, turnId, path, phase): void;
  operations?(dir, session, scope): ChangesetOperation[];
  invoke?(request): Promise<ChangesetOperationResult>;
}
```

`read` is the part worth noticing: a changeset needs both sides of an edit, and
what a file *used to be* is not a file on disk. `gitChanges()` serves the
before-side out of `git show HEAD:` behind a URI it resolves itself.

### `directories`

`meta(dir)` returns whatever this host can say about a directory, and
`gitBranches()` returns `{ git: { branch } }` - which becomes `_meta.git.branch`
on every session row in that directory. Cached per directory and re-read when a
turn ends, so a host with ninety-eight sessions in one repository asks git once.

### `automations`

`memoryAutomations()` holds definitions and runs them when asked.
`scheduledAutomations({ file })` is the same store with a clock: a five-field cron in a
named time zone, definitions in `automations.json`, and one catch-up run for
what was missed while the host was down. A store with no clock says so by
leaving `nextRunAt` off.

## The tools

`tools` is not a port - nothing behind it is a command a client calls - but it
is handed in the same way and for the same reason: what a host knows is the
host's business.

They are the protocol's `serverTools`: tools that are neither a backend's nor a
client's. Each is a `ToolDefinition` the model is offered and a `run` that is
called when the model calls it, with the arguments it passed and a view of the
session it called from. They are reported on `SessionState.serverTools`, given
to every backend that can take tools, and replaced whole with `host.setTools()`
- which dispatches `session/serverToolsChanged` to every running session.

`hostTools()` is the set that ships: `ahp_sessions` and `ahp_terminals`, both
read-only, and both answering what an agent inside one session cannot see for
itself - the sessions running beside it and the terminals a person is watching.

```ts
createHost({
  path,
  agents,
  tools: [
    ...hostTools(),
    {
      definition: {
        name: 'deploy_status',
        description: 'What is currently deployed',
        inputSchema: { type: 'object', properties: { environment: { type: 'string' } } },
      },
      run: async (input) => ask(String(input.environment ?? 'production')),
    },
  ],
});
```

## The agents

`agents` is the one option with no default: a host serves at least one backend,
each with a `provider` no other has. The first is what a client gets when it
names none.

```ts
import { createHost } from '@ahpd/sdk';
import { claude } from '@ahpd/agent-claude';
import { notes } from './my-agent.js';

createHost({ path, agents: [claude({ paths: [path] }), notes({ path })] });
```

Nothing in the host knows what any of them are. `claude()` is one that ships
with this package; anything satisfying `Agent` is another, and the two are
registered identically.

Writing one is its own document: [AGENT.md](AGENT.md) has the `Agent` and
`Session` contracts, config keys and `setConfig`, and the rules that produce a
wrong screen rather than an error. [examples/echo](../examples/echo) and
[examples/notes](../examples/notes) are two complete ones.

## What else is exported

```ts
// @ahpd/sdk - the protocol, the ports, and everything that is not a backend
import {
  createHost, ROOT,                       // the host, and the root channel URI
  listen,                                 // a socket, on Node, Bun or Deno
  createPeer, receive, RpcError,          // JSON-RPC, holding no socket
  PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INTERNAL_ERROR,
  fileResources, shellTerminals,          // the resources and terminals ports
  gitChanges, gitBranches, gitWorktrees,  // the git-backed ports
  memoryAutomations, scheduledAutomations,// automations, without a clock and with
  hostTools,                              // the tools this package contributes
  uriFor, idFor, idOf, Status,            // how a session is named, and its status bits
  tail, older, PAGE,                      // paging a long list of turns
  within,                                 // whether a path is under a served root
} from '@ahpd/sdk';

// @ahpd/agent-claude - one backend, and nothing the host needs to know about
import {
  claude,        // the `Agent` to register
  createSession, // one live session of it
  catalogue,     // Claude's own sessions, as rows a host can list
  turnsOf,       // a past session read out of its transcript
  probe,         // one CLI at startup, to learn what it offers
} from '@ahpd/agent-claude';
```

Every type is exported too, from `packages/sdk/src/types/`.
