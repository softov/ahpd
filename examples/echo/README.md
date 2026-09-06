# A host of your own

[docs/AGENT.md](../../docs/AGENT.md) is the contract in reference form; this is
the shortest thing that satisfies it, running.


`ahpd` is a daemon that runs Claude Code, and the parts to build a host that
runs something else. This is the something else: a backend that answers by
saying it back, with no model and no subprocess behind it.

```bash
pnpm install
pnpm echo -- --port 9200      # from source, restarts on save
pnpm echo:bun -- --port 9200  # the same, on Bun

# then, from anywhere
ahpc --host ws://127.0.0.1:9200
```

Type something. It says it back. Set **Voice** on the composer to `shouty` or
`backwards` and type again.

## What is actually here

Two files.

[`agent.ts`](agent.ts) is an `Agent`: what the backend is called, what it can
be configured with, which sessions it already has, and how to start one. It
imports nothing but types.

[`main.ts`](main.ts) hands it to `createHost` and puts a socket in front:

```ts
const host = createHost({
  path,
  agents: [echo({ path })],
});

await listen({ port: 9200 }, (peer) => host.accept(peer));
```

That is the whole registration. Version negotiation, snapshots, subscriptions,
sequence numbers, transcript paging, completions, read and archived flags -
all of it is the host's, and none of it changed to serve a backend it had
never heard of.

## What a host is *given*, which is a different contract

`agent.ts` is what a backend implements. `main.ts` shows the other half: the
four ports a host is handed, none of which `createHost` owns.

| port | what it is |
| --- | --- |
| `resources` | files a client may read, and what `@` completes into |
| `terminals` | how a shell is opened |
| `directories` | facts about a served directory - the branch it is on |
| `changes` | what the working tree has that HEAD does not |

Each is optional and independent, and a host given none of them still serves
the whole conversation - which is the point of them being ports rather than
imports. Leave one out and the commands behind it answer `-32601`, the same
answer this host gives for anything else it does not serve.

`gitBranches()` and `gitChanges()` are wired here even though echo is not a
git backend, because they describe the *directory*, not the agent: a host
serving a repository can say so whatever is answering in it.

## The contract, in the order the host asks

| | |
| --- | --- |
| `provider`, `displayName` | Who you are. `provider` is what a client names in `createSession`, so it must be unique among a host's agents |
| `schema()`, `defaults()` | What a session can be told to do differently. One schema, used before a session exists and by every session that does - two copies drift, and a composer then offers different controls on the new-session screen than in the session |
| `probe()` | What you offer, asked once at startup. Models and slash commands are what a composer draws itself from, so answering late means offering them only once the conversation has started |
| `list()` | Sessions somebody can browse |
| `transcript(id)` | One of those, as turns - a read, with nothing started. This is what makes a row openable; `create` is called with `resume` only when somebody says something to it |
| `create(start)` | Start one. Returns a `Session` |

Only `provider`, `displayName`, `schema`, `defaults` and `create` are
required. What you leave out is a real answer rather than a gap: no `list`
means no sessions to browse, no `probe` means no models until a session of
yours reports some.

## The rules a session has to keep

These are the ones that fail silently rather than loudly, so they are worth
reading before writing a backend. Each cost this repository a bug.

- **Say the turn back.** `chat/turnStarted` arrives from the client and you
  emit it again. Nothing in a client applies what it sent itself, so a
  backend that reduced it privately goes on to emit response parts for a turn
  no client has - and the whole answer lands nowhere until somebody reopens
  the session.
- **A part exists before it streams.** `chat/responsePart` creates it,
  `chat/delta` appends to it. A delta naming a part nobody opened appends to
  nothing.
- **The running turn is `activeTurn`, and is not in `turns`.** It moves across
  when it completes. A client reading only the history shows an empty
  conversation for exactly as long as somebody is watching one happen.
- **`chat/toolCallStart` creates its own part.** Do not also send
  `chat/responsePart` for a tool call, or it appears twice.
- **A tool call in the transcript says `confirmed`.** `chat/toolCallReady`
  without it means *pending confirmation*, and the conversation is then drawn
  as a queue of questions nobody asked.

`echo` has no tools, so it only has to keep the first three.
[`examples/notes`](../notes) keeps all five and is the next one to read: it has
tools, so `confirm` and `answer` are implemented there rather than left empty,
and its README is the rules for asking. `src/session.ts` keeps them against a
real harness.
