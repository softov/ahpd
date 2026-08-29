# ahpd

An [Agent Host Protocol](https://microsoft.github.io/agent-host-protocol/) host
that runs Claude Code sessions.

## Why

AHP's model is a **sessions server**: several clients watch and drive the same
agent sessions, and none of them owns the process running the agent. That is
what makes a session watchable from somewhere other than where it runs.

Today the only host that speaks it is an editor - so a session is only
watchable while somebody's VS Code is open. This is the missing piece: the same
protocol, the same clients, no editor.

The Claude Agent SDK is the opposite shape - it spawns a CLI that your process
alone owns. Bridging the two is all this daemon does.

## A host of your own

`ahpd` is also the parts to serve something that is not Claude. `createHost`
imports no backend at all: it takes agents, and Claude is one of them.

```ts
import { createHost, listen, claude } from 'ahpd';

const host = createHost({
  path: process.cwd(),
  agents: [claude({ paths: [process.cwd()] }), myAgent()],
});

await listen({ port: 9187 }, (peer) => host.accept(peer));
```

An agent says what it is called, what a session of its kind can be configured
with, which sessions it already has, and how to start one. Everything the
protocol requires - version negotiation, snapshots, subscriptions, sequence
numbers, transcript paging, completions - stays the host's.

[`examples/echo`](examples/echo) is a complete one written from nothing: no
model, no subprocess, about two hundred lines, and it runs. Its README is the
contract in the order the host asks for it, and the rules a session has to
keep.

```bash
node dist/examples/echo/main.js --port 9200
ahpc --host ws://127.0.0.1:9200
```

## Run it

```bash
npm install && npm run build

node dist/src/main.js --port 9187 --path /where/the/sessions/are   # Node
bun  dist/src/main.js --port 9187 --path /where/the/sessions/are   # Bun
deno run -A dist/src/main.js --port 9187 --path /where/…           # Deno
```

The runtime is detected at startup and named in the first line of output. Node
needs the optional `ws` dependency, having no WebSocket server of its own; Bun
and Deno use their built-in servers and need nothing. Node and Bun are tested;
Deno is written to the same interface but has not been run here.

### While you are changing it

```bash
npm run dev          # node
npm run dev:bun      # bun
npm run echo         # the same pair, for examples/echo
npm run echo:bun
```

Node is what this ships on and what `dev` means; Bun is the alternative, and
the `:bun` pair exists because `listen.ts` is one file and three code paths -
a change to it wants running under more than one before it is believed. Each
names the runtime it is on in its first line of output, so there is never a
question which one answered.

All four run the TypeScript source, restart on save, compile nothing and
install nothing.

The difference between them is in what each needs to find a file. This source
spells its own imports `./host.js`, because that is what will be there after a
build. Bun rewrites those to the `.ts` on disk by itself; Node resolves them
literally and looks for a `host.js` that does not exist yet, so the Node
scripts register [`scripts/dev-hooks.mjs`](scripts/dev-hooks.mjs) to do the
same rewrite - about twenty lines, no dependency.

Node also strips types rather than transforming them, so it cannot run the
TypeScript that *emits* code: enums, namespaces, and constructor parameter
properties. There are none here, and `test/strippable.test.ts` is what keeps
it that way.

Then point a client at it:

```bash
ahpc --host ws://127.0.0.1:9187
```

`--path` is a directory the host serves, on **this** machine, and it is
repeatable:

```bash
ahpd --path /work/api --path /work/web
```

The first is where a session goes when the client names none, and is what the
host advertises as its default. The catalogue is the union of all of them, so
nothing goes missing by adding one.

A client names paths in the host's filesystem, never its own - `ahpc --path`
asks for a directory *there*. One the host was not told to serve is refused
with the list of what it does serve, rather than quietly replaced: a host that
ran the agent wherever it was told is one that anybody who can reach the port
can point at any directory on the machine, and a directory accepted and then
ignored is a session running somewhere nobody asked for.

## Who may connect

The daemon binds loopback and takes no token, which needs no secret: anything
reaching `127.0.0.1` is already on this machine.

```bash
# Reachable from elsewhere, behind a secret
ahpd --host 0.0.0.0 --connection-token-file ~/.ahpd/token

# Or given directly, or deliberately without one
ahpd --host 0.0.0.0 --connection-token "$SECRET"
ahpd --host 0.0.0.0 --without-connection-token
```

Binding anything but loopback without one of those three refuses to start,
rather than putting a host on the network that anybody can drive. A token file
that does not exist is written with a fresh token, owner-readable only; one
that does is read.

Clients present it as `?tkn=<secret>` on the WebSocket URL or as an
`Authorization: Bearer <secret>` header - the query string is the one that
always works, because a browser cannot set headers on a WebSocket handshake.
A connection with the wrong token is refused with **401 at the handshake**, so
it never reaches the host at all.

```bash
ahpc --host ws://192.168.1.10:9187 --token "$SECRET"
```

Only stdout says where the token came from, never what it is.

## What it serves

| Method | |
| --- | --- |
| `initialize` | ✅ version negotiation, `initialSubscriptions` snapshots |
| `ping` | ✅ |
| `subscribe` / `unsubscribe` | ✅ root, session and chat channels |
| `listSessions` | ✅ most-recently-modified first, live sessions included |
| `resolveSessionConfig` | ✅ permission mode, effort, output style, thinking - the same schema a session reports, so a row is configurable before it is resumed. The output styles are the harness's own, learned by the boot probe, so the control is absent rather than empty on a harness that has none |
| capabilities | ✅ models, skills, slash commands, subagents, MCP servers - read from the CLI's control protocol, so they are known before any turn |
| skills | ✅ told apart from built-in prompts, and a skill the CLI keeps for the agent is not offered after a slash |
| `reconnect` | ✅ replays what a dropped client missed from its last `serverSeq`, or hands back snapshots when the gap is longer than the buffer |
| `createSession` / `disposeSession` | ✅ |
| past sessions | ✅ every catalogue row opens from its transcript - a file read, no CLI - and is **resumed** when somebody starts a turn on it |
| model selection | ✅ on the session (`session/configChanged`) and on a turn (`message.model`) |
| `dispatchAction` | ✅ `chat/turnStarted`, `chat/turnCancelled`, `chat/toolCallConfirmed`, `chat/inputCompleted`, `session/configChanged`, `session/isReadChanged`, `session/isArchivedChanged` |
| read and archived | ✅ kept per session and told to every client - including for rows no agent is running for |
| connection token | ✅ `--connection-token`, `--connection-token-file`, refused at the handshake |
| `fetchTurns` | ✅ newest 50 in the snapshot, a cursor for the rest |
| `completions` | ✅ `/` against the session's commands, falling back to the harness-wide list |
| queued messages | ✅ held by the host and started as the next turn, named on the turn that consumed it |
| what it is doing | ✅ `chat/activityChanged` and the session's mirror of it, so a catalogue row says which session is busy with what |
| token counts, retitling | ✅ `chat/usage` before the turn completes, `session/titleChanged` when it gets one |
| file changes | ⬜ no changeset channel, so the changes screen is always empty |
| toggling an MCP server | ✅ through the CLI, then read back - switching on one that is not ready reconnects it, which is how signing in happens |
| toggling a skill or prompt | ✅ refused out loud: the CLI has no runtime switch, and the list goes back out so the control returns to where it was |
| `resourceList` / `Read` / `Resolve` | ✅ read-only, and only inside the directories the host was told to serve |
| `@` completion | ✅ paths under the session's own directory, offered as a resource reference rather than the bytes |
| shared drafts | ✅ `chat/draftChanged`, so two people on one chat see each other typing |
| terminals | ✅ a shell in a served directory, over pipes - `isPty: false`, said rather than left to be discovered |
| several chats per session | ✅ `createChat` / `disposeChat`; each is its own agent process on one directory and one config |
| project and branch | ✅ `project` on every row from the path alone, and `_meta.git.branch` beside it when the host was given `gitBranches()` - re-read when a turn ends, and cached per *directory*, so a host with ninety-eight sessions in one repository asks git once |
| the write half of `resource*`, file changes | ⬜ see [ROADMAP.md](ROADMAP.md) |
| everything else | `-32601`, said rather than silently accepted |

Server-origin actions it emits: `session/ready`, `session/inputNeededSet` /
`Removed`, `chat/responsePart`, `chat/delta`, `chat/toolCallStart` / `Ready` /
`Complete`, `chat/reasoning`, `chat/inputRequested`, `chat/turnComplete` / `Cancelled`,
`chat/error`, `session/metaChanged` - plus `root/sessionAdded` / `Removed` /
`sessionSummaryChanged`
on the root channel.

Rules it is careful about, because each is a silent failure otherwise:

- **A part exists before it streams.** The protocol: *"The server MUST first
  emit a `chat/responsePart` to create the target part, then use
  [`chat/delta`] to append text to it."* A delta naming a part nobody opened
  appends to nothing.
- **The append action follows the part.** `chat/delta` is defined against a
  *markdown* part and `chat/reasoning` against a *reasoning* one, and the
  canonical reducer returns the part unchanged when they do not match. Sending
  thinking as a `chat/delta` therefore opens the part and never fills it - a
  thinking header with nothing under it, for as long as the model thinks.
- **The running turn is `activeTurn`, and is not in `turns`.** A client reading
  only the history shows an empty conversation for exactly as long as somebody
  is watching one happen.
- **A turn the client started is still said back.** The host reduces
  `chat/turnStarted` and re-emits it. Nothing in a client applies what it sent
  itself, so a host that reduced it privately goes on to emit
  `chat/responsePart` for a turn no client has - and the whole answer lands
  nowhere until somebody reopens the session and gets a fresh snapshot.
- **`chat/toolCallStart` creates the part; `chat/responsePart` must not.**
  The reducer appends a response part of its own for a starting tool call, so
  a host that announces the part as well puts every tool call in the
  transcript twice.
- **A tool call in the transcript says `confirmed`.** `chat/toolCallReady`
  without it means *pending confirmation*, and the whole conversation is then
  drawn as a queue of questions nobody asked. `canUseTool` is what asks, under
  the agent's own `toolUseID` - a confirmation with an id of the host's making
  is a second row for one call, answered under a name no client was given.
- **`serverSeq` moves with state, never with messages.** A snapshot is taken
  *at* a sequence number and every action after it carries a greater one, which
  is how a client knows it missed nothing.

A method this host does not serve answers `-32601`. A host that answers an
empty success to a method it lacks leaves the client waiting for state that is
never coming, which reads as a hang rather than as a missing feature.

## Layout

```
src/types/         Every shape, importing no runtime value. The contract.
src/rpc.ts         JSON-RPC framing. Holds no socket.
src/listen.ts      Accepts connections on Node, Bun or Deno.
src/host.ts        Channels, subscriptions, requests and state actions.
                   Imports no backend.
src/agents/        Backends. `claude.ts` is the one that ships.
src/catalog.ts     Claude's sessions, as rows a host can list.
src/transcript.ts  A past Claude session read as turns, and the paging helpers.
src/probe.ts       One CLI at startup, to learn what Claude offers.
src/session.ts     One live Claude session, reduced into its channels' state.
src/main.ts        The daemon: argv, the filesystem and stdout.
src/index.ts       The library entry point.
examples/echo/     A backend written from nothing, and a host serving it.
```

Everything below `src/host.ts` in that list is Claude's, reached only through
`Agent`. `ahpc` makes the same translation in-process for its `--claude` mode,
so the two are currently duplicated.

**Where that resolves.** The client's `claudeHost` was the prototype and this
is the thing it was a prototype of. Once this daemon is complete, `--claude`
should mean *spawn one of these and connect to it* - which deletes the client's
copy of the translation rather than extracting it into a package neither repo
naturally owns. Until then the duplicate is deliberate and small enough to
carry.

## Checking it

`npm test` drives the host with no socket - `accept` takes a peer and returns a
handler, so everything the protocol decides is testable without a network.

The other check is the one that matters: the same client, rendering the same
screen, against `--claude` (in-process) and `--host ws://…` (this daemon). If
they differ, one of them is wrong.
