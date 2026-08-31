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

## A-01-01 - Operations on a changeset

Review is served: every session scope advertises `capabilities.review`, files
carry `reviewed`, and `changeset/filesReviewChanged` is answered on the
changeset's own channel. It is deliberately **not** an operation - the protocol
has clients dispatch that action and the server keep the flag - which is also
why it needed no decision: ticking a file off is a reader's bookkeeping and
writes nothing to anybody's repository.

A tick does not survive its file changing. The protocol makes that the server's
job, since the server is the authority on what changed, so a later turn editing
a file clears the flag rather than leaving it standing against content nobody
has read.

What is left is `operations` and `invokeChangesetOperation` - commit, revert,
discard. The protocol's own gate is the right one and is finer than a flag:
`ChangesetState.operations` is a list the *server* advertises, and
`invokeChangesetOperation` takes an `operationId` that must match one from it,
so a client can only invoke what this host has already offered. Advertising
none is conformant - the field is optional, "omit when no operations are
available" - which is what it does today.

Two rules to copy when it is served, both from the reference: an operation is
`Disabled` while a turn is active, so the working tree cannot be mutated
mid-request; and anything destructive carries `confirmation`, which a client
MUST show before invoking.

The open question is not *how* but *whether*: committing and reverting are
writes to somebody's repository from a daemon that may be reached from another
machine, and that is the same question the write half of `resource*` is waiting
on. See A-01-03a and A-01-03b.

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

## A-01-05 - The convergence, from the other side

Done in `ahpc`: `--claude` starts one of these rather than translating the
Agent SDK itself, and about fifteen hundred lines went with it - the
translation and its tests. That client no longer depends on the Claude SDK at
all.

What it bought, immediately: the same client renders the same screens against
`--claude` and `--host`, because they are now the same path with a different
daemon at the end of it. There is one translation to be wrong, and it is this
one.

What it costs, and it is a real cost: that client needs `ahpd` installed where
it used to need nothing. The shape of a spawned host is worth knowing for
anything else that embeds one - `--port 0` so two clients never fight over one,
a token so a daemon nobody else asked for answers nobody else, and killed when
its client goes.

Left over, and cheap: `ahpd` had `bin` pointing at a file with no shebang, so
`npm i -g ahpd` installed a command the shell could not run. Fixed, but worth
remembering as the class of thing only installing it finds.

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
