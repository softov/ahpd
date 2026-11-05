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

[packages/sdk/src/types/agent.ts](../../packages/sdk/src/types/agent.ts) and
[packages/agent-claude/src/session.ts](../../packages/agent-claude/src/session.ts) are the whole contract. Nothing
in `packages/sdk/src/types/` imports a runtime value, so it can be read without loading any
of this.

## The smallest one

```ts
import type { Agent, Bag, Session, Start } from '@ahpd/sdk';

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

    sendMessage: (turnId, text) => {
      // 1. The host said the turn's start; it is the session's turn from here.
      active = { id: turnId, startedAt: new Date().toISOString(), message: { text }, responseParts: [] };

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
| `completions` | Answers for a key of your own `schema()`, drawn as a picker | optional |
| `create(start)` | Start one. Returns a `Session` | required |
| `description` | One line about what this backend is | optional |
| `probe()` | What you offer, asked once at startup: the models, the commands, and the account your harness bills to | optional |
| `probeChanged(onChange)` | Call `onChange` when what `probe()` answers may have changed. The host probes again, and stops the calls when it closes or a fold removes you | optional |
| `directories()` | The directories you will work in | optional |
| `list()` | Sessions somebody can browse | optional |
| `find(id, at?)` | One of those, on its own, for an id the host has not got | optional |
| `transcript(id, at?, outputs?)` | One of those, as turns - a read, with nothing started | optional |
| `subagents(id, turns?, at?)` | The worker chats one of those holds - a read, with nothing started | optional |
| `protectedResources` | RFC 9728 metadata for anything you can be given a token for | optional |
| `stateFile(id, directory)` | Where your own record of a session is, for the window to open or pack into a bug report | optional |
| `endpoints()` | What to probe when the network is in question | optional |

What you leave out is a real answer rather than a gap: no `list` means no
sessions to browse, no `probe` means no models until a session of yours reports
some.

**One schema, not two.** `schema()` is used before a session exists *and* by
every session that does. Two copies drift, and a composer then offers different
controls on the new-session screen than in the session.

**`completions` is how a key of your own schema offers answers.** A property
with no `enum` reads as a fact somebody types, so a key whose values you already
know - the machine this session runs in, the account it bills to - reaches every
client as a text box. Map the key to an answerer and the host marks it
`enumDynamic` and asks you through `sessionConfigCompletions`, seeded once so a
client that has not asked still labels the value in force. The answerer is
reached only when the ask names your `provider`, so two backends with a key of
the same name do not answer for each other. A key you name here that `schema()`
does not declare is skipped and logged once.

**`probe()` is asked at startup, before any session.** The models to pick from
and the commands behind a slash are what a composer draws itself from, so
answering late means offering them only once the conversation has started -
which is exactly too late.

**`probe()` may answer with an `account` too.** It is the sign-in the harness
behind you bills to, in the shape of VS Code's `vscode.codexAccount`, and the
host publishes it on its root config for the connections that hold
`account:read`. Leaving it out is a real answer beside the rest: it is what a
backend that cannot say who is billed says, and what one that learns it later
says - an ACP server reports its own when a session opens, with
`Start.onAccount`, which takes the place of what this answered.

**`find(id)` is how a row the host is not holding is opened.** A link from
another machine, or a session written to disk after the last listing, is asked
by id rather than by listing everything again - the row it gives back has to be
the row `list` gives for the same session, or a client is sent a summary that
did not change. Leave it out and one id the catalogue does not have costs a
pass over every session you can list, so a backend that can list should say how
to find one.

**`transcript(id)` is what makes a catalogue row openable.** It is a read with
nothing started; `create` is called with `resume` only when somebody actually
says something to that row. A call your record holds no result for never
finished: answer it `cancelled` with `reason: 'skipped'`, which is how the
protocol's reducer holds a call still open when its turn ends, and the turn
holding it `cancelled`, as the reference reads a Claude transcript back
([claudeReplayMapper.ts](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L492-L514)).
What a turn used is what its live turn said it used.

**`at` says where the session ran.** It is `{ workingDirectory }`, a path,
when the host recorded the session's folder, and absent when it did not.
Look for the session there first and in your own directories after, so a
session that ran in a subfolder, a worktree or any folder you do not serve
still opens after a restart.

**`outputs` is what the host kept for that chat's terminals.** A tool call may
name a terminal, and a client opens it for as long as the chat lasts, with no
process behind it once it has exited. An output no terminal of the host's
printed - a file your harness saved for a result too large to send - is kept
with `start.terminalOutputs.keep(key, output, exitCode)`, and the call names
`start.terminalOutputs.uri(key)`; a subscribe to that name is answered with an
exited terminal holding the output ([TERMINALS.md](TERMINALS.md#a-terminal-a-tool-result-names)).
A transcript holds what the model was sent and not what a client was shown, so
a call read back names its terminal again where `outputs.has(key)` says the
output is kept. Both are absent where the session store keeps no folder for the
session, and a `!` command's terminal or one opened with `start.terminals`
needs neither: the host keeps what those print itself.

**A turn is read back under the id your transcript gives it.** A turn a client
sends has the client's id while it runs. A `!` command's turn is the host's and
in no transcript of yours, so the host keeps it and puts it back after the turn
it followed, found by that turn's id in what `transcript` answers. A backend
whose transcript names turns its own way says what it wrote a turn down as with
`start.onTurnRecorded(turnId, transcriptId)`, as Claude names a turn by the
CLI's uuid and pi by its prompt's entry. One that keeps the id it was given, as
cofold stores a prompt under the turn's id, says nothing.

**A turn is read back as it began.** The host records, in the session's folder
under the chat, the transcript id each turn began under: its own id as it
starts, whether a client sent it, the host took it up from the chat's queue, or
your backend opened it itself, and what `onTurnRecorded` says. A read puts a turn your
transcript holds and the record does not inside the turn before it, and so does
a turn recorded as the same turn as the one before, which is that turn written
down again: Claude's CLI writes a steering message it runs after the turn's last
answer as a prompt of its own, and a retried turn's prompt a second time. The
joined turn keeps the first one's id and message, takes both answers, ends as
the later one ended, and spent what both spent. Turns before the first one the
record holds stay as they are, so a chat from before the record, or one on a
store with no session folder, reads as your transcript gives it.

## `Session`

One conversation, across two channels. The host owns the channels and the
sequence numbers; the session owns the state they carry and says what changed.

`emit('chat', …)` addresses the chat channel and `emit('session', …)` the
session channel. A session never needs to know either URI to do it.

| group | members |
| --- | --- |
| identity | `uri`, `chatUri`, `agentId()` |
| state for a snapshot | `sessionState()`, `chatState()`, `allTurns()`, `status()`, `activity()`, `title()`, `modifiedAt()`, `workingDirectories()`, `models()`, `customizations()` |
| the turn | `sendMessage(turnId, text, from?, attachments?, options?)`, `changeModel(model)`, `changeAgent(agent?)`, `abort()`, `resumeTurn?(turnId)`, `stopWorker?(toolCallId)` |
| steering | `sendSteeringMessage?(message)`, `withdrawSteeringMessage?(id)` |
| the draft | `setDraft(text)` |
| being asked | `confirm(toolCallId, approved, optionId?)`, `answer(requestId, accepted, answers)` |
| the controls | `setConfig(key, value)`, `settings()` |
| customizations | `setCustomizationEnabled`, `startMcpServer`, `stopMcpServer` |
| another host's session | `relay?(channel, action, origin?)` |
| the end | `close()` |

The turn's calls are the ones VS Code's host makes of an agent, under the same
names
([agent.ts L1303-L1328](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1303-L1328)).
The host says a turn's start, the client's own or its own for a turn it begins,
then hands the turn's model with `changeModel` where your `models()` offers it,
its agent with `changeAgent`, and its prompt with `sendMessage`. A
`changeModel` that rejects ends the turn in a `modelSelectionFailed` error, one
to `changeAgent` is logged and the turn is sent all the same, and a
`sendMessage` that rejects ends it in a `sendFailed` error with your words. A
turn stopped while the host prepared it is never sent, and one stopped while
you prepare it is yours to leave unsent: check for the stop before the prompt
goes out.

A turn handed while another runs is a send of its own, which you run once the
work in front of it is done, as VS Code's agents run each send after the one
before it; `abort` drops every turn handed behind the one it stops. The turn's
`options.instructions()` is what the host has to say on that turn, asked when
the turn begins, and goes into that turn's prompt, as each of VS Code's agents
puts the instructions its host contributes for a send
([agentSideEffects.ts L2281-L2288](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2281-L2288)).

The chat's pending messages, queued and steering, are the host's, as VS Code's
host holds them
([queueDrainContribution.ts L29-L326](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L29-L326)):
the host says them, starts the head of the queue as a turn it sends you with
`sendMessage`, and hands you steering while a turn runs.

`sendSteeringMessage` answers as VS Code's agents answer
([agent.ts L1943-L1955](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1943-L1955)):
`true` when you took the message, `false` when you cannot take it yet, which
has the host hand it again on the turn's next action, and a promise of `false`
when the turn it was meant for ended first, handing it back, which has the host
steer the turn that runs then with it or run it next. `withdrawSteeringMessage`
takes back one you took that the model has not read, when a client removes it.

A backend that is the proxy of a session another host runs answers `relay`,
as the nested proxy of a session in a machine does: a client's action on the
session's turns, its chat's draft, pending messages and bits, or its MCP
servers is handed to `relay` as the client sent it, and to nothing else, a
start once the host has admitted it, as a VS Code relay forwards each frame
as sent
([relayTransport.ts L123-L137](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/relayTransport.ts#L123-L137)).
The host running the session applies it and echoes it, and you hand that echo,
or its refusal, to `start.answer` under the client's origin, which answers the
client. A message the host queues for the chat is handed to `relay` with no
origin, said already, for the host there to run.

### Config keys

Every key a client sets arrives at `setConfig(key, value)`, the keys you publish
in `schema()` among them. The host reads the schema for how a key behaves, and
applies a key the schema does not scope to one chat to every chat in the session.
A backend without `setConfig` takes none of them - and a client draws its
controls from that schema, so a key that reaches nothing is a control somebody
moves that changes the session not at all.

The host checks a change against the schema and says it in the client's own
keys, then hands each key to `setConfig`, as VS Code's host says a client's
config action and then applies it to its agents
([agentService.ts L13576-L13679](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13576-L13679)).
`setConfig` answers `true` for a value taken as it was sent, or a sentence in
your words for one you could not take, which the host logs: the change stands as
every client was told it.

```ts
setConfig: (key, value) => {
  if (key !== 'ask') return `${key} is not a config key this backend takes`;
  if (value !== 'writes' && value !== 'always' && value !== 'never') return `ask takes writes, always or never`;
  settings.ask = value;
  return true;
},
```

### Being asked

Two things stop a turn and wait for a person, and they are answered by different
methods:

| | `Session` method | announced by |
| --- | --- | --- |
| a tool call waiting to be allowed | `confirm(toolCallId, approved, optionId?)` | `session/inputNeededSet` with `kind: 'toolConfirmation'` |
| a question that is not about a tool | `answer(requestId, accepted, answers)` | `session/inputNeededSet` with `kind: 'chatInput'` |

A confirmation may offer the agent's own choices as `options` on the call's `chat/toolCallReady` and on the entry's `toolCall`.
`optionId` is the `id` of the one the person picked, from the client's `selectedOptionId`, and is absent when none was.
Say it back as `selectedOptionId` on the `chat/toolCallConfirmed` the backend emits, so the call records which choice was made.

The host checks a confirmation and an answer against the chat's state before it calls either: a call pending a confirmation, a request open in the running turn.
`answer` returns false for a request the session is not waiting on.
The host says the `chat/inputCompleted` back to every client of the chat, so the backend does not emit it.
A `confirm` the backend has no question for returns false, and the host says the decision back itself.

Hold them in a **map keyed by id**, never in one slot. A backend that can ask
twice will: an agent firing two tools in parallel asks twice before either is
answered, and with a single slot the second overwrites the first - the first
then waits for an answer nobody can give any more, which from the other end is a
person pressing Approve and nothing at all happening.

`abort` and `close` must settle everything parked. A stopped turn that leaves
a question standing is a session reporting `InputNeeded` for the rest of its
life over a promise nothing will ever settle.

The host calls `abort` when a client's stop names the turn the chat runs, once
it has said the stop. A stop that names another turn or none, and a stop on a
chat with no turn running, goes to every client of the chat as the client's own
action and reaches no backend.

### A client's action is the host's to say

The host says a client's action itself, as the client sent it and with its
origin, once its own checks of it have passed and before it calls the method
that hands it to the session: the echo the client holds its action pending for.
Everything a session emits is the host's own action, said with no origin, as
[VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13654-L13679)
says a client's action and then runs the side effect that reaches its agent. A
start a session says of a turn the chat holds already is not said again, since
a second start would open the turn again in every client's state. Of the rest,
an action of another turn while one runs is dropped, and with none running, a
completion of a turn a stop ended, as
[VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L900-L963)
drops its agents' stale actions; anything else goes out, and the protocol's
reducer leaves what no longer applies as it was.

## The rules that fail silently

These are the ones that produce a wrong screen rather than an error. Each cost
this repository a bug.

| | |
| --- | --- |
| **Say a turn you start** | A turn handed with `sendMessage` was said by the host before it, a queued message the host takes up among them. A turn the session starts of its own accord is the session's to say before its first part: nothing in a client applies a turn nobody said, so response parts for it land nowhere until somebody reopens the session |
| **A part exists before it streams** | `chat/responsePart` creates it, `chat/delta` appends to it. A delta naming a part nobody opened appends to nothing |
| **The append action follows the part** | `chat/delta` is defined against a *markdown* part and `chat/reasoning` against a *reasoning* one, and a client's reducer returns the part unchanged when they do not match. Thinking sent as a `chat/delta` opens a part and never fills it |
| **The running turn is `activeTurn`** | and is not in `turns`. It moves across when it completes. A client reading only the history shows an empty conversation for exactly as long as somebody is watching one happen |
| **One action ends a turn** | `chat/turnComplete` when it worked, `chat/error` when it did not - and `chat/error` *is* the ending, carrying `turnId`, `duration` and the error part it appends. Sending both puts the turn in the history as a success |
| **`duration` is required and required in earnest** | on `turnComplete`, `turnCancelled` and `error`. A client clamps it with `Math.max(0, duration)`, so an absent one is `NaN` rather than a missing number, and the reducer throws building a timestamp out of it - which stops that client reading the channel at all |
| **`chat/toolCallStart` creates its own part** | Do not also send `chat/responsePart` for a tool call, or it appears twice. `chat/inputRequested` does the same for a question |
| **A tool call that is not asking says `confirmed`** | `chat/toolCallReady` with `confirmed: 'not-needed'` runs; the same action without it waits. Leave it off and a record of things that already ran is drawn as a queue of questions nobody put |
| **The result is one object** | `chat/toolCallComplete` carries `result: { success, pastTenseMessage, content?, error? }`. A client spreads `action.result` over the call and reads nothing else, so a `content` beside it is dropped without a word |
| **A failed tool is `completed`** | `ToolCallStatus` has no `failed`. What went wrong is `result.success` and `result.error` |

[docs/sdk/AHP.md](AHP.md) has the same ground from the host's side, with what this
host serves and what it does not.

## The two examples

Both are complete, both run, and `createHost` cannot tell either from `claude()`.

| | |
| --- | --- |
| [examples/echo](../../examples/echo) | The whole of `Agent` and `Session` with nothing behind it - no model, no subprocess, about two hundred lines. Its README is the contract in the order the host asks for it, and the three rules a session without tools has to keep |
| [examples/notes](../../examples/notes) | The same with tools: one that runs without asking, one that waits to be allowed, and a question that is not about a tool. Its README is the rules for asking |

```bash
pnpm echo  -- --port 9200
pnpm notes -- --port 9201
ahpc --host ws://127.0.0.1:9201
```

## Checking one

Drive it through `createHost` the way a client does, then replay what it emitted
through the protocol package's own `chatReducer` and `sessionReducer` -
[packages/sdk/test/notes.test.ts](../../packages/sdk/test/notes.test.ts) is the worked version.

Reading your own state back is you agreeing with yourself: a field under the
wrong name, or beside its action rather than inside it, round-trips perfectly
and is still unreadable to anybody else. The reducer is what a client actually
runs.
