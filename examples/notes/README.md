# A backend that stops and asks

The rules below are the ones about *asking*.
[docs/AGENT.md](../../docs/AGENT.md) is the `Agent` and `Session` contract in
full; [docs/AHP.md](../../docs/AHP.md) is the same ground as protocol
compatibility.


[`examples/echo`](../echo) is the whole of `Agent` with nothing behind it: it
says back what you said, and because nothing it does needs permission,
`confirm` and `answer` are empty there. This is the other half. It keeps notes
in a directory, reads them with a tool that never asks and writes them with one
that does - and when you leave out which note you meant, it asks a question
that is not about a tool at all.

```bash
pnpm install
pnpm notes -- --port 9201      # from source, restarts on save
pnpm notes:bun -- --port 9201  # the same, on Bun

# then, from anywhere
ahpc --host ws://127.0.0.1:9201
```

Two things it does:

```
read <name>            reads one. Leave the name out and it asks which
write <name> <text>    writes one. It asks before it does
```

Notes live in `./notes`, made on demand. `--path` puts them somewhere else.
Set **Ask before** on the composer to `Everything` or `Nothing` and the same
two commands stop asking, or start.

## What is here that echo does not have

`main.ts` is echo's, unchanged - the same `createHost` call with a different
backend in it. Everything below is in `agent.ts`, and `runTool` and `ask` are
the two shapes worth taking away.

### A tool call is held, not announced

`chat/toolCallStart` **creates the response part** on the client side. So the
part goes into `responseParts` for the snapshot and is never sent with
`chat/responsePart` - doing both puts the same call in the transcript twice,
once as the host's part and once as the reducer's own.

`chat/inputRequested` does the same thing for a question. Same rule, same
mistake available.

### Asking, and not asking, are the same action

```ts
emit('chat', { type: 'chat/toolCallReady', turnId, toolCallId,
  invocationMessage, toolInput,
  confirmed: 'not-needed',      // runs
});

emit('chat', { type: 'chat/toolCallReady', turnId, toolCallId,
  invocationMessage, toolInput,
  confirmationTitle: 'Write shopping.md?',   // waits
});
```

`confirmed: 'not-needed'` is the whole difference. Leave it off a tool that is
not asking and every call in the transcript moves to `pending-confirmation`,
and a record of things that already ran is drawn as a queue of questions nobody
put.

### The result is one object

```ts
emit('chat', { type: 'chat/toolCallComplete', turnId, toolCallId,
  result: {
    success: true,
    pastTenseMessage: 'Wrote 15 bytes to shopping.md',
    content: [{ type: 'text', text: '…' }],
  },
});
```

`success` and `pastTenseMessage` are required, and `content` belongs *inside*
`result`. A client's reducer spreads `action.result` over the tool call and
reads nothing else from the action, so a `content` alongside it is dropped
without a word and the tool's output never reaches a screen.

A tool that *failed* is `completed` too, and says so in its result.
`ToolCallStatus` has seven values - `streaming`, `pending-confirmation`,
`running`, `auth-required`, `pending-result-confirmation`, `completed`,
`cancelled` - and `failed` is not one of them.

### The session says what is wanted, in two kinds

A client watching only the catalogue never subscribed to the chat, and still
has to be able to show that this session is waiting for somebody.
`session/inputNeededSet` carries `request` and adds *or updates* the entry with
that id; `session/inputNeededRemoved` carries the `id` to drop.

| kind | what it is | how it is answered |
| --- | --- | --- |
| `toolConfirmation` | a tool call waiting to be allowed | `chat/toolCallConfirmed`, by `toolCall.toolCallId` |
| `chatInput` | a question the agent asked | `chat/inputCompleted`, by `request.id` |

Both are held in a **map keyed by id**, never in one slot. A backend that can
ask twice will: with a single slot the second question overwrites the first,
and the first then waits for an answer nobody can give any more - which, from
the other end, is a person pressing Approve and nothing at all happening.

`inputNeeded` is also in the session snapshot, and it has to be: the action
that announced the question is behind a client that opened the session after it
was asked.

### Say it back

`chat/toolCallConfirmed` and `chat/inputCompleted` are dispatched by a client
and emitted again by the backend. Nothing in a client applies what it sent
itself, so without the echo the row stays `pending-confirmation` on every
screen watching it - including the one that just answered.

### Cancelling answers as well as stops

`cancel` settles every parked question before it ends the turn. A cancelled
turn that leaves one standing is a session reporting `InputNeeded` for the rest
of its life over a promise nothing will ever settle. `close` does the same, for
the same reason.

`chat/turnCancelled` carries a **required** `duration`. A client's reducer
clamps it with `Math.max(0, duration)` and adds it to the turn's start, so an
absent one is `NaN` and the reducer throws building a timestamp - which stops
that client reading the channel at all, over a turn somebody merely cancelled.

### One config key, of this backend's own invention

The schema key is `ask` and the values are `writes`, `always`, `never`. Nothing
in the protocol or the host has heard of any of them, and it is still
`sessionMutable: true`.

`permissionMode`, `model`, `effortLevel` and `outputStyle` have setters of their
own on `Session`, because they mean something to the host - it applies a
permission mode and an output style to *every* chat in a session, not only the
one that was asked. Every other key a backend publishes in `schema()` arrives at
`setConfig(key, value)`, which is what makes a control a client drew from that
schema move something when somebody moves it.

```ts
setConfig: (key, value) => {
  if (key !== 'ask') return false;
  if (value !== 'writes' && value !== 'always' && value !== 'never') return false;
  settings.ask = value;
  return true;
},
```

False is a real answer for a key or a value this backend does not have: a setter
that reported success and changed nothing would leave a client showing a session
in a mode it is not in.

## What keeps it honest

[`test/notes.test.ts`](../../test/notes.test.ts) drives this through
`createHost` the way a client does, and then reduces every action it emitted
with the protocol's own `chatReducer` and `sessionReducer`.

That second part is the point. Reading state back out of this host's own
snapshot is the host agreeing with itself; the reducer is the other
implementation, and it is what a client actually runs. Every shape defect this
repository has had - a bare `inputNeeded`, a result beside its action rather
than inside it, a cancelled turn with no duration - was invisible to a host
reading its own state, and is loud there.
