# AHP compatibility

Counted against [`@microsoft/agent-host-protocol`](https://microsoft.github.io/agent-host-protocol/)
**0.9.0**, which is what this repository builds against and the newest
published.

The versions negotiated are the package's own `SUPPORTED_PROTOCOL_VERSIONS` -
`0.9.0`, `0.8.0`, `0.7.0`, `0.6.0`, `0.5.2`, `0.5.1` - taken in the *client's*
order of preference rather than this host's. VS Code advertises `1.0.0`, which
is not published: its copy is vendored from the protocol repository and runs
ahead of npm. So it offers `1.0.0, 0.8.0, …` and this host answers `0.8.0`,
which is the newest both know, and an editor newer than this daemon connects
rather than refusing.

Everything below was read off the source and the type declarations, not off the
specification: nothing here is listed because AHP defines it.

## Markers

Every table below is one row per declared thing, so a marker is about that one
thing rather than about a group it was counted in.

| | |
| --- | --- |
| ✅ | implemented as specified |
| 🧩 | arrives through a host port, so it depends on what the host was given |
| 🚧 | partial - the Notes say which half |
| ➖ | declared and **not written** - the Notes say what it would take |
| 🚫 | deliberately unsupported, because there is nothing here to reflect |

The last two are the distinction worth keeping. Both reach a client as a
refusal, and a refusal cannot tell them apart - so the row does. `➖` is work
nobody has done; `🚫` is a question this backend never asks, where serving the
action would mean this host inventing the moment rather than reporting one.

`🔀`, for something implemented differently from the obvious reading without
saying so, is gone: where this host diverges it now says where, in the row.

## Commands

**31 of the 32 declared**, one row each. `dispatchAction` is the partial one -
what it will and will not act on is [state actions](#state-actions). Anything
not listed here answers `-32601`, said rather than quietly answered: a host that
returns an empty success to a method it does not have leaves the client waiting
for state that is never coming.

Twenty of them declare `channel` as a literal rather than as a URI a client
chooses - `ahp-root://` for all but `runAutomation` and `fetchAutomationRuns`.
Eighteen are enforced: a client that names a different one is refused `-32602`
saying which is right, because a host that answered anyway would make that
client look correct until the first conformant host refused it with nothing on
screen saying why. A client that names *no* channel is taken - it has named
nothing wrong. `initialize` and `ping` are the other two and are exempt: they
are how a client finds out it can talk at all, and refusing either turns a
wrong constant into a connection that never opens.

| command | ahpd | Notes |
| --- | :---: | --- |
| `initialize` | ✅ | Answers with a version the client actually offered, in the client's order of preference; a refusal carries `supportedVersions` to retry with. `initialSubscriptions` come back as snapshots in the same response. `automations` is advertised only when this host was given a store, because presence is what *permits* a client to use the channel, and `terminalCommandPrefix` is `"!"` only when it was given a `terminals` port. |
| `ping` | ✅ | A round trip, and the one method the specification says works before the handshake - a liveness check that needed one first could not tell a half-open socket from a busy one. |
| `subscribe` | ✅ | The snapshot is taken *at* a `serverSeq`, and anything dispatched while it was being taken is replayed on top of it. Subscribing twice to one channel is answered twice, including while the first snapshot is still in flight; the reference host cancels the earlier subscribe and answers it `-32001`, so a client written against that one may never send the second. |
| `unsubscribe` | ✅ | A notification, so it carries no id and gets no reply. Per connection: one client unsubscribing does not stop another's stream. |
| `reconnect` | ✅ | Replays what a dropped client missed from its `lastSeenServerSeq`, or hands back whole snapshots when the gap is longer than the buffer. Stateless notifications - the OTLP channels - are never replayed, because they carry no `serverSeq` to have been missed from. |
| `dispatchAction` | 🚧 | A notification. The echo carries `origin` - the `clientId` and `clientSeq` the dispatch came with - and one this host will not act on comes back carrying `rejectionReason` instead. See [state actions](#state-actions) for which. |
| `listSessions` | ✅ | Most-recently-modified first, live sessions included. Pages when a client sends `limit` and answers the whole catalogue when it does not, because neither client that connects here reads `nextCursor` and a default page size would be a catalogue silently cut down to it. A cursor this host did not issue is `-32602`. |
| `createSession` | ✅ | Takes the URI the client chose, under whatever scheme it chose it. `activeClient` puts the creating client into the session as it is made, under the `clientId` it introduced itself with rather than the one in the payload. |
| `disposeSession` | ✅ | Closes every chat, the terminals the session claimed, and its worktree - unless somebody's work is still in it, which is the one thing a daemon cannot judge the value of. A dirty tree is kept where it is and the path is logged. |
| `createChat` | ✅ | Each chat is its own agent process on one directory set and one config. A `fork` source continues the conversation from a named turn under a new backend id, carrying the turns through as visible history; a `sideChat` copies nothing and hands the model what that turn said, on its first prompt and nowhere else. |
| `disposeChat` | ✅ | The last chat cannot be disposed, and the refusal says to dispose the session instead - a session with nothing to talk to is not a state a client should be able to reach. |
| `createTerminal` | 🧩 | The `terminals` port. Opens in a directory this host serves, under the URI the client chose. |
| `disposeTerminal` | 🧩 | Kills the process group rather than the shell, because a detached shell's children outlive it. |
| `createResourceWatch` | 🧩 | A channel per watch, with globs for `includes` and `excludes`. No dispose command, as the protocol has none: the last `unsubscribe` releases the watcher. |
| `fetchTurns` | ✅ | Newest 50 in the snapshot and a cursor for the rest. The page arrives as `chat/turnsLoaded` on the channel rather than in the result, so every client watching the chat gets it. Resolved under whatever spelling the client used for the chat. |
| `completions` | ✅ | `/` against the session's own commands - read from the `children` of its containers, because a prompt or a skill is never a top-level customization - falling back to the harness-wide list when a session has not answered yet. `@` against the files this host serves, relative to the session's own directory. A skill the CLI loaded and did *not* put behind a slash is the agent's own and stays out of the menu. Every item carries `_meta.command`, without which the reference client drops it - see [a slash command is a message](#a-slash-command-is-a-message). |
| `authenticate` | ✅ | A token for a resource this host advertised, kept per connection and spent only on that connection's sessions. See [Authentication](#authentication). |
| `resolveSessionConfig` | ✅ | The same schema a session reports, so a catalogue row is configurable before it is resumed. Iterative: what has been answered comes back answered, so re-asking does not quietly undo a choice. This host contributes six worktree properties of its own when it was given a `worktrees` port and the directory is a repository. |
| `sessionConfigCompletions` | ✅ | `branch`, the one key with more values than a picker holds. The schema seeds twenty, most recently committed first; this answers what somebody types, matching on substring. Every other key is an enum of five or fewer and answers with nothing. |
| `invokeChangesetOperation` | 🧩 | The `changes` port advertises the verbs; this host owns their status and the write gate. A result may carry a `followUp`. |
| `resourceRead` | 🧩 | The `resources` port, inside the directories this host was told to serve. The changeset source is asked first, because the `before` side of an edit is not a file on disk. |
| `resourceList` | 🧩 | The same port and the same fence. |
| `resourceResolve` | 🧩 | What a URI actually is - type, size, times, and an `etag` for a file, which is what makes `resourceWrite`'s `ifMatch` usable. |
| `resourceWrite` | 🧩 | Behind `resourceRequest`, and behind the store's own path check - which resolves the *parent*, so a symlink pointing out of the served set cannot be written through. `-32011` when `ifMatch` no longer matches. |
| `resourceDelete` | 🧩 | The same two gates in the same order. |
| `resourceMkdir` | 🧩 | `mkdir -p` semantics, as the protocol declares. |
| `resourceMove` | 🧩 | Both ends checked. Refused `-32602` across two different clients, because neither peer could carry that out. |
| `resourceCopy` | 🧩 | The same. |
| `resourceRequest` | ✅ | The write gate, per connection and per resource. An operation that writes is refused `-32009` until granted, and the refusal carries the request that would unlock it. |
| `listAutomationTriggerDefinitions` | 🧩 | *Event* triggers only. A schedule is protocol-defined and never listed; manual is not a trigger at all, and an empty trigger list on a definition is what manual-only means. Answered on `ahp-root://`, which is what it declares. |
| `runAutomation` | 🧩 | The session is created here rather than in the store, because only this file knows what a session is - the store is handed a function and gets a URI back. |
| `fetchAutomationRuns` | 🧩 | A page of one automation's runs, newest first. |

## Server-to-client commands

**10 of the 10 declared.** `ServerCommandMap` carries the same ten `resource*`
entries `CommandMap` does, with the same params and the same results: the
family is symmetrical, and the receiver decides whether to allow an operation
whichever peer asked for it. What it is *for* is a resource this host cannot
reach - a plugin's virtual files, an editor's unsaved buffers, a filesystem
provider - published by a client and addressed as `<scheme>://<clientId>/…`.

Routing is the authority part of the URI: a `resource*` request naming a
connected client's id is forwarded to that client and its answer comes back
verbatim, refusals included. `file:` is never a client's, and neither is any
`ahp-` scheme, whose authority is part of a channel name. `resourceMove` and
`resourceCopy` are refused `-32602` across two different clients, because
neither peer could carry that out. `createResourceWatch` is forwarded and the
channel the owner mints is relayed: that client - and only that client - may
dispatch `resourceWatch/changed` onto it, and this host passes it to whoever
subscribed.

A refusal comes back to the asking client exactly as the owner sent it - this
host has no standing to soften somebody else's `-32009` - and is written to the
log with the method, the URI, the client that refused and the code, because
that is the only place all four are visible at once. A client on the other end
of a `-32009` cannot tell "published read-only" from "not yet sure who is
asking".

`host.clients` is the same ten as named methods, so an embedder can read a
client directly, and `ahp_resource` (see [state actions](#state-actions),
`serverTools`) is how a session's agent reaches one.

## Server notifications

**9 of the 9 declared**, one row each. These carry no `serverSeq` and are never
replayed: a client that dropped and came back has missed them, and must not be
handed them again as if it had not.

| notification | ahpd | Notes |
| --- | :---: | --- |
| `action` | ✅ | The envelope every state action rides in: `channel`, `action`, `serverSeq`, and the `origin` of whatever caused it. Counted with the [state actions](#state-actions) rather than here. |
| `root/sessionAdded` | ✅ | Carries the whole `summary`, to the connections watching the root channel and no others. |
| `root/sessionRemoved` | ✅ | Carries `session`. |
| `root/sessionSummaryChanged` | ✅ | Carries `session` and a `changes` partial with the three identity fields - `resource`, `provider`, `createdAt` - left out, because the protocol says they MUST be. |
| `root/progress` | ✅ | Only when the request carried a `progressToken`, and only to the client that sent it: the token is that request's and means nothing to anybody else. Three frames against a total of 2 - the tree, the agent, ready - because making a worktree on a large repository is seconds somebody otherwise waits through with nothing on screen. |
| `auth/required` | ✅ | Off the same state change that carries the requirement, to the connections watching that session, once per resource. Expiry of a token this host *accepted* is still not reported: nothing here verifies one, so it never learns that one has gone stale. |
| `otlp/exportLogs` | ✅ | `ahp-otlp://logs/{level}`, a template a client expands before subscribing - a literal URI would mean every subscriber got every line. Carries an OTLP/JSON `ExportLogsServiceRequest` verbatim, the same lines the daemon writes to stdout. |
| `otlp/exportTraces` | ✅ | `ahp-otlp://traces`, a literal channel: the protocol defines template variables for `logs` alone, and one of this host's invention would be a channel nobody can expand. A turn is a `SPAN_KIND_SERVER` span and every tool call in it a `SPAN_KIND_CLIENT` child, joined by `traceId` and sent as each ends. |
| `otlp/exportMetrics` | ✅ | `ahp-otlp://metrics`. Cumulative sums against the process start, so a collector arriving late reads totals rather than a difference it missed the beginning of. |

## State actions

**95 of the 96 declared, across nine channels**, one row each. The one that is
not served is `chat/toolCallResultConfirmed`, and it is refused in its own words
rather than as unserved - a client that sends it learns why nothing happened.

It is `🚫` rather than `➖`: a question this backend never asks, not work nobody
has done. The distinction is worth keeping, because "the backend has no such
moment" and "nobody has got round to it" read the same in a refusal and are not
the same fact - and this one was written up here as the second until somebody
asked.

**Origin** is the protocol's own `IS_CLIENT_DISPATCHABLE`: `client` is one a
client may originate, `host` is one only this host may say, and `both` is a
client action this host also emits on its own account. A host-only action
arriving from a client is refused as a client claiming something happened,
which is a different complaint from an action nobody has served.

### `root/*` — 4 of 4

| action | origin | ahpd | Notes |
| --- | :---: | :---: | --- |
| `root/agentsChanged` | host | ✅ | Sent at the handshake and again when the boot probe answers, so a client that connected before the CLI replied gets the models, commands and customizations rather than an empty list it caches. |
| `root/activeSessionsChanged` | host | ✅ | A count, not a list. Moves when a session is created or disposed. |
| `root/terminalsChanged` | host | ✅ | The whole `TerminalInfo` list, sent when a terminal opens, closes, or exits on its own. |
| `root/configChanged` | client | ✅ | The one root action a client originates: VS Code pushes `defaultShell` at connect. Whatever it pushes is kept and read back on every root snapshot, whether or not this host understands the key. |

### `session/*` — 28 of 28

| action | origin | ahpd | Notes |
| --- | :---: | :---: | --- |
| `session/ready` | host | ✅ | After the backend is running and before the session is announced. A client told about a session it cannot yet subscribe to has been told about something that is not there. |
| `session/creationFailed` | host | ✅ | For a session an automation could not start, where there is no request to fail. One a client asked for fails inside `createSession` instead. |
| `session/chatAdded` | host | ✅ | Carries the whole `ChatSummary`. The reducer reads `action.summary.resource`, and a chat named any other way arrives as a `TypeError` inside it. |
| `session/chatRemoved` | host | ✅ | On `disposeChat`. The last chat cannot be removed - that is `disposeSession`, and the refusal says so. |
| `session/chatUpdated` | host | ✅ | Only when the row actually moved - title, status or activity. A chat says something on every delta, and a summary re-sent per token is a list redrawn per token. |
| `session/defaultChatChanged` | host | ✅ | When the chat that was the default is disposed and another takes over. |
| `session/titleChanged` | both | ✅ | A client may rename a session; this host also names one after its first message, because an untitled row is one nobody can find again. |
| `session/serverToolsChanged` | host | ✅ | Full replacement, which is what the action means: it carries the new set rather than a difference. Sent to every running session when `host.setTools()` is called. |
| `session/activeClientSet` | both | ✅ | A client announcing itself, and this host putting the creating client into the session it just made - under the `clientId` it introduced itself with rather than the one in the payload. |
| `session/activeClientRemoved` | both | ✅ | Host-managed on the way out: a client that unsubscribes, drops without reconnecting in time, or reconnects without resubscribing is removed by this host rather than left in the list. |
| `session/workingDirectorySet` | client | ✅ | The SDK takes its directories when the CLI starts and offers no way to add one after, so a change starts the backend again *resumed* - the same conversation in a wider place. Refused `-32004` while a turn is running. |
| `session/workingDirectoryRemoved` | client | ✅ | Index 0 is the process root and the protocol says a client MUST NOT remove it; this host says so out loud rather than ignoring the attempt. |
| `session/workingDirectoryReplaced` | both | ✅ | The only way index 0 may move, which is why this host advertises `primaryReplacement` beside `immutablePrimary`. Saying it as a removal and an addition would be a client briefly holding a session with no directory at all. |
| `session/inputNeededSet` | host | ✅ | Carries `request`, not a bare entry. Four kinds reach it: a chat elicitation, a tool confirmation, a client-executed tool, and a tool blocked on an MCP sign-in. |
| `session/inputNeededRemoved` | host | ✅ | Carries the `id` alone, which is the upsert key the set half used. |
| `session/customizationsChanged` | host | ✅ | The whole list, seeded from the boot probe so a session is not empty for its first several seconds, then replaced when its own CLI answers. |
| `session/customizationToggled` | client | ✅ | Carries `enablement` per scope rather than a flat flag. For an MCP server this host turns it into `toggleMcpServer`, or into `reconnectMcpServer` when the server was off because nobody had signed in. |
| `session/customizationUpdated` | host | ✅ | One row, when a server's enablement moved as well as its state - `mcpServerStateChanged` carries the state alone, so a server that came back on would arrive `ready` with the switch still drawn off. |
| `session/customizationRemoved` | host | ✅ | Sent one at a time for a server taken out of the configuration, rather than re-sending the whole list. The removal is the change. |
| `session/mcpServerStateChanged` | host | ✅ | The protocol's words, not the SDK's: `ready`, `stopped`, `error`, `authRequired`, `starting`. Each kind carries different required fields, and only the last two carry any. |
| `session/mcpServerStartRequested` | both | ✅ | Also how a server nobody has signed into is signed into, because lifting the disabled flag alone brings it straight back needing one. |
| `session/mcpServerStopRequested` | both | ✅ | Straight through to the CLI's own toggle. |
| `session/isReadChanged` | client | ✅ | This host's own bit, kept per session and never seen by a backend. |
| `session/isArchivedChanged` | client | ✅ | The same, and the reason a row with no agent running still has a status to report. |
| `session/activityChanged` | host | ✅ | What the session is doing in one line, taken from whichever chat is driving it. Absent means idle, which is a field left off rather than an empty string. |
| `session/changesetsChanged` | host | ✅ | The catalogue of changesets a client may subscribe to. A template with no variables is the whole scope; the `{turnId}` ones are not served. |
| `session/configChanged` | both | ✅ | A key whose property says `scope: chat` reaches this chat only; anything else reaches every chat in the session, because a voice set on one of them is a session where two conversations answer differently. Refused in the backend's own words when it will not take the key. |
| `session/metaChanged` | host | ✅ | Replaces `_meta` whole, which is why the git facts are rebuilt rather than patched: a host with two sources of `_meta` would have each take the other's away. |

### `chat/*` — 29 of 30

| action | origin | ahpd | Notes |
| --- | :---: | :---: | --- |
| `chat/turnStarted` | both | ✅ | A client starts a turn; this host also starts one when a queued message is taken up, and then carries `queuedMessageId` so the client can retire its own row. |
| `chat/delta` | host | ✅ | Appends to a `markdown` part. The part is opened first, always - a delta naming a part nobody opened is text the client has nowhere to put. |
| `chat/responsePart` | host | ✅ | Opens a part. Also how a complete block arrives when it did not stream. |
| `chat/toolCallStart` | host | ✅ | As soon as the model names the tool, before its arguments exist. Carries a `ToolCallMcpContributor` for anything named `mcp__<server>__<tool>`. |
| `chat/toolCallDelta` | host | ✅ | Appends the arguments' JSON to `partialInput` as it arrives, so a row is drawn while the call is still being written rather than after. |
| `chat/toolCallReady` | host | ✅ | Closes a streaming call with the parsed input. `confirmed: not-needed` unless `canUseTool` actually asked - without it the reducer draws every call in the transcript as a question nobody put. |
| `chat/toolCallConfirmed` | both | ✅ | A client answering; and this host saying what was answered, for the other clients watching. |
| `chat/toolCallComplete` | both | ✅ | The result as one object. A tool that failed is `completed` with `result.success: false` - `ToolCallStatus` has no `failed`. From a client too, for a tool that client provides: that is what unblocks the agent, and only the client the call was reported against may send one. Nothing is echoed from it - the result goes back to the harness, the harness writes the tool result, and the completion everybody sees comes off that, the same path every other call takes. |
| `chat/toolCallResultConfirmed` | client | 🚫 | Refused, and genuinely inapplicable rather than unwritten: it belongs to a call completed with `requiresResultConfirmation`, the SDK's only approval moment is `canUseTool` *before* a tool runs, and there is no after-the-fact gate to reflect. A host could invent a policy of its own here; that would be this host asking a question the backend never asked. |
| `chat/toolCallContentChanged` | client | ✅ | Streaming into a call while it runs, which is the *contributor's* to do. Relayed rather than reduced: what a tool prints as it runs is the running client's to say and this host holds none of it. Refused from anyone but the client named in the call's `ToolCallClientContributor`, and for a call no client is running - a call of the agent's own has no contributor to be. |
| `chat/toolCallAuthRequired` | host | ✅ | The SDK surfaces no per-call auth moment, so the join is made here: a server that starts asking blocks whatever was running against it. Only when the resource was discovered - the action carries a whole `McpAuthRequirement`, and a client told to sign in with nowhere to do it is worse than one told the server errored. |
| `chat/toolCallAuthResolved` | host | ✅ | When the server is ready again, paired with the `session/inputNeededRemoved` that lifts the session-level block. |
| `chat/turnComplete` | host | ✅ | Carries a required `duration`. A turn that ended badly ends with `chat/error` instead; both are endings, and which one says how it went. |
| `chat/turnCancelled` | both | ✅ | Also carries a required `duration` - a missing number here is `NaN`, which throws inside the reducer rather than drawing anything. |
| `chat/error` | host | ✅ | The ending, not a message beside one: it carries the `turnId` and the duration the completion would have. |
| `chat/turnResume` | client | ✅ | The protocol's conditions - latest, errored, message and parts intact - are the backend's to check, because only it knows what its last turn was. A backend that cannot re-run one says so rather than being asked to. |
| `chat/activityChanged` | host | ✅ | What this chat is doing, in the tool's own words while one runs. Sent with no `activity` to clear it. |
| `chat/workingDirectorySet` | client | ✅ | A chat may hold any subset of its session's directories and never more; anything outside is refused rather than quietly widening the session. The change starts that one chat again, resumed. |
| `chat/workingDirectoryRemoved` | client | ✅ | The primary cannot be removed, for the reason the session's cannot: it is where the process is rooted. |
| `chat/usage` | host | ✅ | Tokens and the model that spent them, at the end of the turn. |
| `chat/reasoning` | host | ✅ | Appends to a `reasoning` part. Defined against that kind specifically - the canonical reducer returns the state unchanged for a `chat/delta` naming one, which draws a thinking header with nothing under it. |
| `chat/pendingMessageSet` | both | ✅ | Both kinds: a `queued` message waits for the running turn, a `steering` one goes into it - the prompt handed to the CLI is a generator that stays open for the life of the session. |
| `chat/pendingMessageRemoved` | both | ✅ | When the client withdraws one, and when this host takes one up into a turn. |
| `chat/queuedMessagesReordered` | both | ✅ | Anything the order did not name keeps its place behind what did, rather than being dropped for not having been mentioned. |
| `chat/draftChanged` | both | ✅ | A `Message`, not a string. Held by the session so two people on one chat see each other's, which is the only reason a draft is on the wire at all. Taken for a session nothing is running for too - kept by this host until one starts and handed over when it does, because typing into a row from the catalogue is what somebody does *before* there is any reason to start an agent, and refusing it is a composer that empties itself as it is typed into. |
| `chat/inputRequested` | host | ✅ | From the CLI's own elicitation. Mirrored to `session/inputNeeded` so a client watching the catalogue sees the session is blocked. |
| `chat/inputAnswerChanged` | client | ✅ | One question of an open request, as somebody types the answer. Held on the request this host already keeps open and echoed to everyone watching the chat, for the reason `chat/draftChanged` is: two people answering one elicitation are answering one form. Kept on the request rather than beside it, so a client that arrives mid-question reads what is already filled in from `session.inputNeeded` - and so `chat/inputCompleted` carrying no answers of its own is completed with what was synced, which the protocol says is where they are. |
| `chat/inputCompleted` | both | ✅ | Accept, decline or cancel. Declining is an answer, and the CLI is told it rather than left waiting. |
| `chat/truncated` | client | ✅ | Drops the turns after a named one - the edit-and-resend flow, and nothing to do with the harness compacting its own context. Served as a rewind, because dropping them from the screen alone would leave the agent answering the message that was edited away: the CLI is started again resumed at the kept turn's *last* chain entry, the turns up to there are handed over as the seed, and the session id is kept so a later resume reaches the truncated conversation rather than the one this dropped. Two things it will not do. A turn read back off a transcript has no rewind point - the backend's names for what it did are recorded only while this process watches it run - and truncating to one is refused rather than half-done. And the action's `turnId` is optional, meaning "clear everything", which as a rewind is a cut before the first prompt and names no entry at all; that form is refused too. Compaction *is* handled and is a different thing: the harness announces it as `compact_boundary`, and this host turns it into a `systemNotification` response part saying how many tokens went where - the turns it compacted are all still in the transcript, so dropping them would be untrue. |
| `chat/turnsLoaded` | host | ✅ | The answer to `fetchTurns`, sent on the channel rather than in the result, so every client watching the chat gets the page and not only the one that asked. |

### `terminal/*` — 11 of 11 🧩

| action | origin | ahpd | Notes |
| --- | :---: | :---: | --- |
| `terminal/data` | host | ✅ | Every byte the shell wrote, and the same bytes are kept as scrollback so a client subscribing late sees what happened. Capped, because a terminal left running `tail -f` is a host holding a day of output for a client that may never come back. |
| `terminal/input` | client | ✅ | Under pipes a `^C` is turned into a signal to the process group, because there is no line discipline to do it; under a pseudoterminal the byte is written through and the discipline does it. |
| `terminal/resized` | both | ✅ | A pseudoterminal is told and sends `SIGWINCH` itself. Without one the size is kept because the state reports it and a client draws to it. |
| `terminal/claimed` | both | ✅ | Who the terminal belongs to - a client, or a session that opened it for a `!` command. |
| `terminal/titleChanged` | both | ✅ | Set by a client, or defaulted to the shell's own name. |
| `terminal/cwdChanged` | host | ✅ | Read out of the shell's own OSC 7, so it is a fact rather than a guess. Under a pseudoterminal only. |
| `terminal/exited` | host | ✅ | Announced when the pipes drain rather than when the process goes: between the two there is output written and not yet read, which is exactly what a `!` command reads back. |
| `terminal/cleared` | both | ✅ | Drops the scrollback and keeps the size, the title and the claim - a client clears a terminal to stop reading what is there, not to give it up. Nothing reaches the process, which has no notion of its own output being discarded. |
| `terminal/commandDetectionAvailable` | host | ✅ | Said once at the start, under a pseudoterminal. A client MUST check this before relying on command boundaries. |
| `terminal/commandExecuted` | host | ✅ | From the shell's OSC 133 `C` mark, with the command line read back off what was typed since the prompt. |
| `terminal/commandFinished` | host | ✅ | From the `D` mark, with the shell's own exit code and the duration since `C`. |

### `changeset/*` — 8 of 8 🧩

| action | origin | ahpd | Notes |
| --- | :---: | :---: | --- |
| `changeset/statusChanged` | host | ✅ | When only the status moved and the files did not. |
| `changeset/fileSet` | host | ✅ | Chosen when fewer actions than files moved. |
| `changeset/fileRemoved` | host | ✅ | The same choice, for a file that left the set. |
| `changeset/filesReviewChanged` | client | ✅ | A client marking files reviewed. The one changeset action a client originates. |
| `changeset/contentChanged` | host | ✅ | Chosen when the whole set is the smaller thing to send. It reduces to the same state as the per-file pair, which is what makes choosing between them safe. |
| `changeset/operationsChanged` | host | ✅ | The verbs the source advertises, with this host's own answer to whether each may be pressed now. |
| `changeset/operationStatusChanged` | host | ✅ | While one runs, and when it finishes or fails. |
| `changeset/cleared` | host | ✅ | When everything went. A changeset whose files did not move says nothing about them at all - re-sending a set a client already holds tells it nothing. |

### `annotations/*` — 5 of 5

| action | origin | ahpd | Notes |
| --- | :---: | :---: | --- |
| `annotations/set` | client | ✅ | Reduced with the package's own `annotationsReducer`, so this host and its clients cannot disagree about what a mark became. |
| `annotations/updated` | client | ✅ | An action naming an annotation the session does not have is refused rather than echoed: the reducer answers an unknown id by handing back the state it was given, and echoing that would leave the client holding a mark this host never kept. |
| `annotations/removed` | client | ✅ | The same rule, and the same refusal for an id nothing here has. |
| `annotations/entrySet` | client | ✅ | A comment inside a mark. |
| `annotations/entryRemoved` | client | ✅ | And taking one out. |

### `resourceWatch/*` — 1 of 1 🧩

| action | origin | ahpd | Notes |
| --- | :---: | :---: | --- |
| `resourceWatch/changed` | host | ✅ | In coalesced batches, with globs for `includes` and `excludes`. On a watch over a *client's* resources it is that client that dispatches this, and this host relays it - see [server-to-client commands](#server-to-client-commands). |

### `automation/*` — 4 of 4 🧩

| action | origin | ahpd | Notes |
| --- | :---: | :---: | --- |
| `automation/createRequested` | client | ✅ | A request, not a fact: what goes back is `automation/set` saying what this host actually holds, which is not an echo of what was asked for. |
| `automation/updateRequested` | client | ✅ | A patch. Absent keys are left alone, so one client does not revert another. |
| `automation/set` | host | ✅ | The answer to both requests, and how a store with a clock announces one that fired on its own. |
| `automation/removed` | both | ✅ | Refused when the catalogue says `remove` is not among the operations, rather than done anyway. |

### `automationRun/*` — 5 of 5 🧩

| action | origin | ahpd | Notes |
| --- | :---: | :---: | --- |
| `automationRun/lifecycleChanged` | host | ✅ | `pending`, `running`, `completed`, `failed`, `cancelled`, and when each happened. A run that failed says so rather than vanishing. |
| `automationRun/sessionSet` | host | ✅ | One action per session that joined. Neither this nor its pair carries a whole set, so what goes out is the difference since the last time this looked. |
| `automationRun/sessionRemoved` | host | ✅ | And one per session that went - a disposed session is unlinked from the run it belonged to, so a client is not left pointing at a channel nobody can open. |
| `automationRun/primarySessionChanged` | host | ✅ | The one a client opens when it opens the run. Cleared when that session is the one removed. |
| `automationRun/cancelRequested` | client | ✅ | A request the store answers, because only it knows whether the run has got far enough to be stopped. |

### What a refusal is

Anything dispatched that this host will not act on is **refused**, not dropped:
an envelope carrying `rejectionReason` goes back to the connection that sent it,
naming the action and saying what would not have it. A client applies an action
before sending it, so a host that stayed silent left that client holding a
change this host never made.

A refusal moves no `serverSeq` and is not buffered for replay, because it moves
no state; and it goes to the one connection that dispatched it rather than to
everyone watching, because nobody else applied it optimistically and a client
that reduced one would apply the very change this host declined to make.

## Behaviour worth knowing

### Restarts

| | |
| --- | --- |
| read and archived do not survive one | `IsRead` and `IsArchived` are this host's rather than a backend's, are shared by every client, and are held in memory. A restart returns every archived session to the catalogue and marks every read one unread, for everybody, with nothing said about it |
| so do the settings chosen for a session | the configuration values in force are held the same way and go the same way, back to each agent's defaults |
| the sessions themselves come back | they are read from the backend's own transcripts, so what a restart loses is only what this host added on top of them. A store for that is a port this host does not yet have, the way `automations` is one it does |

### Turns

| | |
| --- | --- |
| a turn is said back | `chat/turnStarted` arrives from a client and this host emits it again. Nothing in a client applies what it sent itself, so a host that reduced it privately goes on to emit response parts for a turn no client has |
| the running turn is `activeTurn` | and is not in `turns`. It moves across when it completes |
| a part exists before it streams | `chat/responsePart` creates it, `chat/delta` appends to it |
| the append action follows the part | `chat/delta` is defined against a *markdown* part and `chat/reasoning` against a *reasoning* one, and the canonical reducer returns the part unchanged when they do not match. Thinking sent as a `chat/delta` opens a part and never fills it |
| one action ends a turn | `chat/turnComplete` when it worked, `chat/error` when it did not - and `chat/error` *is* the ending, carrying `turnId`, a required `duration` and the error part it appends. Both `chat/turnComplete` and `chat/turnCancelled` carry a required `duration` too: a client clamps it with `Math.max(0, duration)`, so an absent one is `NaN` rather than a missing number and throws inside the reducer |
| `serverSeq` moves with state | never with messages. A snapshot is taken at a sequence number and every action after it carries a greater one, which is how a client knows it missed nothing |

### Tool calls

| | |
| --- | --- |
| `chat/toolCallStart` creates the part | `chat/responsePart` must not also be sent for one, or every tool call is in the transcript twice |
| `confirmed` is the difference | `chat/toolCallReady` with `confirmed: 'not-needed'` is a tool running; the same action without it is one waiting to be allowed. Leave it off a tool that is not asking and a record of things that already ran is drawn as a queue of questions nobody put |
| the result is one object | `chat/toolCallComplete` carries `result: { success, pastTenseMessage, content?, error? }`. A client's reducer spreads `action.result` over the call and reads nothing else, so a `content` beside it is dropped without a word |
| a failed tool is `completed` | `ToolCallStatus` has no `failed`. What went wrong is `result.success` and `result.error` |
| the id is the agent's | `canUseTool` asks under the agent's own `toolUseID`. A confirmation with an id of the host's making is a second row for one call, answered under a name no client was given |

### A client's tools are the client's to run

A client announces what it can run on `SessionActiveClient.tools`, and the
protocol makes that client responsible for executing the call and dispatching
its result. Three things about serving that are not obvious from the types.

**They ride this host's own MCP server.** The harness reaches a contributed
tool through `createSdkMcpServer`, so a client's tools and this host's arrive at
the model in one in-process server named `ahp`. By name they are all
`mcp__ahp__*`, which means the server they came through cannot say whose they
are - so the call's `contributor` is a `ToolCallClientContributor` looked up
from the announcement rather than the `ToolCallMcpContributor` the name implies.
A client's own beats the server it is offered through, or every client would be
told the call is nobody's to answer, including the one whose call it is.

**A client's are named `<clientId>__<name>`.** Two clients in one session may
both provide `openFile` and the model is offered one list.

**Joining the call to the handler is this host's problem.** They arrive
separately and neither carries the other's name: the assistant frame opens the
call under the harness's id, and the in-process handler is invoked with the
input and nothing else - the SDK surfaces a `toolUseID` to `canUseTool` and to
hooks, and *not* to a tool. So the two are matched by tool name and then by the
input itself, which is what tells two concurrent calls of one tool apart.

**Nothing is echoed on completion.** A client's `chat/toolCallComplete` is what
unblocks the agent; the result then goes back to the harness, the harness writes
the tool result, and the completion every client sees comes off that - the same
path every other tool call takes. Relaying the client's own would draw the row
finished twice, once from a client's word and once from what happened.

**A client that leaves fails its calls.** Outstanding calls are answered as
failed rather than left open: the agent is waiting on a promise nothing can
settle any more, and a turn that hangs for ever is worse than a tool that says
it could not run.

### Being asked

`session/inputNeeded` is a **list**, and `session/inputNeededSet` carries
`request` and adds *or updates* the entry with that id; `inputNeededRemoved`
carries the `id`. Two kinds are served:

| kind | what it is | answered by |
| --- | --- | --- |
| `toolConfirmation` | a tool call waiting to be allowed | `chat/toolCallConfirmed`, keyed by `toolCall.toolCallId` |
| `chatInput` | a question the agent asked | `chat/inputCompleted`, keyed by `request.id`, with `response: 'accept' \| 'decline' \| 'cancel'` |

Both are held in a map keyed by id, never in one slot: the CLI calls
`canUseTool` per tool call, and an agent that fires two in parallel asks twice
before either is answered.

### What a model row says

`SessionModelInfo` carries `id`, `provider`, `name` and a per-model
`configSchema`. `configSchema` holds one property, `thinkingLevel`, built from
that model's own `supportedEffortLevels` - some Claude models take all five
efforts, some take one, some take none, and a model that takes none carries no
schema, so a client draws no control for it. `thinkingLevel` is the key the
reference client's picker writes into `ModelSelection.config`, and a turn that
arrives with one sets the effort for that turn and the ones after it, because
the CLI holds a single effort setting per query rather than one per turn - so
`session/configChanged` goes out for the session-wide `effortLevel` at the same
time, and the two controls never describe different futures. Where models carry
their own schema the session-wide `effortLevel` key is not advertised at all:
two controls reaching one setting is one too many.

The other five declared fields - `maxContextWindow`, `maxOutputTokens`,
`maxPromptTokens`, `supportsVision` and `policyState` - are absent, and are
optional in the protocol. The Claude SDK's `ModelInfo` reports none of them: it
has `supportsEffort`, `supportedEffortLevels`, `supportsAdaptiveThinking`,
`supportsFastMode` and `supportsAutoMode`, and nothing about context size,
output limits, vision or policy. VS Code's own host is in the same position on
the same transport and sends the same subset; the limits appear only on its
Copilot-routed projection, which reads them from a model catalogue over HTTP.
Filling them here would mean a second source of facts about a model, and an
invented number is worse than an absent field. A client reads an absent
`supportsVision` as `false` and an absent `policyState` as "not disabled",
which are the right answers.

### Chat URIs

A session's first chat is `ahp-chat://default/<base64url(sessionUri)>`, and the
older `ahp-chat:/<sessionId>` still resolves to the same chat.

That is the reference implementation's shape rather than the one the
specification illustrates, and it is a deliberate retreat. The specification
documents `ahp-chat:/<uuid>` and says the owning session is "**not** encoded in
the chat URI - the relationship is expressed via the session's `chats`
catalogue". This host published exactly that. VS Code's client computes the
other shape from the session rather than reading the catalogue, so it subscribed
to a channel that did not exist while the conversation sat on the one it had
been told about, and its pane stayed empty against a host that was working.

Answering *both* was tried first and is not enough. The disagreement is not only
about which channel to open: `defaultChat`, every entry in `chats`, and
`ChatState.resource` name a chat too, and a client that subscribed to one string
and is then told the chat is at another cannot pair them up. One name has to win
everywhere, and it has to be the one the only other implementation computes.

`default` is a **role**, not an identity: it means whichever chat a client gets
when it names none. Dispose that chat and the name follows the default to its
successor. A second chat is named by whoever created it and is not derived from
anything.

### Session URIs

A session URI is the **client's** to name and this host's to echo, and only the
id inside one is ever read. This host lists a session as `<provider>:/<uuid>`,
which is what the only other implementation computes - it builds a session URI
that way both when it creates a session and when it reopens one it listed.

It used to publish `ahp-session:/<uuid>` instead, and that gave that client two
strings for one session. Which one it reached for came out of its own stored
state, so the same session, with the same bytes behind it, drew its
conversation when addressed as `claude:/<uuid>` and drew nothing when addressed
as `ahp-session:/<uuid>`. Two captures a minute apart, identical on the wire
apart from the scheme, is what settled it.

The older spelling is still answered, because only the id is read.

Both are also *keyed* as one now. They were not: who owns a session, where it
ran, the bits a client set on it and the settings chosen for it before it starts
were all stored under the catalogue's name, and a lookup under the client's name
found nothing - a row marked read that came back unread, and a browsed session
that could not be continued because no backend owned a name nobody had stored.

And a session answered under an alias has **every** URI in it spelled from that
alias, because a chat URI and a changeset URI both contain a session URI. Told
otherwise, a client subscribes to the chat it computed, reads a `defaultChat`
naming another, and cannot pair the two: it holds a subscription nothing refers
to and a reference nothing is subscribed to, and draws an empty conversation
with no error.

A `changesets` template is the subtler half of that, and it is how the held
spelling escaped. A client resolves a changeset channel back to the session
that owns it, so a template naming `ahp-session:/x` teaches a client that asked
about `claude:/x` a second name for the same session - and it then addresses
the session, its chat and its annotations under that one. Which name the
conversation ends up keyed by is whichever subscription happened to land
first, so it drew sometimes and not others.

A session a client creates is stored under the id the client chose, by naming
it to the backend. Left to itself the backend invents an id and writes the
transcript under that, so while this daemon ran it answered to both names and
the moment it restarted the client's own URI was dead - `No agent for session`,
about a session that was still there. Only where the client named a UUID, which
is what the backend will take.

### A slash command is a message

The commands a client offers behind `/` are the CLI's own - `compact`,
`autocompact`, `clear`, `context`, `model` and the rest, fifty-odd of them,
reported at the handshake in `initializationResult().commands` and carried onto
the session as `prompt` and `skill` customizations.

Running one needs nothing special: the text goes to the backend as an ordinary
turn, and the CLI recognises the slash and runs it *locally* - the answer comes
back as an assistant message with `num_turns: 0`, no model call. So a host does
not implement `/compact`; it stays out of the way of it.

Which is why the menu is built from `customizations` rather than from a list
this host keeps. Two sessions in one directory can be handed different
commands, and a skill discovered while the agent works in a subdirectory
appears in one of them and not the other.

**A completion has to say that it is a command.** `SimpleMessageAttachment`
carries a `label` and a `modelRepresentation` and has no notion of a slash
command, so the reference client reads one out of the attachment's `_meta`: a
bag carrying `command` is a slash command, one carrying `uri` is a skill, and
one carrying neither is **dropped without a word**. So every item this host
answers with carries

```jsonc
"_meta": {
  "command": "compact",            // the name, without the slash
  "description": "…",              // the second column in the menu
  "argumentHint": "<file>"         // ghost text after an accepted item
}
```

This is the protocol's own escape hatch rather than an invented field -
`_meta` is declared on `MessageAttachmentBase` - but it is a convention, not a
declaration, and a host that does not know it is one whose menu comes back
full and draws empty. Which is exactly what this host did: fifty-four items
answered, every one discarded on arrival, and nothing anywhere reporting an
error. The client's own reader notes that `argumentHint` may be promoted to a
first-class attachment field later; until then the bag is the contract.

### Customizations are containers

A top-level `Customization` is a **container** - a plugin or a directory -
whose leaves are its `children`, or a bare MCP server. Skills, prompts and
agents are `ChildCustomization`s and belong inside one. This host published
them flat, so a client read each as a *plugin* and walked `<uri>/agents`,
`<uri>/skills`, `<uri>/commands` and `<uri>/rules` looking for its contents -
four failed reads apiece, against a `uri` that was a bare name rather than
anything a filesystem could answer.

One container per kind, because `contents` names a single
`ChildCustomizationType`. The directory is the conventional one for that kind:
the CLI reports *what* it loaded and never where it came from, so this is where
a person would go to add one rather than a path this host read off disk.

### A rebuilt turn is a turn

There are two builders - a live session's, driven by the CLI's message stream,
and a browsed one's, rebuilt from the transcript on disk - and they answer the
same question. The rebuilt one drifted: it wrote `status: 'failed'`, which is
not one of the seven `ToolCallStatus` values and matched no variant at all;
left `confirmed` off, so a client read every past call as a question waiting on
somebody; left `invocationMessage` off unless the input summarised to
something, so the row had no sentence to draw; and wrote content blocks with no
`type`. It also reported no `usage`, though the transcript records the token
counts and the model on every assistant frame.

This matters more than it looks: every session a client opens after this daemon
restarts is a rebuilt one.

### An action that changes nothing is not a change

`serverSeq` advances with **state** and never with messages, so a dispatch
saying what this host already held is answered with silence rather than an
echo. `session/isReadChanged` always did this; `session/activeClientSet` did
not, and the omission was a loop: a client reconciles what it contributes
whenever the session state moves, this host's echo *is* the state moving, and
so the echo was the change that prompted the next announcement. Three hundred
round trips in a few seconds, a sequence number apiece.

### The snapshot and the actions have to agree

A client driven by actions builds its own state; a client that subscribes reads
the snapshot. Both are this host's answer to the same question, and a field
carried by one and not the other is a client that renders differently depending
on when it arrived. `invocationMessage` and `confirmed` were sent on
`chat/toolCallReady` and never written onto the call itself, so every tool call
in a *transcript* was a row with no sentence to draw and no answer to whether
anybody had approved it - `ToolCallState` requires both.

### Sessions and the catalogue

| | |
| --- | --- |
| past sessions | every catalogue row opens from its transcript - a file read, no CLI - and is resumed only when somebody starts a turn on it |
| capabilities | models, skills, slash commands, subagents and MCP servers are read from the CLI's *control* protocol at startup, so they are known before any turn. A composer that waited for the first session could only offer them once the conversation had started |
| skills | told apart from built-in prompts, and a skill the CLI keeps for the agent is not offered after a slash |
| toggling a skill or prompt | refused out loud: the CLI has no runtime switch, and the list goes back out so the control returns to where it was |
| toggling an MCP server | through the CLI, then read back. Switching on one that is not ready reconnects it, which is how signing in happens |
| who else is here | `activeClients` on the session, `session/activeClientSet` from a client and `activeClientRemoved` from the host - taken out on unsubscribe, on a dropped connection, and on a reconnect that does not ask for the session back, and kept while another window of the same client still is |
| read and archived | kept per session and told to every client, including for rows no agent is running for |
| project and branch | `project` on every row from the path alone, and `_meta.git.branch` beside it when the host was given `gitBranches()` |
| when it began | `createdAt` is an identity field and does not move: a resumed session takes the value its own backend's catalogue gives, and a session started here takes the moment it was started. `modifiedAt` is the one that changes |

### Changesets

All four scopes: `session`, `turn/{turnId}`, `compare/{a}/{b}` and
`uncommitted`, at `<sessionUri>/changeset/<scope>`. A changeset is a *scope*
nested under the session URI, so disposal is a prefix scan.

Both sides of every edit: `after` is the file, `before` is `git show HEAD:`
behind a URI this host resolves itself, because what a file used to be is not a
file on disk.

Operations are server-advertised per scope, `disabled` while a turn is running,
and destructive ones carry the `confirmation` a client MUST show. `commit` acts
on the working tree, `discard` on a file, `revert` on a file back to the state
the agent found it in.

### Authentication

The Claude agent advertises `https://api.anthropic.com` in
`AgentInfo.protectedResources` as `required: false` - a token is an override,
because this daemon inherits the credentials of whoever started it and works
with none pushed.

A pushed token is held **per connection**, as the specification requires, and
spent only on sessions that client asks for. It is passed to the harness as
`ANTHROPIC_API_KEY` **over** the daemon's own environment, never instead of it:
the SDK's `env` replaces the subprocess environment rather than merging with it,
so handing it a lone credential is a subprocess with no `PATH`.

An automation firing at nine in the morning has no connection behind it and runs
on the daemon's own credentials.

This is not the same as the [connection token](DAEMON.md#who-may-connect),
which is about who may reach the host at all.

## Three things in the package that do not hold

Not this host's behaviour - the protocol package's own, found by writing against
it. Recorded here because each one is silent: nothing errors, and what you get
instead is a menu that draws empty, a type no JSON satisfies, or a message that
grows a prefix every time it is passed on.

**`ActionEnvelope.origin` cannot be satisfied by JSON.** It is declared
`readonly origin: ActionOrigin | undefined` - a *required* property whose type
includes `undefined`. JSON has no `undefined`: omit the key and the interface is
not satisfied, send `null` and it is the wrong type. Every action a host
originates has no origin, so this is the common case rather than an edge, and
every host writing TypeScript against the package works around it in the same
place. `origin?: ActionOrigin` says the same thing and is satisfiable.

**A completion has to say that it is a command, and nothing declares that.**
`SimpleMessageAttachment` has no notion of a slash command, so the reference
client reads one out of the attachment's `_meta`: a bag carrying `command` is a
slash command, one carrying `uri` is a skill, and one carrying neither is
dropped without a word. `_meta` is a legitimate escape hatch - it is declared on
`MessageAttachmentBase` - but the convention is not written down anywhere a host
would find it, and the failure is silent. See [a slash command is a
message](#a-slash-command-is-a-message) for what this host answers with.

**`RpcError` does not survive a round trip through the package's own client.**
Its constructor puts the code into the message - `RPC error ${code}: ${message}`
- and the client, re-serialising an error thrown from a server-request handler,
writes that decorated message back onto the wire beside the code it already
carries. Code and data survive; the message gains a prefix per hop, so an error
relayed twice reads `RPC error -32602: RPC error -32602: …`.

## How this is checked

[`test/conformance.test.ts`](../test/conformance.test.ts) drives the host and
then replays every action it emitted through the protocol package's **own
reducers** - `rootReducer`, `sessionReducer`, `chatReducer`, `terminalReducer`,
`changesetReducer` - rather than reading state back out of a snapshot this host
also wrote.

That distinction is the whole value of it. A snapshot is this host agreeing with
itself: a field under the wrong name, or beside its action rather than inside
it, round-trips perfectly and is still unreadable to anybody else. Every shape
defect this repository has had was invisible that way - a bare `inputNeeded`
where the action carries `request`, a tool result beside `chat/toolCallComplete`
rather than in its `result`, a `chat/turnCancelled` with no `duration`. VS Code
runs those reducers. So does `ahpc`.

What a reducer cannot see is an *undeclared* field: it ignores what it does not
know, and so does TypeScript - a conditional spread, `...(x ? { model } : {})`,
is not excess-property-checked, which is how `SessionState.model`,
`argumentHint` and a config property's `scope` each reached the wire from a
codebase typed against the package.

So [`test/wire.test.ts`](../test/wire.test.ts) closes the objects.
[`tools/schema.mjs`](../tools/schema.mjs) generates a strict JSON Schema from
the package's own declarations - `additionalProperties: false` everywhere,
which the shipped `state.schema.json` has nowhere - and every frame the test
produces goes through ajv against it. An undeclared key and a missing required
one both fail the build, which is the only reason either is findable before a
client trips over it.

The frames are written out as
[`test/fixtures/wire.jsonl`](../test/fixtures/wire.jsonl): a capture of the
commands and actions above, with timestamps and generated ids replaced by
stable ones so it can be diffed when something moves. The same check runs over
a recording taken off a real daemon:

```bash
pnpm schema                            # after a protocol bump
pnpm wire -- test/fixtures/wire.jsonl  # or a capture from scripts/tee.mjs
```
