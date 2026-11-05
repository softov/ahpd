# Chats

A **chat** is one conversation inside a session, and a session holds one or more of them. They are peers: the same backend, the same directory, the same settings, which is what makes a second chat a second conversation rather than a child of the first. Everything said in one is a **turn**, and an agent's answer to a turn arrives as a series of **parts**.

Terms, one line each:

| Term | |
| --- | --- |
| a chat | One conversation, and everything said in it |
| the default chat | The chat a client sends to when it means the session as a whole, read off the session's `defaultChat`. `default` is a role, not an identity |
| a turn | One message and the answer to it. The running one is `activeTurn`, and the rest are the transcript |
| a part | One piece of an answer: markdown, reasoning, a tool call, a notice |
| a worker chat | The chat one tool call of an agent's runs in, when it spawns one - a subagent |
| a queued message | One waiting behind the running turn. A `steering` one goes into it instead |
| a canvas | A page a plugin draws on a chat, on a channel of its own |

## The first chat, and the rest

A session's first chat is `ahp-chat://default/<base64url(sessionUri)>`, the shape VS Code's host builds and an older VS Code window computes from the session, and `defaultChat`, every entry in `chats` and `ChatState.resource` name it by that one URI. The URI is the session's chat while the session records no other default chat, or records that one, as VS Code's host gives a derived default chat an owner only while the session's record agrees ([agentHostChatOwnershipService.ts#L226-L242](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L226-L242)).

`default` is a role: it means whichever chat a client gets when it names none. Disposing the chat that holds it moves the role to another chat of the session, under that chat's own URI, and tells everyone with `session/defaultChatChanged`; the disposed chat's URI names nothing. A second chat is named by whoever created it, and `ahp-chat:/<id>` is a chat of that URI and of no session `<id>`. A chat keeps its URI wherever it moves.

Closing a chat ends it here and moves `default` if it held it. What the backend keeps of that chat's conversation is the daemon's `closedChats` key: `hidden`, the default, leaves the conversation and the id it was written under, so it is never listed as a session again, and `delete` removes it.

Every chat in a session works in the session's directories or in a subset of them, never in one from outside: a chat naming a directory its session does not have is refused rather than quietly widening the session through the chat. A change to a chat's directories starts that one chat again, resumed.

## A chat made out of another

`createChat` takes a `source`, and its `kind` is the first thing read, because the kind decides whether the rest of it means anything.

A **fork** copies the conversation through one named turn and continues it under an id of its own, so the chat it came from is untouched. It needs the backend to say it can fork, and the backend's own name for where that turn ended, which is the only point it can be asked to resume from. A turn the backend names no point for, one read back by a backend that names only the turns it watched, is forked all the same: the new chat holds the turns up to it and its backend begins a conversation of its own, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7424-L7476) hands its provider the host's turns and forks what the provider can. A fork at a `!` command's turn, which the backend never saw, forks the backend at the turn before it, and the new chat keeps the command turns it copied ([TERMINALS.md](TERMINALS.md#who-opens-one)).

A **side chat** copies nothing. It is told what that turn said, on its first prompt, because the protocol is explicit that the source transcript stays out of its visible history. A `selection` naming what was picked out of that turn is kept on the new chat's origin, and only when it has text.

What the new chat says it was made from is kept for as long as the chat is, and re-sent whole on every change: an origin given once and then overwritten with `user` would be a chat that had forgotten where it came from.

## Turns

`chat/turnStarted` arrives from a client and this host emits it again, because nothing in a client applies what it sent itself. The running turn is `activeTurn` and is not in `turns`; it moves across when it completes.

Who sent a turn is this host's own record, as the same typed reference a session's owner is: `user:<id>` for somebody who signed in, `root:<host>` for a turn the deployment's own token started. The host holds it while the turn runs, for what the turn runs as and what its usage record names, and says it in no action and no state a client reads, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L77-L83) keeps a pending message's sender for the turn it admits.

One action ends a turn and which one says how it went: `chat/turnComplete` when it worked, `chat/error` when it did not, `chat/turnCancelled` when somebody stopped it. All three carry a required `duration`, and a message that arrives without one is `NaN` inside a client's reducer rather than a missing number - which is why `chat/error` *is* the ending rather than a message beside one.

A turn that has ended takes no more results. A client's reducer completes a call in the active turn and in no other, so a call that a stop cancelled stays cancelled for every client that watched. A stop closes Claude's CLI, as VS Code's agent aborts its query, so nothing it would have said of the call reaches the record a later client reads or anything a client is sent. The edit such a call made reaches the changeset as the stop leaves the file, under the turn it was made in.

A message that arrives while a turn is running waits as a pending message, and its kind decides what happens: `queued` waits for the running turn, `steering` goes into it. The pending messages are the host's, as they are [VS Code's agent host's](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L29-L326): a client's is said as it came and held in the chat's state, and the backend is handed only the turns and the steering the host sends it. The prompt handed to the backend's CLI is a generator that stays open for the life of the session, which is what makes steering possible at all.

The host starts the head of the queue as a turn of its own when a turn completes, and when a `!` command's turn ends however the command went: it says `chat/turnStarted` with the message as the chat holds it and its id as `queuedMessageId`, admits it as it admits a client's start, and sends it to the backend, or runs it as this host's local command where it is a `!` command ([TERMINALS.md](TERMINALS.md#who-opens-one)). A stopped turn and a failed one start nothing behind them: what waits stays until a client queues, takes back or reorders a message while nothing runs, which starts the head of the queue, or until a turn the client starts completes. Nothing starts while the chat's latest turn ended in an error a client can resume, a message queued after it included, until that turn is resumed and completes or another turn completes, nor while the backend holds a steering message it was handed and has not run.

Steering goes to the backend while a turn runs: at the turn's start, and again on each of the turn's actions until the backend takes it, since a backend that cannot take it yet, a turn still preparing its prompt among them, says so. One the backend hands back unsent, the turn it was meant for having ended first, steers the turn that runs then, or runs next. A steering message that waits while no turn runs runs as a turn of its own, named by its `queuedMessageId`, ahead of every queued message, as VS Code's agent host runs steering that came too late to steer a turn; one behind a failure a client can resume waits for the next turn that starts, which it goes into. A `!command` that becomes a turn this way runs as a command. A backend that takes no steering refuses it, a turn running or not, in VS Code's agent host's words: "The session provider does not support steering messages." The steering message a running turn holds, sent again under its id, is answered and not handed over twice when it is the same message, and refused with "Cannot change a steering message while it is being processed." when it is another. A stop takes every pending steering message out with the host's own `chat/pendingMessageRemoved`, said right behind the stop and before the backend is told, and starts nothing.

A client takes a pending message back with `chat/pendingMessageRemoved`, and the host says it as the client sent it, one the chat no longer holds included, which changes nothing. A steering message the backend was handed is withdrawn from it, and one the model has read stays in its turn. While a turn runs, a backend that cannot withdraw one keeps it, and the host refuses the removal with "Cannot change a steering message while it is being processed.", as VS Code's agent host refuses one for a provider that cannot withdraw it.

Claude's CLI takes a steering message into the turn at the turn's next tool call. One that reaches it while the model writes the turn's last answer is run after that answer, as a turn of the CLI's own. Its answer is still the steered turn's: the turn stays open until the CLI has answered every prompt it was handed in it, as VS Code's agent host keeps a steering message in the turn it steers, and a queued message waits for that. The CLI is handed a steering message only once the turn's prompt is out, as VS Code's agent takes steering only into a send in flight; until then the session declines it, and the host hands it again on the turn's next action. A turn that fails takes the steering message it holds with it: what the CLI answers it with goes nowhere, and no turn opens for it. A stop closes the CLI, as VS Code's agent aborts its query, with every prompt and steering message it has not answered, and with the workers and tasks it runs; the next turn goes to a CLI that resumes the conversation. A turn sent while another runs is sent once the CLI has answered the one in front of it, as VS Code's agent runs each send after the one before it, and a model the CLI will not take is logged while the turn runs on the model it has.

pi takes a steering message into the turn before the model's next call. The host says the client's message as the chat's steering message as it came, which answers the client that sent it, and hands it to pi once pi has the turn's prompt; until then the session declines it, and the host hands it again on the turn's next action. pi takes it out with `chat/pendingMessageRemoved` once its queue no longer holds it, and one pi would not take is taken out at once, with the reason in the log. One pi still holds when its turn ends goes back to the host, which steers the turn that runs then with it, or runs it next. A bot's chat hands one to the session doing the work, as a message into the open turn, which goes on: it is taken out once it is handed on, and kept in the chat's log against that turn, so the record holds what was said; a chat read back after a restart shows that turn, as the live chat does.

cofold appends a steering message to the run's transcript before the model's next step. The host says the client's message as the chat's steering message as it came, which answers the client that sent it, and hands it to the turn's run once the run has started; cofold takes it out with `chat/pendingMessageRemoved` once it has written it into the transcript. A run that settles before a step reads it gives it back to the host, which steers the turn that runs then with it, or runs it next. A client can take back one the run holds: the host says the removal, and since the run's submit takes no steer back, the run still reads it, and one the model read stays in its turn.

cofold, pi, an ACP server and a bot's chat each run one turn at a time. A turn sent while another runs is sent once the one in front of it ends, as VS Code's agent runs each send after the one before it; a stop runs none of the turns sent behind the turn it stops, which the host has ended in every client's state. pi and an ACP server check for a stop after each step of a turn's preparation, and a turn stopped before its prompt is sent ends unsent. What the host has to say on a turn goes into that turn's prompt: cofold's run takes it in its system prompt, and pi and an ACP server in the prompt, ahead of what was said.

A Claude transcript read back after a restart shows the same turns. The CLI writes a steering message it ran late as a prompt of its own and nothing that ties it to the turn it steered; the message began no turn, so the host's record of the turns a chat began reads it back inside the turn before it, which is the turn it steered ([AGENT.md](AGENT.md#agent-in-the-order-the-host-asks)). One the CLI took in at a tool call comes back from the SDK's reader marked `isQueuedCommand`, and stays in its turn too. The CLI writes a stop as a user text, `[Request interrupted by user]`, which reads back as the end of a cancelled turn rather than as a turn, and a steering message answered in a turn of its own after a stop or a failure reads back as that turn, which the record holds.

A draft is a `Message` rather than a string, and the session holds it rather than the chat's client, so two people in one chat see each other's. It is taken for a session nothing is running for too - somebody typing into a row from the catalogue is typing before there is any reason to start an agent, and refusing it is a composer that empties itself as it is typed into.

`serverSeq` moves with every envelope, a refusal included. A snapshot is taken at a sequence number and every action after it carries a greater one, which is how a client knows it missed nothing.

## Canvases

A chat lists what a plugin draws on it in `ChatState.canvases`: one entry per canvas, in the order they were opened. There is no key at all when the chat holds none, because absence is what none means. Each canvas is a channel of its own, `ahp-canvas:/<base64url(chat)>/<uuid>`, holding one `CanvasState` - a title, a status and a live `url`.

A canvas goes with its chat. Closing the chat, removing it or moving it to another session takes its canvases with it, and a subscription to one afterwards answers `-32008`, "Canvas is no longer available". A plugin opens, draws and closes canvases, and no client action does - [PLUGINS.md](../plugins/PLUGINS.md#showing-a-canvas-on-a-chat). Only a connection at `0.10.0` or later is sent a canvas action - [AHP.md](AHP.md#canvas--1-of-1).

## Compacted context, and a rewind

The backend compacts its own context when the conversation outgrows the model's window, and announces it as a `compact_boundary`. This host turns that into a `systemNotification` part in the running turn, saying what happened and how many tokens went where, because somebody watching an answer change character halfway through deserves to know why. Nothing is dropped: what was compacted is the model's context and not the conversation, and every turn is still in the transcript and still readable. A host that conflated the two would delete from every client's screen a history it can still serve.

`chat/truncated` is the other thing, and it is a rewind rather than a compaction. It drops the turns after a named one so an edited message can be resent, and the backend is started again resumed at the kept turn's last chain entry, so the agent does not go on answering the message that was edited away. The Claude backend names where each turn ended when it reads a chat back from its transcript, so a Claude chat resumed after a restart can be rewound or forked at any of its turns. The truncation is said first, and a backend that cannot cut keeps its history: a turn whose backend names no rewind point for it, which is a turn read back by a backend that names points only for the turns it watches run, drops from every client and stays in the backend. The action's `turnId` left off means "clear everything", which as a rewind is a cut before the first prompt that names no entry at all, so the chat starts over instead: the backend stops, its conversation is deleted through the backend's `delete`, and a new one starts for the same chat with nothing to resume. A backend with no `delete` keeps the conversation; a delete that fails is logged, and the chat comes back on the conversation it had. A truncation at a `!` command's turn rewinds the backend at the turn before it and keeps the command's turn; one with no turn before it starts the chat over the same way and keeps the command turns up to the one named. The command turns a truncation drops go with it.

A client may rename a chat, and this host names one after its first message, because an untitled row is one nobody can find again. A chat a `!` command opened takes the command as a provisional title, which its first message's title replaces, as VS Code's host seeds one from a local command. `deferredTitleGeneration` in root config is what turns that off, and renaming a chat then happens only when somebody asks - [HOST.md](HOST.md#root-config).

## Attachments

A message may carry files, and what this host does with each is decided once for every backend - [attachments.ts](../../packages/sdk/src/resources/attachments.ts).

A pasted image goes to the model as an image when it is jpeg, png, gif or webp and at most 5 MiB - decision [A pasted image goes to the model as an image when it is jpeg, png, gif or webp and at most 5 MB, and by path otherwise](../../.project/decisions/a-pasted-image-goes-as-an-image-when-it-fits.md). Pasted text is inlined up to 64 KiB and named by its path above that. Everything else is named by the path this host wrote it to.

Those bytes are written to a file before the action is applied, once, under the session's own attachments folder, and what the message carries from then on is the path. Left alone, a pasted picture is the chat state, the transcript and every copy of it, written again for every client that opens the session and every session that reads the message back. A file larger than 32 MiB that only the client holds is left where it is rather than asked for, because the answer would arrive as one message and that is past what one may carry.

Four things are left exactly as the client sent them, because there is nothing here to fetch or nothing better to make: an attachment that is neither inline bytes nor a `file:` URI, whose scheme this host does not serve; a `file:` URI this host already has a file for outside the session's folder, which is somebody's own file and is readable where it stands; a directory, which has no bytes; and anything whose write failed, which is a log line rather than a refusal, since a message that arrived is worth more than a picture that did not.

A `chat` attachment is the fifth kind, and the only one this host resolves rather than carries: a message may point at another chat, which is what `#chat:` writes, and what was attached is a reference - a resource, a label, and the turn to read up to. A backend cannot read another chat, so each `chat` attachment becomes a `simple` attachment before the message reaches one, and its `modelRepresentation` is a pointer: the label, the chat's link where this host is running it, a line telling the model to call the `get_session_context` tool with that link, and the last 1000 characters of that chat's transcript up to the turn the client pinned. The transcript is what a person said and what the agent answered, turn by turn, and nothing else - no tool calls, no reasoning, no system notices - because the excerpt is cut to a length one tool call's input would fill. A `chat` attachment inside that transcript is read as the message's own text rather than resolved in turn, so a chain of references ends at the first one instead of following whatever it names. A chat this host is not running, or one in a session the sender may not read, gives the pointer and no excerpt and never fails the turn: the message arrived and the reference is still named, and what the sender cannot see is the other conversation. Only two things end the message's turn, in a `chat/error` of `errorType` `sendFailed` before the backend is handed it, and both are about a pin nobody can honour: an `endTurn` naming the turn that is still running, and one not found in the retained transcript, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2380-L2409) fails a send whose attachments it cannot resolve. What a client reads back is the attachment it sent - a turn keeps the `chat` attachment, and the pointer exists only in the blocks the backend was handed.

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
