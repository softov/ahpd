# Chats

A **chat** is one conversation inside a session, and a session holds one or more of them. They are peers: the same backend, the same directory, the same settings, which is what makes a second chat a second conversation rather than a child of the first. Everything said in one is a **turn**, and an agent's answer to a turn arrives as a series of **parts**.

Terms, one line each:

| Term | |
| --- | --- |
| a chat | One conversation, and everything said in it |
| the default chat | Whichever chat a client gets when it names none. `default` is a role, not an identity |
| a turn | One message and the answer to it. The running one is `activeTurn`, and the rest are the transcript |
| a part | One piece of an answer: markdown, reasoning, a tool call, a notice |
| a worker chat | The chat one tool call of an agent's runs in, when it spawns one - a subagent |
| a queued message | One waiting behind the running turn. A `steering` one goes into it instead |
| a canvas | A page a plugin draws on a chat, on a channel of its own |

## The first chat, and the rest

A session's first chat is `ahp-chat://default/<base64url(sessionUri)>`. The specification illustrates `ahp-chat:/<uuid>` and says the owning session is not encoded in the chat URI, and this host published exactly that until the only other client showed why it cannot work: that client computes the shape above from the session rather than reading the session's `chats` catalogue, so it subscribed to a channel that did not exist while the conversation sat on one it had been told about. Answering both is not enough either, because `defaultChat`, every entry in `chats` and `ChatState.resource` all name a chat as well, and a client that subscribed to one string and is then told the chat is at another cannot pair them up. One name wins everywhere, and it is the one that client computes. The older `ahp-chat:/<sessionId>` is still answered, because only the id inside a URI is ever read.

`default` is a role rather than an identity: it means whichever chat a client gets when it names none, so disposing the chat that holds it moves the name to its successor and tells everyone with `session/defaultChatChanged`. A second chat is named by whoever created it and is derived from nothing.

Closing a chat ends it here and moves `default` if it held it. What the backend keeps of that chat's conversation is the daemon's `closedChats` key: `hidden`, the default, leaves the conversation and the id it was written under, so it is never listed as a session again, and `delete` removes it.

Every chat in a session works in the session's directories or in a subset of them, never in one from outside: a chat naming a directory its session does not have is refused rather than quietly widening the session through the chat. A change to a chat's directories starts that one chat again, resumed.

## A chat made out of another

`createChat` takes a `source`, and its `kind` is the first thing read, because the kind decides whether the rest of it means anything.

A **fork** copies the conversation through one named turn and continues it under an id of its own, so the chat it came from is untouched. It needs the backend to say it can fork, and the backend's own name for where that turn ended, which is the only point it can be asked to resume from. A fork at a `!` command's turn, which the backend never saw, forks the backend at the turn before it, and the new chat keeps the command turns it copied ([TERMINALS.md](TERMINALS.md#who-opens-one)).

A **side chat** copies nothing. It is told what that turn said, on its first prompt, because the protocol is explicit that the source transcript stays out of its visible history. A `selection` naming what was picked out of that turn is kept on the new chat's origin, and only when it has text.

What the new chat says it was made from is kept for as long as the chat is, and re-sent whole on every change: an origin given once and then overwritten with `user` would be a chat that had forgotten where it came from.

## Turns

`chat/turnStarted` arrives from a client and this host emits it again, because nothing in a client applies what it sent itself. The running turn is `activeTurn` and is not in `turns`; it moves across when it completes.

A turn says who sent it, as the same typed reference a session's owner is: `user:<id>` for somebody who signed in, `root:<host>` for a turn the deployment's own token started. It rides in the `_meta` of the message rather than in one place of its own, because only the message declares one. A turn sent before any of this was kept says nothing rather than guessing.

One action ends a turn and which one says how it went: `chat/turnComplete` when it worked, `chat/error` when it did not, `chat/turnCancelled` when somebody stopped it. All three carry a required `duration`, and a message that arrives without one is `NaN` inside a client's reducer rather than a missing number - which is why `chat/error` *is* the ending rather than a message beside one.

A turn that has ended takes no more results. A client's reducer completes a call in the active turn and in no other, so a call that a stop cancelled stays cancelled for every client that watched. Claude's CLI answers the call it was interrupted in after the stop, and that answer changes neither the record a later client reads nor anything a client is sent. The edit such a call made still reaches the changeset, under the turn it was made in.

A message that arrives while a turn is running waits as a pending message, and its kind decides what happens: `queued` waits for the running turn, `steering` goes into it. The prompt handed to the backend's CLI is a generator that stays open for the life of the session, which is what makes steering possible at all.

Claude's CLI takes a steering message into the turn at the turn's next tool call. One that reaches it while the model writes the turn's last answer is run after that answer, as a turn of the CLI's own. Its answer is still the steered turn's: the turn stays open until the CLI has answered every prompt it was handed in it, as VS Code's agent host keeps a steering message in the turn it steers, and a queued message waits for that. A turn that is stopped, or that fails, before the CLI took its steering message in leaves the message with the CLI, which runs it next. The message's answer is a turn of its own, which opens as the steered turn ends and carries the message, with its id as `queuedMessageId`, as AHP 1.1.0 shows a steering message taken in by a turn of its own. It is the chat's running turn from then on, so a turn sent meanwhile waits behind it as behind any other: a prompt that reached the CLI while the message waited there would be run with it, as one turn with one answer. The message is that turn's prompt, so a stop of that turn stops the message too, and what the CLI says to it afterwards goes nowhere. What the stopped answer says after the stop goes nowhere, and the stopped turn's result ends no turn that is running when it comes.

pi takes a steering message into the turn before the model's next call. The message is said back as the chat's steering message as it is taken, which answers the client that sent it, and taken out with `chat/pendingMessageRemoved` once pi's queue no longer holds it, read into the turn or let go. A bot's chat has no model to read one, so the message becomes a turn of its own: it is said back as it is taken, the open turn ends, and the turn that takes the message in names it as its `queuedMessageId`.

cofold appends a steering message to the run's transcript before the model's next step. The message is said back as the chat's steering message as it is taken, which answers the client that sent it, and taken out with `chat/pendingMessageRemoved` once cofold has written it into the transcript. A run that ends before a step reads it rejects it, and the message becomes a turn of its own once the chat is idle, ahead of any queued message, named by its `queuedMessageId`; after a run a client stopped, it waits for the chat's next turn to end, as a queued message does.

A Claude transcript read back after a restart shows the same turns. The CLI writes a steering message it ran late as a prompt of its own and nothing that ties it to the turn it steered; the message began no turn, so the host's record of the turns a chat began reads it back inside the turn before it, which is the turn it steered ([AGENT.md](AGENT.md#agent-in-the-order-the-host-asks)). One the CLI took in at a tool call comes back from the SDK's reader marked `isQueuedCommand`, and stays in its turn too. The CLI writes a stop as a user text, `[Request interrupted by user]`, which reads back as the end of a cancelled turn rather than as a turn, and a steering message answered in a turn of its own after a stop or a failure reads back as that turn, which the record holds.

A draft is a `Message` rather than a string, and the session holds it rather than the chat's client, so two people in one chat see each other's. It is taken for a session nothing is running for too - somebody typing into a row from the catalogue is typing before there is any reason to start an agent, and refusing it is a composer that empties itself as it is typed into.

`serverSeq` moves with state and never with messages. A snapshot is taken at a sequence number and every action after it carries a greater one, which is how a client knows it missed nothing.

## Canvases

A chat lists what a plugin draws on it in `ChatState.canvases`: one entry per canvas, in the order they were opened. There is no key at all when the chat holds none, because absence is what none means. Each canvas is a channel of its own, `ahp-canvas:/<base64url(chat)>/<uuid>`, holding one `CanvasState` - a title, a status and a live `url`.

A canvas goes with its chat. Closing the chat, removing it or moving it to another session takes its canvases with it, and a subscription to one afterwards answers `-32008`, "Canvas is no longer available". A plugin opens, draws and closes canvases, and no client action does - [PLUGINS.md](../plugins/PLUGINS.md#showing-a-canvas-on-a-chat). Only a connection at `0.10.0` or later is sent a canvas action - [AHP.md](AHP.md#canvas--1-of-1).

## Compacted context, and a rewind

The backend compacts its own context when the conversation outgrows the model's window, and announces it as a `compact_boundary`. This host turns that into a `systemNotification` part in the running turn, saying what happened and how many tokens went where, because somebody watching an answer change character halfway through deserves to know why. Nothing is dropped: what was compacted is the model's context and not the conversation, and every turn is still in the transcript and still readable. A host that conflated the two would delete from every client's screen a history it can still serve.

`chat/truncated` is the other thing, and it is a rewind rather than a compaction. It drops the turns after a named one so an edited message can be resent, and the backend is started again resumed at the kept turn's last chain entry, so the agent does not go on answering the message that was edited away. The Claude backend names where each turn ended when it reads a chat back from its transcript, so a Claude chat resumed after a restart can be rewound or forked at any of its turns. A turn whose backend names no rewind point for it, which is a turn read back by a backend that names points only for the turns it watches run, is refused rather than half-done. The action's `turnId` left off means "clear everything", which as a rewind is a cut before the first prompt that names no entry at all, so the chat starts over instead: the backend stops, its conversation is deleted through the backend's `delete`, and a new one starts for the same chat with nothing to resume. A backend with no `delete` cannot forget the conversation, and is refused; a delete that fails is refused with its reason, and the chat comes back on the conversation it had. A truncation at a `!` command's turn rewinds the backend at the turn before it and keeps the command's turn; one with no turn before it starts the chat over the same way and keeps the command turns up to the one named. The command turns a truncation drops go with it.

A client may rename a chat, and this host names one after its first message, because an untitled row is one nobody can find again. `deferredTitleGeneration` in root config is what turns that off, and renaming a chat then happens only when somebody asks - [HOST.md](HOST.md#root-config).

## Attachments

A message may carry files, and what this host does with each is decided once for every backend - [attachments.ts](../../packages/sdk/src/resources/attachments.ts).

A pasted image goes to the model as an image when it is jpeg, png, gif or webp and at most 5 MiB - decision [A pasted image goes to the model as an image when it is jpeg, png, gif or webp and at most 5 MB, and by path otherwise](../../.project/decisions/a-pasted-image-goes-as-an-image-when-it-fits.md). Pasted text is inlined up to 64 KiB and named by its path above that. Everything else is named by the path this host wrote it to.

Those bytes are written to a file before the action is applied, once, under the session's own attachments folder, and what the message carries from then on is the path. Left alone, a pasted picture is the chat state, the transcript and every copy of it, written again for every client that opens the session and every session that reads the message back. A file larger than 32 MiB that only the client holds is left where it is rather than asked for, because the answer would arrive as one message and that is past what one may carry.

Four things are left exactly as the client sent them, because there is nothing here to fetch or nothing better to make: an attachment that is neither inline bytes nor a `file:` URI, whose scheme this host does not serve; a `file:` URI this host already has a file for outside the session's folder, which is somebody's own file and is readable where it stands; a directory, which has no bytes; and anything whose write failed, which is a log line rather than a refusal, since a message that arrived is worth more than a picture that did not.

A `chat` attachment is the fifth kind, and the only one this host resolves rather than carries: a message may point at another chat, which is what `#chat:` writes, and what was attached is a reference - a resource, a label, and the turn to read up to. A backend cannot read another chat, so each `chat` attachment becomes a `simple` attachment before the message reaches one, and its `modelRepresentation` is a pointer: the label, the chat's link where this host is running it, a line telling the model to call the `get_session_context` tool with that link, and the last 1000 characters of that chat's transcript up to the turn the client pinned. The transcript is what a person said and what the agent answered, turn by turn, and nothing else - no tool calls, no reasoning, no system notices - because the excerpt is cut to a length one tool call's input would fill. A `chat` attachment inside that transcript is read as the message's own text rather than resolved in turn, so a chain of references ends at the first one instead of following whatever it names. A chat this host is not running, or one in a session the sender may not read, gives the pointer and no excerpt and never fails the turn: the message arrived and the reference is still named, and what the sender cannot see is the other conversation. Only two things refuse the message, and both are about a pin nobody can honour: an `endTurn` naming the turn that is still running, and one not found in the retained transcript. What a client reads back is the attachment it sent - a turn keeps the `chat` attachment, and the pointer exists only in the blocks the backend was handed.

Attachments carry which of the three they became, so a backend whose block names what it carries has the name to hand. The tag `vscode.agentHost.snapshotAttachment` is what says a file is the message's own, a copy of something pasted or of a buffer a client had unsaved, rather than a file somebody works in - the second is named by path and left for the model to read.

## Subagents

An agent that spawns one starts a conversation of its own, and this host serves it as a **worker chat**: `ahp-chat://subagent/<base64url(session)>/<toolCallId>`. The shape is the reference client's, which reads the authority to tell a worker from an ordinary chat.

The chat is announced on the session as `session/chatAdded`, its turn is opened with the prompt the parent agent wrote, and it is `read-only` to a person: the actions it takes are an answer to what it asked and a stop. The spawning call carries the link in both directions - the chat's origin names the call, and the call's result content names the chat - so a client draws the worker under the row that started it. A nested worker's call is in the worker chat that spawned it, which is why the parent names a call rather than a chat.

## Commands

There is no `ahpd chat`. A chat is driven over the protocol, on its own channel.

| Command | What it does |
| --- | --- |
| `subscribe` | The chat's `ChatState`, and every action after it |
| `createChat` | A second conversation in a session, or one forked or copied from an existing turn |
| `disposeChat` | End one chat. The last one is refused: that is `disposeSession` |
| `fetchTurns` | Older turns, which exist only after a subscribe that named a `view` and got a `turnsNextCursor`. The answer is empty and the page arrives as `chat/turnsLoaded` on the channel, so every watcher gets it |
| `completions` | What a `/` offers in this session, what an `@` path names, and which other chats of it a `#` offers - a `#` on its way to `#chat:` offering the chats and the files both, and every other `#` a file alone |

## Grants

Reading a chat is `chat:turns`; subscribing to one is the same operation. Writing is one operation per act, and a session's group covers them the same way - [SESSIONS.md](SESSIONS.md#grants).

| What | Grant |
| --- | --- |
| Read a chat and its turns | `chat:turns` |
| Open or close one | `chat:create`, `chat:dispose` |
| Send a turn, cancel one, reorder what is waiting | `chat:send`, `chat:cancel` |
| Answer a tool or a question | `chat:answer` |
| Run a client's own tool call | `chat:tool` |
| Type a draft | `chat:draft` |
| Change the directories one works in, mark it read or archived | `chat:folders`, `chat:mark` |
| Rewind one | `chat:truncate` |

## See also

| | |
| --- | --- |
| [SESSIONS.md](SESSIONS.md) | The session a chat lives in |
| [AHP.md](AHP.md#chat--35-of-35) | The chat channel's actions, turn by turn |
| [HOST.md](HOST.md#root-config) | `deferredTitleGeneration` and the other root config keys |
| [TOOLS.md](TOOLS.md) | What a tool call is |
