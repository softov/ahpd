# Writing an agent

An **agent** is a backend: the thing that answers when somebody says something.
It is not the host and it is not a client.

| | |
| --- | --- |
| the **client** | draws the conversation. `ahpc`, VS Code |
| the **host** | speaks AHP: channels, subscriptions, snapshots, sequence numbers, paging. `createHost` |
| the **agent** | answers. `claude()` is one, `echo` and `notes` are two more |

An agent says what it is called, what a session of its kind can be configured
with, which sessions it already has, and how to start one. Everything the
protocol requires stays the host's, and nothing in the host knows what any agent
is - `createHost` imports no backend at all.

[packages/server/src/types/agent.ts](../packages/server/src/types/agent.ts) and
[packages/agent-claude/src/session.ts](../packages/agent-claude/src/session.ts) are the whole contract. Nothing
in `packages/server/src/types/` imports a runtime value, so it can be read without loading any
of this.

## The smallest one

```ts
import type { Agent, Bag, Session, Start } from 'ahpd';

export function shout(): Agent {
  return {
    provider: 'shout',
    displayName: 'Shout',
    schema: () => ({ properties: {} }),
    defaults: () => ({}),
    create: (start) => converse(start),
  };
}

function converse(start: Start): Session {
  const turns: Bag[] = [];
  let active: Bag | undefined;

  return {
    uri: start.uri,
    chatUri: start.chatUri,

    begin: (turnId, text) => {
      // 1. Say the turn back. The client dispatched it; nothing in a client
      //    applies what it sent itself.
      const startedAt = new Date().toISOString();
      active = { id: turnId, startedAt, message: { text }, responseParts: [] };
      start.emit('chat', { type: 'chat/turnStarted', turnId, startedAt, message: { text } });

      // 2. Open a part before anything streams into it.
      const part: Bag = { id: `${turnId}:0`, kind: 'markdown', content: text.toUpperCase() };
      (active.responseParts as Bag[]).push(part);
      start.emit('chat', { type: 'chat/responsePart', turnId, part });

      // 3. End it, and move it out of `activeTurn` and into `turns`.
      turns.push(active);
      active = undefined;
      start.emit('chat', { type: 'chat/turnComplete', turnId, duration: 0 });
    },

    // …and the rest of `Session`
  } as Session;
}
```

Register it like any other, and the host cannot tell it from `claude()`:

```ts
const host = createHost({ path, agents: [shout()] });
```

## `Agent`, in the order the host asks

| | | |
| --- | --- | --- |
| `provider`, `displayName` | Who you are. `provider` is what a client names in `createSession`, so it must be unique among a host's agents | required |
| `schema()`, `defaults()` | What a session can be told to do differently | required |
| `create(start)` | Start one. Returns a `Session` | required |
| `description` | One line about what this backend is | optional |
| `probe()` | What you offer, asked once at startup | optional |
| `directories()` | The directories you will work in | optional |
| `list()` | Sessions somebody can browse | optional |
| `transcript(id)` | One of those, as turns - a read, with nothing started | optional |
| `protectedResources` | RFC 9728 metadata for anything you can be given a token for | optional |

What you leave out is a real answer rather than a gap: no `list` means no
sessions to browse, no `probe` means no models until a session of yours reports
some.

**One schema, not two.** `schema()` is used before a session exists *and* by
every session that does. Two copies drift, and a composer then offers different
controls on the new-session screen than in the session.

**`probe()` is asked at startup, before any session.** The models to pick from
and the commands behind a slash are what a composer draws itself from, so
answering late means offering them only once the conversation has started -
which is exactly too late.

**`transcript(id)` is what makes a catalogue row openable.** It is a read with
nothing started; `create` is called with `resume` only when somebody actually
says something to that row.

## `Session`

One conversation, across two channels. The host owns the channels and the
sequence numbers; the session owns the state they carry and says what changed.

`emit('chat', …)` addresses the chat channel and `emit('session', …)` the
session channel. A session never needs to know either URI to do it.

| group | members |
| --- | --- |
| identity | `uri`, `chatUri`, `agentId()` |
| state for a snapshot | `sessionState()`, `chatState()`, `allTurns()`, `status()`, `activity()`, `title()`, `modifiedAt()`, `workingDirectories()`, `models()`, `customizations()` |
| the turn | `begin(turnId, text, model?)`, `cancel(turnId)` |
| the queue and the draft | `queue(id, text, model?)`, `unqueue(id)`, `reorder(order)`, `setDraft(text)` |
| being asked | `confirm(toolCallId, approved)`, `answer(requestId, accepted, answers)` |
| the controls | `setModel`, `setPermissionMode`, `setEffort`, `setOutputStyle`, `setConfig`, `settings()` |
| customizations | `setCustomizationEnabled`, `startMcpServer`, `stopMcpServer` |
| the end | `close()` |

Every setter returns false for a value it will not take, and **false is a real
answer**: a control that reports success and changes nothing is worse than one
that refuses, because a client then draws a session in a state it is not in.

### Config keys

`permissionMode`, `model`, `effortLevel` and `outputStyle` have setters of their
own, because they mean something to the *host*: it applies a permission mode and
an output style to every chat in a session, not only the one that was asked.

Everything else you publish in `schema()` arrives at `setConfig(key, value)`. A
backend without `setConfig` takes none of them - and a client draws its controls
from that schema, so a key that reaches nothing is a control somebody moves that
changes the session not at all.

```ts
setConfig: (key, value) => {
  if (key !== 'ask') return false;
  if (value !== 'writes' && value !== 'always' && value !== 'never') return false;
  settings.ask = value;
  return true;
},
```

### Being asked

Two things stop a turn and wait for a person, and they are answered by different
methods:

| | `Session` method | announced by |
| --- | --- | --- |
| a tool call waiting to be allowed | `confirm(toolCallId, approved)` | `session/inputNeededSet` with `kind: 'toolConfirmation'` |
| a question that is not about a tool | `answer(requestId, accepted, answers)` | `session/inputNeededSet` with `kind: 'chatInput'` |

Hold them in a **map keyed by id**, never in one slot. A backend that can ask
twice will: an agent firing two tools in parallel asks twice before either is
answered, and with a single slot the second overwrites the first - the first
then waits for an answer nobody can give any more, which from the other end is a
person pressing Approve and nothing at all happening.

`cancel` and `close` must settle everything parked. A cancelled turn that leaves
a question standing is a session reporting `InputNeeded` for the rest of its
life over a promise nothing will ever settle.

## The rules that fail silently

These are the ones that produce a wrong screen rather than an error. Each cost
this repository a bug.

| | |
| --- | --- |
| **Say the turn back** | `chat/turnStarted` arrives from the client and you emit it again. Nothing in a client applies what it sent itself, so a backend that reduced it privately goes on to emit response parts for a turn no client has - and the whole answer lands nowhere until somebody reopens the session |
| **A part exists before it streams** | `chat/responsePart` creates it, `chat/delta` appends to it. A delta naming a part nobody opened appends to nothing |
| **The append action follows the part** | `chat/delta` is defined against a *markdown* part and `chat/reasoning` against a *reasoning* one, and a client's reducer returns the part unchanged when they do not match. Thinking sent as a `chat/delta` opens a part and never fills it |
| **The running turn is `activeTurn`** | and is not in `turns`. It moves across when it completes. A client reading only the history shows an empty conversation for exactly as long as somebody is watching one happen |
| **One action ends a turn** | `chat/turnComplete` when it worked, `chat/error` when it did not - and `chat/error` *is* the ending, carrying `turnId`, `duration` and the error part it appends. Sending both puts the turn in the history as a success |
| **`duration` is required and required in earnest** | on `turnComplete`, `turnCancelled` and `error`. A client clamps it with `Math.max(0, duration)`, so an absent one is `NaN` rather than a missing number, and the reducer throws building a timestamp out of it - which stops that client reading the channel at all |
| **`chat/toolCallStart` creates its own part** | Do not also send `chat/responsePart` for a tool call, or it appears twice. `chat/inputRequested` does the same for a question |
| **A tool call that is not asking says `confirmed`** | `chat/toolCallReady` with `confirmed: 'not-needed'` runs; the same action without it waits. Leave it off and a record of things that already ran is drawn as a queue of questions nobody put |
| **The result is one object** | `chat/toolCallComplete` carries `result: { success, pastTenseMessage, content?, error? }`. A client spreads `action.result` over the call and reads nothing else, so a `content` beside it is dropped without a word |
| **A failed tool is `completed`** | `ToolCallStatus` has no `failed`. What went wrong is `result.success` and `result.error` |

[docs/AHP.md](AHP.md) has the same ground from the host's side, with what this
host serves and what it does not.

## The two examples

Both are complete, both run, and `createHost` cannot tell either from `claude()`.

| | |
| --- | --- |
| [examples/echo](../examples/echo) | The whole of `Agent` and `Session` with nothing behind it - no model, no subprocess, about two hundred lines. Its README is the contract in the order the host asks for it, and the three rules a session without tools has to keep |
| [examples/notes](../examples/notes) | The same with tools: one that runs without asking, one that waits to be allowed, and a question that is not about a tool. Its README is the rules for asking |

```bash
pnpm echo  -- --port 9200
pnpm notes -- --port 9201
ahpc --host ws://127.0.0.1:9201
```

## Checking one

Drive it through `createHost` the way a client does, then replay what it emitted
through the protocol package's own `chatReducer` and `sessionReducer` -
[test/notes.test.ts](../test/notes.test.ts) is the worked version.

Reading your own state back is you agreeing with yourself: a field under the
wrong name, or beside its action rather than inside it, round-trips perfectly
and is still unreadable to anybody else. The reducer is what a client actually
runs.
