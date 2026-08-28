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

Then point a client at it:

```bash
ahpc --host ws://127.0.0.1:9187
```

`--path` is the directory the host's sessions live in, on **this** machine.
A client names paths in the host's filesystem, never its own; a second
directory is a second daemon rather than a flag, because the working directory
is what the catalogue *is*.

## What it serves

| Method | |
| --- | --- |
| `initialize` | ✅ version negotiation, `initialSubscriptions` snapshots |
| `ping` | ✅ |
| `subscribe` / `unsubscribe` | ✅ root, session and chat channels |
| `listSessions` | ✅ most-recently-modified first, live sessions included |
| `resolveSessionConfig` | ✅ permission mode |
| capabilities | ✅ models, slash commands, subagents, MCP servers - read from the CLI's control protocol, so they are known before any turn |
| `createSession` / `disposeSession` | ✅ |
| past sessions | ✅ every catalogue row opens from its transcript - a file read, no CLI - and is **resumed** when somebody starts a turn on it |
| model selection | ✅ on the session (`session/configChanged`) and on a turn (`message.model`) |
| `dispatchAction` | ✅ `chat/turnStarted`, `chat/turnCancelled`, `chat/toolCallConfirmed`, `chat/inputCompleted` |
| `fetchTurns` | ✅ newest 50 in the snapshot, a cursor for the rest |
| `completions` | ✅ `/` against the session's commands, falling back to the harness-wide list |
| `@` completion, terminals, resources, changesets | ⬜ see [ROADMAP.md](ROADMAP.md) |
| everything else | `-32601`, said rather than silently accepted |

Server-origin actions it emits: `session/ready`, `session/inputNeededSet` /
`Removed`, `chat/responsePart`, `chat/delta`, `chat/toolCallStart` / `Ready` /
`Complete`, `chat/inputRequested`, `chat/turnComplete` / `Cancelled`,
`chat/error` - plus `root/sessionAdded` / `Removed` / `sessionSummaryChanged`
on the root channel.

Three rules it is careful about, because each is a silent failure otherwise:

- **A part exists before it streams.** The protocol: *"The server MUST first
  emit a `chat/responsePart` to create the target part, then use
  [`chat/delta`] to append text to it."* A delta naming a part nobody opened
  appends to nothing.
- **The running turn is `activeTurn`, and is not in `turns`.** A client reading
  only the history shows an empty conversation for exactly as long as somebody
  is watching one happen.
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
src/catalog.ts     The agent's sessions, as the protocol's catalogue.
src/transcript.ts  A past session read as turns, and the paging helpers.
src/probe.ts       One agent process at startup, to learn what is offered.
src/session.ts     One live session, reduced into its channels' state.
src/host.ts        Channels, subscriptions, requests and state actions.
src/main.ts        The daemon: a port and a directory.
src/index.ts       The library entry point.
```

`catalog.ts` and `session.ts` translate the agent SDK's frames into the
protocol's shapes. `ahpc` makes the same translation in-process for its
`--claude` mode, so the two are currently duplicated.

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
