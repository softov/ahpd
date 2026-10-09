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

## The first chat, and the rest

A session's first chat is `ahp-chat://default/<base64url(sessionUri)>`. The specification illustrates `ahp-chat:/<uuid>` and says the owning session is not encoded in the chat URI, and this host published exactly that until the only other client showed why it cannot work: that client computes the shape above from the session rather than reading the session's `chats` catalogue, so it subscribed to a channel that did not exist while the conversation sat on one it had been told about. Answering both is not enough either, because `defaultChat`, every entry in `chats` and `ChatState.resource` all name a chat as well, and a client that subscribed to one string and is then told the chat is at another cannot pair them up. One name wins everywhere, and it is the one that client computes. The older `ahp-chat:/<sessionId>` is still answered, because only the id inside a URI is ever read.

`default` is a role rather than an identity: it means whichever chat a client gets when it names none, so disposing the chat that holds it moves the name to its successor and tells everyone with `session/defaultChatChanged`. A second chat is named by whoever created it and is derived from nothing.

Closing a chat ends it here and moves `default` if it held it. What the backend keeps of that chat's conversation is the daemon's `closedChats` key: `hidden`, the default, leaves the conversation and the id it was written under, so it is never listed as a session again, and `delete` removes it - decision [A closed chat's conversation is hidden by default, and deleted only when the daemon is told to](../.project/decisions/a-closed-chat-is-hidden-or-deleted.md).

Every chat in a session works in the session's directories or in a subset of them, never in one from outside: a chat naming a directory its session does not have is refused rather than quietly widening the session through the chat. A change to a chat's directories starts that one chat again, resumed.

## A chat made out of another

`createChat` takes a `source`, and its `kind` is the first thing read, because the kind decides whether the rest of it means anything.

A **fork** copies the conversation through one named turn and continues it under an id of its own, so the chat it came from is untouched. It needs the backend to say it can fork, and the backend's own name for where that turn ended, which is the only point it can be asked to resume from.

A **side chat** copies nothing. It is told what that turn said, on its first prompt, because the protocol is explicit that the source transcript stays out of its visible history. A `selection` naming what was picked out of that turn is kept on the new chat's origin, and only when it has text.

What the new chat says it was made from is kept for as long as the chat is, and re-sent whole on every change: an origin given once and then overwritten with `user` would be a chat that had forgotten where it came from.

## Turns

`chat/turnStarted` arrives from a client and this host emits it again, because nothing in a client applies what it sent itself. The running turn is `activeTurn` and is not in `turns`; it moves across when it completes.

A turn says who sent it, as the same typed reference a session's owner is: `user:<id>` for somebody who signed in, `root:<host>` for a turn the deployment's own token started. It rides in the `_meta` of the message rather than in one place of its own, because only the message declares one. A turn sent before any of this was kept says nothing rather than guessing.

One action ends a turn and which one says how it went: `chat/turnComplete` when it worked, `chat/error` when it did not, `chat/turnCancelled` when somebody stopped it. All three carry a required `duration`, and a message that arrives without one is `NaN` inside a client's reducer rather than a missing number - which is why `chat/error` *is* the ending rather than a message beside one.

A message that arrives while a turn is running waits as a pending message, and its kind decides what happens: `queued` waits for the running turn, `steering` goes into it. The prompt handed to the backend's CLI is a generator that stays open for the life of the session, which is what makes steering possible at all.

A draft is a `Message` rather than a string, and the session holds it rather than the chat's client, so two people in one chat see each other's. It is taken for a session nothing is running for too - somebody typing into a row from the catalogue is typing before there is any reason to start an agent, and refusing it is a composer that empties itself as it is typed into.

`serverSeq` moves with state and never with messages. A snapshot is taken at a sequence number and every action after it carries a greater one, which is how a client knows it missed nothing.

## Compacted context, and a rewind

The backend compacts its own context when the conversation outgrows the model's window, and announces it as a `compact_boundary`. This host turns that into a `systemNotification` part in the running turn, saying what happened and how many tokens went where, because somebody watching an answer change character halfway through deserves to know why. Nothing is dropped: what was compacted is the model's context and not the conversation, and every turn is still in the transcript and still readable. A host that conflated the two would delete from every client's screen a history it can still serve.

`chat/truncated` is the other thing, and it is a rewind rather than a compaction. It drops the turns after a named one so an edited message can be resent, and the backend is started again resumed at the kept turn's last chain entry, so the agent does not go on answering the message that was edited away. Two forms are refused rather than half-done: a turn read back off a transcript, which has no rewind point because the backend's own names for what it did are recorded only while this process watches it run; and the action's `turnId` left off, which means "clear everything" and as a rewind is a cut before the first prompt that names no entry at all.

A client may rename a chat, and this host names one after its first message, because an untitled row is one nobody can find again. `deferredTitleGeneration` in root config is what turns that off, and renaming a chat then happens only when somebody asks - [HOST.md](HOST.md#root-config).

## Attachments

A message may carry files, and what this host does with each is decided once for every backend - [attachments.ts](../packages/sdk/src/attachments.ts).

A pasted image goes to the model as an image when it is jpeg, png, gif or webp and at most 5 MiB - decision [A pasted image goes to the model as an image when it is jpeg, png, gif or webp and at most 5 MB, and by path otherwise](../.project/decisions/a-pasted-image-goes-as-an-image-when-it-fits.md). Pasted text is inlined up to 64 KiB and named by its path above that - decision [A textual attachment is inlined up to 64 KiB, and named by path above that](../.project/decisions/pasted-text-is-inlined-up-to-64-kib.md). Everything else is named by the path this host wrote it to.

Those bytes are written to a file before the action is applied, once, under the session's own attachments folder, and what the message carries from then on is the path - decision [An attachment's bytes are written to a file in the session's attachments folder, and the message names that file](../.project/decisions/an-attachments-bytes-are-written-to-disk-and-the-message-names-the-file.md). Left alone, a pasted picture is the chat state, the transcript and every copy of it, written again for every client that opens the session and every session that reads the message back. A file larger than 32 MiB that only the client holds is left where it is rather than asked for, because the answer would arrive as one message and that is past what one may carry.

Four things are left exactly as the client sent them, because there is nothing here to fetch or nothing better to make: an attachment that is neither inline bytes nor a `file:` URI, whose scheme this host does not serve; a `file:` URI this host already has a file for outside the session's folder, which is somebody's own file and is readable where it stands; a directory, which has no bytes; and anything whose write failed, which is a log line rather than a refusal, since a message that arrived is worth more than a picture that did not.

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
| `fetchTurns` | Older turns. The answer is empty and the page arrives as `chat/turnsLoaded` on the channel, so every watcher gets it |
| `completions` | What a `/` offers in this session, and what an `@` path names |

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
| [AHP.md](AHP.md#chat--29-of-30) | The chat channel's actions, turn by turn |
| [HOST.md](HOST.md#root-config) | `deferredTitleGeneration` and the other root config keys |
| [TOOLS.md](TOOLS.md) | What a tool call is |
