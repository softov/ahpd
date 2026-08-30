# What is next, and why

Ordered by what unblocks a client, not by what is interesting to build. Each
entry says what it costs a person today, because a roadmap that only lists
features cannot be argued with.

Each entry carries a **reference code** so a conversation, a commit or an issue
can name one without quoting it. `A-01-xx` is something missing; `A-02-xx` is
something wrong. The code belongs to the entry for as long as the entry exists
and is not reused after it is removed; a number that came back meaning
something else would make every older reference to it silently wrong.

What has shipped is not listed here. This file is what is left; `git log` is
what was done, and it says it in the words the change was made in.

Verified against a live daemon on 2026-08-29, and audited the same day against
the protocol's own `types/` - the action enum, the generated client/server
origin map, and the canonical reducers - rather than read off the prose.

---

# Missing

## A-01-01 - Acting on a changeset

All three scopes a session can be asked about are served:

```
<sessionUri>/changeset/session                everything this conversation changed
<sessionUri>/changeset/turn/{turnId}          what one turn changed
<sessionUri>/changeset/uncommitted            the working tree, against HEAD
```

The first two are captured rather than derived, which is the only way they can
be true: git says what a working tree looks like *now*, so a turn asked about
after two more have run would be handed their work as well. Both sides of every
file are read as the tool runs - `before` as the call is announced, `after`
when its result arrives - off the agent's own message stream rather than out of
a `PreToolUse` hook, because a hook is bypassable from a person's settings and
the stream is not.

What is left is *acting* on one. `invokeChangesetOperation` and the
`changeset/*` actions are unserved: this host computes a changeset and does
nothing to it. Committing, reverting and marking a file reviewed are each a
write to somebody's repository from a daemon that may be reached from another
machine, which is the same question the write half of `resource*` is waiting
on - see A-01-03a and A-01-03b, and note that `resourceRequest` is the shape
that would answer both.

Of the four scopes the protocol defines, only `compare/<a>/<b>` is left - a
diff between two turns. It needs nothing new: both turns' captures are already
held, and it is a subtraction over them.

One thing to know before trusting a `session` changeset: the captures live for
as long as the host does. A resumed session opens with none, because the turns
it is resuming happened in a process that has gone. The transcript still has
them and they could be replayed, which is a decision rather than a gap.

[REFERENCE.md](REFERENCE.md) says where the host that already does all of this
is checked out, and which files in it answered which question.

## A-01-03 - What is left of the protocol

The complete count, so the gap is a decision rather than an oversight. The
protocol defines **32 commands** and **96 state actions** (52 server-origin, 44
client-dispatchable). This host serves 19 commands and 48 actions.

**The thirteen commands not served** - and, at A-01-03h, two channels that
define no commands at all:

- **A-01-03a - The write half of `resource*`** - `resourceWrite`,
  `resourceDelete`, `resourceMkdir`, `resourceMove`, `resourceCopy`.
  Deliberate: a host that lets any connected client write anywhere is a
  different proposition from one that lets it read the project it is working
  on, and this daemon is meant to be reachable from another machine.
- **A-01-03b - `resourceRequest`** - the access handshake, `Client ↔ Server`,
  by which a peer asks for read or write on a resource and is answered
  `-32009` or granted. It is the negotiated form of the refusal above, and the
  honest way to open the write half later: granted per resource rather than by
  serving the commands to everyone.
- **A-01-03c - `authenticate`** - the client fetches a token and pushes it. The
  SDK has nowhere to put one, so this host serves the *gesture* - switching on
  an MCP server that is not ready reconnects it, which is how somebody signs in
  - and not the token.
- **A-01-03d - `sessionConfigCompletions`** - config values that need looking
  up. Every key this host offers is an enum.
- **A-01-03e - `invokeChangesetOperation`** - part of A-01-01, and blocked on
  the same decision.
- **A-01-03f - `runAutomation`, `fetchAutomationRuns`,
  `listAutomationTriggerDefinitions`** - see A-01-06.
- **A-01-03g - `createResourceWatch`** - see A-01-07.
- **A-01-03h - Annotations** (`annotations/*`, five client-dispatchable
  actions and no commands) and **OTLP** (`otlp/exportLogs`, `exportMetrics`,
  `exportTraces`) - an editor's furniture and a telemetry pipe. Neither has a
  caller here, and neither is on the path a client takes to hold a
  conversation.

**The 24 server-origin actions this host never emits**, by channel, with the
reason each is a decision:

| channel | n | why |
| --- | ---: | --- |
| `changeset/*` | 7 | Computing a changeset is served; acting on one is not - see A-01-01 |
| `automation` + `automationRun` | 5 | A-01-06 |
| `terminal/*` | 4 | `cwdChanged`, `commandExecuted`, `commandFinished`, `commandDetectionAvailable` are shell integration, which needs a PTY this daemon does not have. `isPty: false` is the honest form of all four. |
| `session/*` | 3 | `customizationRemoved` is not: the list goes out whole, and nothing removes one alone. `creationFailed` is not needed rather than missing - `createSession` finishes or throws inside the request, so a client never holds a session in `creating` and `lifecycle: 'ready'` is true by the time anything can read it. `serverToolsChanged` is the correct field, empty for a true reason: `serverTools` are tools the *host* contributes - `SdkMcpToolDefinition`, being `name`, `description`, `inputSchema` - and this host defines none. The CLI's own built-in tools are never enumerated by the SDK at all, so they could not go here even if wanted. The day this host adds a tool of its own, it is two lines. |
| `chat/*` | 3 | `toolCallDelta` is deliberate and already said in the code: a tool call's arguments stream as JSON, and a row redrawn per keystroke of a JSON blob says nothing until it is complete. `toolCallAuthRequired` / `AuthResolved` are mid-call MCP authentication, a moment the SDK does not surface. |
| `resourceWatch/changed` | 1 | A-01-07 |
| `root/activeSessionsChanged` | 1 | presence, with `session/activeClient*` below |

**The 24 client-dispatchable actions it does not handle** - each a control a
client may offer that this host would ignore. `ahpc dispatch <uri> <type>
--field k=v` sends any of them verbatim, so this list is now a thing that can
be run rather than a thing that was read off the types: `session/workingDirectorySet` /
`Removed` / `Replaced` and `chat/workingDirectorySet` / `Removed` (directories
are fixed at creation here, and a session that moves is a conversation whose
second half cannot see the files its first half was about);
`session/activeClientSet` / `Removed`; `chat/turnResume`,
`chat/inputAnswerChanged`, `chat/toolCallResultConfirmed`,
`chat/toolCallContentChanged`, `chat/truncated`;
`changeset/filesReviewChanged`; `terminal/cleared`; `root/configChanged`; and
the whole `annotations/*` set (5) and `automation*` set (4).

`chat/truncated` stays refused for a reason worth keeping: it means "drop the
turns before this one", and when the harness compacts, every one of them is
still in the transcript and still readable. What was compacted is the model's
context, not the conversation.

## A-01-04 - Deno

Written to the same interface as Node and Bun and never run: Deno is not
installed here. Until somebody runs it, the third case in `listen.ts` is a
claim rather than a fact.

## A-01-05 - The convergence

The textui chat client's `claudeHost` makes this same translation in-process.
It was the prototype; this is the thing it was a prototype of.

The pieces a client needs are now in place - the catalogue, past sessions,
turns, models, the slash menu. So `--claude` in that client should mean
*spawn one of these and connect to it*. That deletes roughly a thousand lines
of duplicated translation from the client rather than extracting them into a
package neither repository naturally owns.

Until then the duplicate is deliberate. It is also the only conformance test
that matters: the same client, rendering the same screen, against `--claude`
and against `--host ws://...`. If they differ, one of them is wrong.

It has already earned its keep once: thinking was being appended with
`chat/delta` rather than `chat/reasoning`, which every conformant client would
have drawn as an empty thinking header and the only client here could not see.

## A-01-06 - Automations

A whole channel, unserved and until now unnamed: `runAutomation`,
`fetchAutomationRuns`, `listAutomationTriggerDefinitions`, the
`automation/*` actions and the `automationRun/*` channel beneath them - a
session started by a trigger rather than by a person, and watchable while it
runs.

It is the one unserved channel with an obvious backing here, which is why it is
worth naming rather than dismissing: the harness already has scheduled and
triggered work. Nothing calls it today, and a client that offered the screen
would drive nothing.

## A-01-07 - Resource watches

`createResourceWatch` and `resourceWatch/changed`: a client subscribes to a
path and is told when it changes, rather than polling `resourceRead`. The read
half of `resource*` is served, so this is the notification the served half
implies and does not provide. No caller yet, and it wants a file watcher this
daemon does not have.
