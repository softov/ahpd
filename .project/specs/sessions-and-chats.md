---
title: Sessions and chats
status: current
covers:
  - packages/sdk/src/host/spawn.ts
  - packages/sdk/src/host/chatactions.ts
  - packages/sdk/src/host/chatrecord.ts
  - packages/sdk/src/host/sessionmethods.ts
  - packages/sdk/src/host/lifecycle.ts
  - packages/sdk/src/host/history.ts
  - packages/sdk/src/host/localturns.ts
  - packages/sdk/src/host/catalogue.ts
  - packages/sdk/src/host/sessionconfig.ts
  - packages/sdk/src/host/attachments.ts
  - packages/sdk/src/resources/attachments.ts
  - packages/sdk/src/sessions/sessions.ts
  - packages/sdk/src/plugins/plugins.ts
  - packages/agent-claude/src/session/workers.ts
  - packages/agent-claude/src/transcript.ts
  - packages/agent-claude/src/options.ts
decisions:
  - decisions/a-new-session-is-held-under-the-protocols-uri.md
  - decisions/a-pasted-image-goes-as-an-image-when-it-fits.md
  - decisions/subagent-chats-are-restored-from-the-cli-meta-file.md
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L338-L440](../../packages/sdk/src/host/spawn.ts#L338-L440) - `openSubagent`, where a worker chat is opened, linked and ended"
  - "[code://packages/sdk/src/host/spawn.ts#L166-L180](../../packages/sdk/src/host/spawn.ts#L166-L180) - `withWorkerUri`, which stamps `subagentChatUri` on a spawning call"
  - "[code://packages/sdk/src/host/spawn.ts#L1084-L1090](../../packages/sdk/src/host/spawn.ts#L1084-L1090) - `onTurnRecorded`, which copies a turn's sender to its transcript id"
  - "[code://packages/sdk/src/host/chatactions.ts#L799-L905](../../packages/sdk/src/host/chatactions.ts#L799-L905) - fixed keys: the restart before the first turn and the refusal after it"
  - "[code://packages/sdk/src/host/chatactions.ts#L1177-L1239](../../packages/sdk/src/host/chatactions.ts#L1177-L1239) - a stop, refused with no turn running, and in a worker chat"
  - "[code://packages/sdk/src/host/chatactions.ts#L481-L493](../../packages/sdk/src/host/chatactions.ts#L481-L493) - a stop on a session asleep in the catalogue, refused before a wake"
  - "[code://packages/sdk/src/host/chatactions.ts#L284-L292](../../packages/sdk/src/host/chatactions.ts#L284-L292) - a message with attachments waits for its snapshot"
  - "[code://packages/sdk/src/host/chatrecord.ts#L188-L211](../../packages/sdk/src/host/chatrecord.ts#L188-L211) - `dropChat`, a closed chat hidden or deleted"
  - "[code://packages/sdk/src/host/lifecycle.ts#L435-L458](../../packages/sdk/src/host/lifecycle.ts#L435-L458) - `deleted`, the backend copy of a session"
  - "[code://packages/sdk/src/host/lifecycle.ts#L527-L541](../../packages/sdk/src/host/lifecycle.ts#L527-L541) - `mayDispose`, who may delete a session"
  - "[code://packages/sdk/src/host/lifecycle.ts#L560-L640](../../packages/sdk/src/host/lifecycle.ts#L560-L640) - `removeSession`"
  - "[code://packages/sdk/src/host/catalogue.ts#L700-L787](../../packages/sdk/src/host/catalogue.ts#L700-L787) - the session list: provider choice and pruning"
  - "[code://packages/sdk/src/host/history.ts#L298-L397](../../packages/sdk/src/host/history.ts#L298-L397) - `past`, a transcript read"
  - "[code://packages/sdk/src/sessions/sessions.ts#L505-L560](../../packages/sdk/src/sessions/sessions.ts#L505-L560) - `fileSessions`, the session store"
  - "[code://packages/sdk/src/sessions/sessions.ts#L854-L880](../../packages/sdk/src/sessions/sessions.ts#L854-L880) - `migrateSessions`"
  - "[code://packages/sdk/src/host/attachments.ts#L85-L260](../../packages/sdk/src/host/attachments.ts#L85-L260) - `needsWriting` and `snapshot`, attachment bytes written to disk"
  - "[code://packages/sdk/src/resources/attachments.ts#L98-L180](../../packages/sdk/src/resources/attachments.ts#L98-L180) - `partsOf`, what a backend gets for each attachment"
  - "[code://packages/sdk/src/host/sessionconfig.ts#L325-L473](../../packages/sdk/src/host/sessionconfig.ts#L325-L473) - session schema, running schema, seeded pickers and stored config"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1046-L1062](../../packages/sdk/src/plugins/plugins.ts#L1046-L1062) - `registerSessionConfig`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L455-L508](../../packages/sdk/src/plugins/plugins.ts#L455-L508) - the fold of contributed session keys"
  - "[code://packages/agent-claude/src/session/workers.ts#L644-L651](../../packages/agent-claude/src/session/workers.ts#L644-L651) - Claude's `stopWorker`"
  - "[code://packages/agent-claude/src/transcript.ts#L46-L168](../../packages/agent-claude/src/transcript.ts#L46-L168) - `turnsOf` and `subagentsOf`"
  - "[code://packages/agent-claude/src/session/query.ts#L554-L583](../../packages/agent-claude/src/session/query.ts#L554-L583) - a Claude compaction as a notice"
  - "[code://packages/agent-cofold/src/mapping.ts#L139-L148](../../packages/agent-cofold/src/mapping.ts#L139-L148) - `compactionNotice`"
  - "[code://packages/agent-claude/src/options.ts#L67-L70](../../packages/agent-claude/src/options.ts#L67-L70) - `storedSandbox`"
  - git://d9d4f950^ - the deleted decisions this spec was written from: a-backend-opens-a-subagent-chat-through-the-host, a-backend-says-which-transcript-id-a-turn-was-written-as, a-closed-chat-is-hidden-or-deleted, a-compacted-session-keeps-its-history-and-shows-a-notice, a-failed-transcript-read-is-not-an-empty-session, a-listed-session-belongs-to-the-provider-the-host-recorded, a-spawning-call-carries-the-reference-subagent-meta, a-stop-in-a-worker-chat-stops-that-worker, a-worker-whose-spawning-call-was-compacted-is-listed, an-attachments-bytes-are-written-to-disk-and-the-message-names-the-file, deleting-a-session-deletes-the-backends-copy, pasted-text-is-inlined-up-to-64-kib, the-closed-chat-setting-is-a-daemon-key, the-session-store-is-one-file-per-session, a-contributed-picker-is-seeded-when-a-config-is-resolved, a-fixed-key-is-shown-read-only-once-the-session-runs, a-plugin-may-contribute-a-session-key, a-preset-sandbox-off-wins-over-a-stored-on, a-provisional-session-takes-a-fixed-key-by-restarting, a-stored-sandbox-on-survives-the-preset
---

The host keeps each session and its chats, lists them, and holds what a backend does not keep. A session has one record in the session store, a list of chats, and a config that the backend and plugins declare. A backend can open a worker chat for each subagent it runs, and the host links that chat to the call that spawned it. Attachments are written to files that the host owns, and the backend gets text, images or file references from them. A closed chat is hidden or deleted, as the `closedChats` daemon key says. A deleted session is also deleted from the backend, when the backend can do it.

## Scenarios

### A backend opens a worker chat

WHEN a backend calls `start.subagent(toolCallId, request)` for a subagent call
THEN the host opens a read-only chat whose `origin` is `{kind: 'tool', chat, toolCallId}`
AND it announces the chat with `session/chatAdded` and opens a turn with the prompt as the message
AND it adds a `subagent` content to the spawning call, while that call's chat has a turn open.

A second call for the same tool call id gives the same chat.
The URI comes from the SDK helper `subagentChatUri`, so a backend does not build it.
A nested worker names its parent call, not a chat, because its call is in the parent worker's chat.
A backend without this seam draws the worker's output inline in the lead chat.
See [`code://packages/sdk/src/host/spawn.ts`](../../packages/sdk/src/host/spawn.ts).

### A worker chat ends

WHEN the backend calls `end` on a worker chat
THEN the host sends `chat/turnComplete`, `chat/turnCancelled`, or `chat/error` with `errorType: 'turnFailed'`
AND it marks the worker chat unread
AND a second `end` does nothing.

### A spawning call carries the subagent meta

WHEN a `chat/toolCall*` action has `_meta.toolKind: 'subagent'`
THEN the host stamps `_meta.subagentChatUri` with the worker chat's URI
AND it stamps the same value on the calls in a snapshot.

The Claude backend also sets `subagentDescription` from the call's `description` and `subagentAgentName` from `subagent_type`.
These are the names VS Code reads to draw a subagent call.

### A stop with no turn running is refused

WHEN a client sends `chat/turnCancelled` for a chat that runs no turn
THEN the host refuses it with "Nothing is running on <chat> to stop"
AND a session asleep in the catalogue stays asleep.

WHEN the stop names another turn than the running one
THEN the host answers its sender alone and stops nothing.

WHEN the stop names the running turn, or no turn
THEN the host hands the backend the running turn's id.

The reason: the protocol's validation table has the server reject a stop with no active turn.
See [`code://packages/sdk/src/host/chatactions.ts`](../../packages/sdk/src/host/chatactions.ts).

### A stop in a worker chat stops that worker

WHEN a client sends `chat/turnCancelled` for a worker chat whose worker runs
AND the session has `stopWorker`
THEN the host calls `stopWorker(toolCallId)` and the lead chat's turn continues.

WHEN the session has no `stopWorker`
THEN the host cancels the lead chat's running turn
AND with no running turn it refuses with "Nothing is running on ...".

WHEN the worker has ended
THEN the host refuses the stop, as for any chat with no turn running.

The Claude backend stops the one task with `stopTask`.
It cancels the whole turn when its `workerStop` option is `session` or when no task id is known yet.
See [`code://packages/agent-claude/src/session/workers.ts`](../../packages/agent-claude/src/session/workers.ts).

### Restored workers are listed

WHEN the host restores a Claude session
THEN the backend lists its workers from `subagents/*.jsonl` and each `.meta.json` file
AND it reads `toolUseId`, `agentType` and `description` from the meta file.

WHEN a worker's spawning call is not in the restored turns, for example after a compaction
THEN the worker is still listed.

A worker is skipped only when nothing names its call.
See [`code://packages/agent-claude/src/transcript.ts`](../../packages/agent-claude/src/transcript.ts).

### A backend says which transcript id a turn was written as

WHEN a backend calls `onTurnRecorded(turnId, transcriptId)` with two different ids
THEN the host copies the turn's sender to the transcript id
AND a local turn after that turn names it by the transcript id
AND the host records the transcript id for the turn, as it records a turn's own id when the turn starts.

The reason: a restored turn has the backend's id, and without the copy it shows no sender.
The Claude backend calls it only for lead turns, and the pi backend calls it with its prompt's entry.

### A turn is read back as it began

WHEN a turn starts
THEN the host records its id as the transcript id it began under, in one file in the session's folder, under its chat.
WHEN the host reads a chat back from a transcript
THEN from the first turn the record holds on, a turn the record does not hold joins the turn before it
AND so does a turn recorded as the same turn as the one before it
AND a local turn stays a turn of its own
AND a joined turn keeps the first turn's id, start and message, takes both turns' parts and ends as the later one ended
AND its usage adds up what both spent.
WHEN a local turn's anchor is a turn that joined another
THEN the local turn goes after the turn it joined.
WHEN a truncation drops turns, a fork copies them, or a chat is removed or moves to another session
THEN the record follows, as the chat's local turns do.

The reason: a backend may write one turn as several of its own.
Claude's CLI writes a steering message it runs after the turn's last answer as a prompt.
The reference keeps that message's answer in the turn it steered.
A chat with no record, from before it or on a store with no session folder, reads as its transcript gives it.
See [`code://packages/sdk/src/host/localturns.ts`](../../packages/sdk/src/host/localturns.ts).

### The host keeps a `!` command's turn as a local turn

WHEN a `!` command's turn ends with `chat/turnComplete`, `chat/turnCancelled` or `chat/error`
THEN the host writes the turn to one file in the session's folder, under its chat
AND the file names its anchor: the nearest earlier turn that is not a local turn, by that turn's transcript id.

WHEN the host reads a chat back from a transcript
THEN it puts the chat's local turns back: the ones with no anchor first, then each after its anchor in the order kept
AND it drops a local turn whose anchor the transcript does not hold.

The reason: no agent saw the turn, so no transcript holds it, and the reference host keeps it the same way.
A store with no session folder keeps no local turn.
See [`code://packages/sdk/src/host/localturns.ts`](../../packages/sdk/src/host/localturns.ts).

### A cut at a local turn goes to the turn before it

WHEN a client truncates a chat or forks it at a local turn
THEN the host asks the backend for the point of the nearest earlier turn that is not a local turn
AND with no such turn, a truncation starts the chat over and keeps the turns up to the local turn.
*A chat truncated whole starts over* says how.

WHEN a truncation drops local turns
THEN their files go with them.
WHEN a fork copies local turns
THEN the new chat keeps them.

### A turn read back is a point to fork and cut at

WHEN the Claude backend reads a chat back from its transcript
THEN it names each turn's last prompt, tool result or answer entry
AND a session that resumes that conversation answers `forkPoint` and `endPoint` with it.

WHEN a session forks that conversation
THEN it starts without those entries, because a fork is a new conversation.

The reason: a session names a turn's end from its own CLI's frames, and the CLI that sent a turn read back is gone.
See [`code://packages/agent-claude/src/transcript.ts`](../../packages/agent-claude/src/transcript.ts).

### A new chat wakes a sleeping session

WHEN a client makes a chat in a session asleep in the catalogue, a fork among them
THEN the host wakes the session and holds it until the chat is made
AND it makes the chat in the live session.

See [`code://packages/sdk/src/host/sessionmethods.ts`](../../packages/sdk/src/host/sessionmethods.ts).

### A chat truncated whole starts over

WHEN a client sends `chat/truncated` with no `turnId`
AND the chat's backend has `delete`
THEN the host stops the chat's backend and waits for it to stop
AND it deletes the backend's conversation for the chat
AND it says the action to every client of the chat
AND it forgets the dropped turns' terminal outputs and local turns
AND it starts the chat's backend with no resume and no turns.
WHEN the chat's backend has no `delete`
THEN the host refuses the action, and the chat stays as it was.
WHEN the delete fails
THEN the host refuses the action with the reason, and the chat starts again resumed on the conversation it had.
WHEN an action reaches the chat while it starts over
THEN the action waits, and goes to the new backend.

The reason: as a rewind, a truncation with no turn is a cut before the first prompt.
A screen emptied in front of that agent would leave it remembering what the clients dropped.
The reference deletes the conversation and starts a fresh one for the same chat and id.
See [`code://packages/sdk/src/host/chatactions.ts`](../../packages/sdk/src/host/chatactions.ts) and https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1141-L1168.

### A failed transcript read is not an empty session

WHEN a transcript read fails
THEN the history keeps no rows for that session, and the next read tries again.

The host keeps a transcript only when it has turns, and it shares one read between concurrent callers.
The Claude backend tries `getSessionMessages` once more before it answers with no turns.
See [`code://packages/sdk/src/host/history.ts`](../../packages/sdk/src/host/history.ts).

### A compacted session keeps its history and shows a notice

WHEN the Claude backend gets a `compact_boundary` message during a turn
THEN it adds a `systemNotification` part: "Context compacted" or "Context compacted automatically"
AND when it knows the token counts it adds ": X tokens to Y."
AND it does not send `chat/truncated`, so the earlier turns stay.

The cofold backend uses the same words, live and when it reads a transcript back.
A Claude transcript read back skips the summary frame and shows no notice.

### A listed session belongs to the provider the host recorded

WHEN several backends list the same session id
AND the host recorded a provider for that session
THEN the session goes to the recorded provider, when it is loaded.

WHEN the recorded provider is not loaded
THEN the row stays under the recorded provider's name, with no backend to open it.

WHEN the host recorded no provider
THEN the session goes to the first backend in load order that listed it.

All backends are asked at the same time, and their answers are read in load order.
An id that a session claims as one of its chats is not listed as a session.
See [`code://packages/sdk/src/host/catalogue.ts`](../../packages/sdk/src/host/catalogue.ts).

### A session is named when the host makes it

WHEN a client creates a session on `ahp-session:/<id>`
THEN the host holds it under that URI.

WHEN a client creates a session on `<provider>:/<id>` and the request names that provider
THEN the host holds it under that URI.

WHEN a client creates a session on any other channel
THEN the host holds it as `ahp-session:/<id>`
AND the client's URI is an alias.

WHEN the host makes a session by itself
THEN its name is `ahp-session:/<uuid>`.

WHEN the host lists a session that has a stored `uri`
THEN it names the session from that URI.

WHEN the host lists a session with a stored provider and no `uri`
THEN it names the session `<provider>:/<id>`
AND it stores that name.

WHEN the host lists a session with no row
THEN it names it `ahp-session:/<id>`
AND it stores nothing for it.

The store keeps the name as `uri`, so a restart publishes the name a session was made with.
A client reads a session's provider from `SessionSummary.provider`, never from the URI's scheme.
A session made before this change keeps its `<provider>:/<id>` name.
See [`code://packages/sdk/src/host/sessionmethods.ts`](../../packages/sdk/src/host/sessionmethods.ts).

### The session store is one file per session

WHEN the host keeps a session record
THEN it writes `<configDir>/sessions/<encodeURIComponent(id)>.json`
AND it keeps the session's attachments in `<configDir>/sessions/attachments/<encoded id>/`.

The store is read once at start, and each write is an atomic rename, joined into one write per tick.
When a session goes, its file and its attachment folder go.

WHEN the host starts with an old `sessions.json` and no `sessions` folder
THEN it splits the file into one file per session
AND it renames the old file to `sessions.json.migrated`.

### A row nobody lists is pruned

WHEN every backend answered the list and none refused
AND the row's recorded provider answered
AND the row's folder was among the folders read
THEN the host removes a row that no backend listed.

WHEN the host keeps local turns for such a row
THEN it keeps the row and lists it from those turns
AND the row's title is the default chat's stored title, or else the first turn's text
AND the row's dates are the first turn's start and the last turn's end
AND a read of a chat whose backend holds no transcript answers the chat's local turns.

The reason: a backend that did not answer, or a folder not read, says nothing about a row.
A row whose turns the host keeps is a row the host can open again.
See [`code://packages/sdk/src/sessions/sessions.ts`](../../packages/sdk/src/sessions/sessions.ts).

### A closed chat is hidden or deleted

WHEN a client closes a chat
AND `closedChats` is `hidden`, the default
THEN the host keeps the row with `closed: true`
AND the chat's claim on its backend id stays after a restart.

WHEN `closedChats` is `delete`
THEN the host removes the row and the claim
AND it deletes the chat's copy in the backend.

The host sends `session/chatRemoved` in both cases.
`closedChats` is a daemon key in root config, and a change to it applies at once.
See [`code://packages/sdk/src/host/chatrecord.ts`](../../packages/sdk/src/host/chatrecord.ts).

### Deleting a session deletes the backend's copy

WHEN a client deletes a session
THEN the host stops the session and calls the backend's `delete`
AND it deletes each chat's backend id, closed chats too
AND it removes the row and sends `root/sessionRemoved`.

WHEN the backend has no `delete`
THEN the host logs once per provider that the backend keeps its own copy.

WHEN the backend's `delete` throws
THEN the host still removes the row and sends the removal, and then it gives the error to the client.

A backend's `delete` can be a getter, because the ACP backend learns it from the server's handshake.
See [`code://packages/sdk/src/host/lifecycle.ts`](../../packages/sdk/src/host/lifecycle.ts).

### Only an owner may delete a session

WHEN the host has people
AND the caller is not the owner and has no `session:*` grant and is not `root:`
THEN the host refuses the deletion with error -32009.

A host with no people refuses no deletion.

### An attachment's bytes are written to disk

WHEN a message carries an embedded resource, or a `file://` resource that is not on this host
THEN the host holds the message until the bytes are written
AND it writes them to the session's attachment folder, with mode 0400 in a folder with mode 0700
AND it changes the attachment to a `resource` that names the file, tagged `vscode.agentHost.snapshotAttachment`.

The host asks the client for a missing file with `resourceRead`, when its size hint is 32 MiB or less.
A file that is already on the host, or a folder, stays as sent.
A failed write is logged, and the attachment stays as sent.
See [`code://packages/sdk/src/host/attachments.ts`](../../packages/sdk/src/host/attachments.ts).

### Pasted text is inlined up to 64 KiB

WHEN a snapshot file has a text type
THEN the backend gets its first 64 KiB inline, as `<label> (lines 1-N):` and a fenced block.

WHEN a snapshot file is an image of 5 MiB or less in JPEG, PNG, GIF or WebP
THEN the backend gets it as an image.

WHEN an attachment is neither
THEN it goes in a list after "The user provided the following references:"
AND a snapshot file is marked "(read-only snapshot, do not edit this file)".

A text type is `text/*`, JSON, XML, JavaScript, TypeScript, or a `+json` or `+xml` type.
See [`code://packages/sdk/src/resources/attachments.ts`](../../packages/sdk/src/resources/attachments.ts).

### A plugin may contribute a session key

WHEN a plugin calls `registerSessionConfig(key, schema, completions?)`
THEN the key shows in every session's config schema
AND a key with a `completions` function gets `enumDynamic: true`.

The call refuses an empty key and a schema that is not an object.
It also refuses a `completions` that is not a function, and a key the plugin already registered.
A key that the host, another plugin or a backend already declares is reported as a problem and skipped.
In a session's schema, the backend's own key wins over a contributed key.
See [`code://packages/sdk/src/plugins/plugins.ts`](../../packages/sdk/src/plugins/plugins.ts).

### A contributed picker is seeded when a config is resolved

WHEN a client resolves a session config
AND a contributed key has an answerer, `enumDynamic`, and no `enum`
THEN the host asks the answerer with an empty query
AND it fills `enum`, `enumLabels` and `enumDescriptions` from the answer.

An answerer that throws is skipped, and its key stays a free field.
The reason: a client draws a picker only from `enum`.

### A stored value is checked against the schema

WHEN the host reads a session's stored config
THEN it keeps a key that no property declares
AND it replaces a value the schema refuses with the default, and it logs that once.

### A fixed key is shown read-only once the session runs

WHEN the host publishes a running session's schema
THEN each key with `sessionMutable: false` shows as `sessionMutable: true` with `readOnly: true`.

The reason: VS Code hides a key that is not session-mutable, and a read-only key is still drawn with its value.
The host checks a change against the raw schema, not the published one.
See [`code://packages/sdk/src/host/sessionconfig.ts`](../../packages/sdk/src/host/sessionconfig.ts).

### A provisional session takes a fixed key by restarting

WHEN a client changes a key with `sessionMutable: false`
AND no chat in the session has a turn
THEN the host starts the backend again with the new value
AND it holds later actions until the restart ends
AND it announces `session/configChanged`.

WHEN a chat in the session has a turn
THEN the host refuses with "<key> is fixed once the session has started".

The host checks admission before it restarts the session.
See [`code://packages/sdk/src/host/chatactions.ts`](../../packages/sdk/src/host/chatactions.ts).

### A preset sandbox off wins over a stored on

WHEN a Claude session's stored settings have `sandboxEnabled` as `on` or `true`
AND the preset does not say `sandbox: 'off'`
THEN the session starts with the sandbox on.

WHEN the preset says `sandbox: 'off'`
THEN the session starts with the sandbox off, whatever the stored value says.

See [`code://packages/agent-claude/src/options.ts`](../../packages/agent-claude/src/options.ts).
