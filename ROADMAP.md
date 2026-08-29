# What is next, and why

Ordered by what unblocks a client, not by what is interesting to build. Each
entry says what it costs a person today, because a roadmap that only lists
features cannot be argued with.

---

## Done

**The config controls.** A session now carries `config` - permission mode
(which is where plan mode lives), effort level, and thinking. It carried none,
because the schema went out as `config.properties` where a client reads
`config.schema.properties`; one level up draws no controls at all. `thinking`
is marked immutable, since the CLI takes it when the query is built and has
nowhere to put a later change - offering it live would be a switch that flips
back. There is deliberately **no** `model` row: a session has no model, each
message has one, and adding it drew a second picker beside the first-class one.

**Capabilities a session has before its CLI answers.** A new session used to
report no skills and no commands for the several seconds its CLI took to
start. A client asks once when a session opens and caches the answer, so an
empty list read as "none" and the slash menu stayed empty until something else
happened to re-ask - which is what "I had to open the skills screen first"
looks like. A session now starts from what the boot probe already learned and
refines it when its own CLI replies.

**Paging a long history.** A snapshot carries the newest fifty turns and a
cursor; `fetchTurns` walks backwards. Verified live on an 852-turn session:
seventeen fetches to the beginning, 71ms, every turn once. The result is
deliberately empty - the page arrives as `chat/turnsLoaded` on the channel, so
every client watching gets it rather than only the one that asked. A cursor
this host did not issue is refused, because guessing would answer a question
about old turns with new ones and the client would page for ever without
noticing.

**Completing a slash.** `completions` answers the trigger character this host
was already advertising. A live session's own commands win, but an *empty*
list from one means "not known yet", not "none" - a session created a moment
ago has not heard back from its CLI, and preferring its silence leaves the menu
empty for exactly as long as somebody is likely to use it. So it falls back to
the harness-wide list the boot probe learned, which also means a slash
completes before any session exists. A slash mid-word is a path and returns
nothing.

**Opening a session that already happened.** The catalogue's ninety-eight rows
were rows onto an empty room; now each one opens. Browsing is a *file read* -
`getSessionMessages`, no CLI - and a session becomes live only when somebody
starts a turn on it, at which point it is **resumed** rather than replayed: the
agent picks up the context it built, not a transcript of it. Verified live:
opened a past session, asked what it had been told to say earlier, and it
answered from context.

Two things that were wrong: deriving a title from the first message titled
every row `<ide_opened_file>…`, because a first message routinely opens with
editor context the person never typed - the catalogue's own summary is the
title, and the row and the session it opens must not disagree. And an assistant
reply belongs to the turn it answered, not a turn of its own, or the history
reads as a monologue with the questions removed.

**Choosing a model.** `session/configChanged` carries `model`, and
`chat/turnStarted` carries `message.model`. A model named on a turn takes
effect and *stays* in effect - the SDK has no per-turn model, and setting it
back afterwards would race the next turn onto whichever call landed last.
Credited on the turn, so the transcript says what actually ran it.

The models are learned by **one short-lived CLI at startup**, asked over the
control protocol and closed again. Learning them from a session's handshake was
always one step too late: `resolveSessionConfig` is what a composer asks
*before* creating anything, so the picker was empty at exactly the moment
somebody was choosing.

**Retrieving what the harness offers.** Models, slash commands, subagents and
MCP servers now arrive from the CLI's *control* protocol -
`initializationResult()` and `mcpServerStatus()` - rather than from its message
stream. That distinction is the whole feature: the message stream's `init`
frame only appears once a turn starts, so a composer built on it can offer a
model picker and a slash menu only after the conversation has begun, which is
exactly too late. Read live against a real CLI: 54 commands, 6 agents, 6 MCP
servers, 5 models, no turn.

Two things that were wrong and are worth remembering: `ModelInfo` keys on
`value`, not `id` - reading `id` silently yields an empty picker - and the CLI
says `connected`/`failed`/`needs-auth` where the protocol says
`ready`/`error`/`authRequired`.

---

**The silences**, done 2026-08-29. A message typed while a turn was running
was dropped on the floor - the composer invited you to queue it, the client
dispatched `chat/pendingMessageSet`, and the host logged "not served yet". The
queue is the host's now: it holds the message, starts it as the next turn when
the running one ends, and names it on that turn so a client's reducer takes it
out of the queue on the same word. Steering is refused out loud instead, since
the SDK has nowhere to inject one and delivering it to the *next* turn would
deliver it to a different conversation. Cancelling deliberately does not start
the next: somebody stopping a turn is stopping the conversation.

With it, three things the host knew and never said: what it is doing
(`Thinking`, then `Bash sleep 4 && echo done`, then nothing - on the chat and
mirrored on the session, which is where a catalogue row reads it), what a turn
cost (`chat/usage`, emitted *before* `chat/turnComplete`, because the reducer
hangs it on `activeTurn` and completing is what moves that into `turns`), and
a session's real title (`session/titleChanged`, so a client that already had
it open stops reading "New session" over a conversation that has one).

**The filesystem, and `@`**, done 2026-08-29. `resourceList`, `resourceRead`
and `resourceResolve` are served, and every path is checked against the
directories the host was told to serve *after* symlinks are resolved - a link
inside a served directory pointing at `/etc` passes a textual test and opens
something else. `-32009` for a path outside them, `-32008` for one that is not
there: two different answers a client acts differently on.

The write half - `resourceWrite`, `resourceDelete`, `resourceMkdir`,
`resourceMove`, `resourceCopy` - is deliberately not served, and answers
`-32601`. A host that lets any connected client write anywhere is a different
proposition from one that lets it read the project it is working on, and this
daemon is meant to be reachable from another machine.

`@` completes a path under the session's own working directory, offered as a
`resource` attachment rather than the bytes: a completion that carried the
file would carry it per keystroke. A directory keeps its trailing slash so the
next keystroke goes into it, and an at-sign mid-word is an address rather than
a path.

Also: `chat/draftChanged`, which is the only reason a draft is on the wire at
all - a client that kept its own would need nothing from a host for it - and a
compacted context, said as a notice in the running turn. Deliberately *not*
`chat/truncated`: that means "drop the turns before this one", and every one
of them is still in the transcript and still readable. What the harness
compacted is the model's context, not the conversation.

**Skills, told apart**, done 2026-08-29. Skills arrived *inside* `commands`,
so the list said `prompt` for something a client would rather label a skill,
and an agent-only skill could not be distinguished at all. The CLI hands out
two lists that overlap and neither says which is which - `commands` is what a
slash offers, `reloadSkills()` is what was loaded from disk - and the answer
is in the disagreement: a name in both is a skill, one in `commands` alone is
a built-in prompt, and a skill the CLI did *not* put behind a slash is one it
will not let a person invoke, which is `disableUserInvocation` read off the
CLI's own answers rather than guessed from a name. Live: 19 skills, 36
prompts, 6 subagents, 6 servers, and `keybindings-help` correctly the agent's.

**Reconnect and replay**, done 2026-08-29. A dropped socket lost everything
between the drop and the next subscribe. `serverSeq` is what makes this
answerable - it advances with state and never with messages, so "everything
after the last one I saw" is a well-formed question. The last thousand action
envelopes are kept and replayed from that number; past them a returning client
is handed fresh snapshots, which is correct and only more expensive.
Subscriptions come back with it, because the host forgot them when the
connection went, and a channel it cannot resume is *named* so the client drops
it rather than waiting on one that will never speak again.

**Skills and MCP**, done 2026-08-29. The customizations panel was a list you
could read and not touch. An MCP server is switched through the CLI now and
the state is *read back* rather than assumed - one told to stop can fail to,
and reporting what was asked for draws a row that is not true.

Switching on a server that is not ready **reconnects** it, which is how
somebody signs into one: `toggleMcpServer` only lifts the disabled flag, so a
server that was off *because* nobody had signed in comes straight back
`authRequired` and the switch looks like it flipped itself off. AHP's
`authenticate` is the other model - the client fetches a token and pushes it -
and the SDK has nowhere to put a token, so this host serves the gesture and
not the token.

A skill, a prompt or a subagent is refused out loud: the CLI has no runtime
switch for any of them, and the customization list goes back out so the
control returns to where it was rather than showing a change that did not
happen. The client learned to listen: `session/customizationsChanged` reached
its reducer and stopped there, so the panel showed what was true when it was
opened and a toggle that worked looked like one that did nothing.

**Before that**, in the order a client notices: a turn the client starts is
said back (without it every response part named a turn no client had, and the
whole answer landed nowhere until somebody reopened the session); one
conversation is one catalogue row rather than two; `IsRead` and `IsArchived`
are kept and told to every client; a browsed row carries the same config
schema a live one does; one tool call is one row and approving it works; the
host takes `agents` rather than importing Claude, with a worked example; a
connection token and a bind address; several working directories, with one the
client did not name refused rather than silently replaced.

---

# Pending

Verified against a live daemon on 2026-08-29, not read off the spec. Each
entry says what it costs a person today.

## 1. File changes never appear

There is no changeset channel: no `session/changesetsChanged`, no
`changeset/*`, no `invokeChangesetOperation`. `changes()` answers
`{status:'complete', files:[]}` for every session, so the changes screen is
permanently empty and the **Changes** row always reads "nothing yet".

The Claude SDK hands out no diff, so this is a decision rather than a wiring
job: derive one from the `Edit`/`Write` tool calls as they happen, or ask git
about the working directory. The second is honest about changes made outside
the conversation; the first is honest about which turn made them.

## 2. The smaller silences

Each of these is one action the host never emits, and each shows up as a
screen that is subtly stale rather than one that is wrong:

- `session/metaChanged`, `session/serverToolsChanged`.

## 3. The parts a daemon may never want

Served by the editor's host and not by this one, listed so the gap is a
decision rather than an oversight: terminals (`createTerminal`, `terminal/*`,
`root/terminalsChanged`), several chats per session (`createChat`,
`disposeChat`, `session/chatAdded`/`Removed`/`Updated`), annotations
(`annotations/*`), OTLP (`otlp`), and `sessionConfigCompletions`.

A terminal is a real feature for a host somebody drives from a phone. The
others are an editor's furniture.

## 4. Deno

Written to the same interface as Node and Bun and never run: Deno is not
installed here. Until somebody runs it, the third case in `listen.ts` is a
claim rather than a fact.

---

## The convergence

The textui chat client's `claudeHost` makes this same translation in-process.
It was the prototype; this is the thing it was a prototype of.

The pieces a client needs are now in place - the catalogue, past sessions,
turns, models, the slash menu. So `--claude` in that client should mean
*spawn one of these and connect to it*. That deletes roughly a thousand lines
of duplicated translation from the client rather than extracting them into a
package neither repository naturally owns.

Until then the duplicate is deliberate. It is also the only conformance test
that matters: the same client, rendering the same screen, against `--claude`
and against `--host ws://…`. If they differ, one of them is wrong.
