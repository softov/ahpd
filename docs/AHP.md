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

| | |
| --- | --- |
| ✅ | implemented as specified |
| 🔀 | implemented, differently from the obvious reading - the Notes say how |
| 🧩 | arrives through a host port, so it depends on what the host was given |
| 🚧 | partial: some of the group is served and some is not |
| ➖ | not implemented, and nothing decided |
| 🚫 | deliberately unsupported, with a reason |

## Commands

**31 of the 32 declared.** Everything not listed here answers `-32601`.

| AHP | ahpd | Status | Notes |
| --- | --- | :---: | --- |
| `initialize`, `ping` | handshake and version negotiation | ✅ | Answers with a version the client actually offered, in the client's order of preference. `initialSubscriptions` come back as snapshots in the same response. A refusal carries `supportedVersions`, which is what a client reads to pick one to retry with. `automations` is advertised when this host was given a store, because presence is what *permits* a client to use the channel and the three commands. `terminalCommandPrefix` is `"!"` when this host was given a `terminals` port and absent when it was not, which is the protocol's own way of saying the shorthand is unsupported |
| `subscribe`, `unsubscribe` | channel subscriptions | ✅ | Per connection, not per channel: one client unsubscribing does not stop another's stream. The snapshot is taken *at* a `serverSeq`, and anything dispatched while it was being taken is replayed on top of it. Subscribing twice to one channel is answered twice, including while the first snapshot is still being taken - the reference host instead cancels the earlier subscribe and answers it `-32001` naming a channel it is serving, so a client written against that one may never send the second |
| `reconnect` | replay from a `serverSeq` | ✅ | Replays what a dropped client missed, or hands back snapshots when the gap is longer than the buffer |
| `dispatchAction` | client-origin state actions | 🚧 | See [state actions](#state-actions) for which. The echo carries `origin` - the `clientId` and `clientSeq` the dispatch came with - and one this host will not act on comes back carrying `rejectionReason` instead |
| `listSessions`, `createSession`, `disposeSession` | the catalogue and its lifecycle | ✅ | Most-recently-modified first, live sessions included. Every row opens from its transcript - a file read, no CLI - and is **resumed** only when somebody starts a turn on it. `listSessions` pages when a client sends `limit`, and answers the whole catalogue when it does not: neither client that connects to this host reads `nextCursor`, so a default page size would be a catalogue silently cut down to it. There is a bound of 1000 above that, which is not a page size but the point past which one frame stops being servable - it carries `nextCursor` and is written to the log, because it is the one case a client cannot see. A cursor this host did not issue is `-32602`. `createSession.activeClient` takes the creating client into the session as it is made, under the `clientId` it introduced itself with rather than the one in the payload |
| `createChat`, `disposeChat` | several chats per session, `fork`, `sideChat` | ✅ | Each is its own agent process on one directory and one config. A `fork` source continues the conversation from a named turn under a new backend id, carrying the turns through it as visible history; a `sideChat` source copies nothing and hands the model what that turn said, on its first prompt and nowhere else. The last chat cannot be disposed, and the refusal says so. A session's first chat is named `ahp-chat://default/<base64url(sessionUri)>` - see [chat URIs](#chat-uris) |
| `resolveSessionConfig` | the schema before a session exists | ✅ | The same schema a session reports, so a catalogue row is configurable before it is resumed. A backend advertises its own properties and a client draws what it is given; the Claude backend offers the same five approval modes VS Code's own Claude host does. `autoApprove` and `mode` are conventional keys a client dispatches whatever a host advertises, and are mapped onto that one axis on the way in. `permissions` - per-tool allow and deny - is advertised too, and is the first config value here that is not a string: the protocol declares the bag `Record<string, unknown>`, and this one is an object the SDK takes natively as `allowedTools` / `disallowedTools`. This host contributes six properties of its own on top of the backend's - `isolation`, `branch`, `worktreeIncludeFiles`, `worktreeBranchPrefix`, `worktreeCreateNewBranch` and `worktreeBranchTrack` - when it was given a `worktrees` port and the directory is a git repository. They are host-owned: never passed to a backend, and absent entirely when there is no repository to make a worktree in, because a control with one value is one a client draws and nobody can move |
| `sessionConfigCompletions` | `branch` | ✅ | The one key with more values than a picker holds. The schema seeds twenty, most recently committed first, and marks the row `enumDynamic` while a worktree is being made; this answers what somebody types, matching on substring. Every other key is an enum of five or fewer and answers with nothing |
| `fetchTurns` | transcript paging | ✅ | Newest 50 in the snapshot, a cursor for the rest |
| `completions` | `/` against the session's commands | ✅ | Falling back to the harness-wide list |
| `authenticate` | a token for a protected resource | ✅ | See [Authentication](#authentication) |
| `resourceList`, `resourceRead`, `resourceResolve` | reading files | 🧩 | The `resources` port. Only inside the directories the host was told to serve |
| `resourceWrite`, `resourceDelete`, `resourceMkdir`, `resourceMove`, `resourceCopy` | writing files | 🧩 | The same port's optional write half, behind `resourceRequest`. A store without it answers `-32601`, which is not a refusal about a path |
| `resourceRequest` | the write gate | ✅ | Per connection and per resource. An operation that writes is refused `-32009` until granted, and the refusal carries the request that would unlock it |
| `createResourceWatch` | a channel per watch | 🧩 | `resourceWatch/changed` in coalesced batches, globs for `includes` and `excludes`. No dispose command, as the protocol has none: the last `unsubscribe` releases the watcher |
| `createTerminal`, `disposeTerminal` | a shell in a served directory | 🧩 | The `terminals` port |
| `invokeChangesetOperation` | acting on a changeset | 🧩 | The `changes` port advertises the verbs; this host owns their status and the write gate |
| `listAutomationTriggerDefinitions`, `runAutomation`, `fetchAutomationRuns` | automations | 🧩 | The `automations` port. A host given none advertises no `ahp-automations://` channel and answers `-32601`. `listAutomationTriggerDefinitions` is answered on `ahp-root://` and the other two on `ahp-automations://`, which is what each declares - the triggers a host understands are the host's, and a run is of an automation the store holds |

Twenty of the commands declare `channel` as a literal rather than as a URI a
client chooses - `ahp-root://` for all but `runAutomation` and
`fetchAutomationRuns`. Eighteen of those are enforced: a client that names a
different one is refused `-32602`
saying which is right, because a host that answered anyway would make that
client look correct until the first conformant host refused it with nothing on
screen saying why. A client that names *no* channel is taken: it has named
nothing wrong. `initialize` and `ping` are the other two and are exempt - they are
how a client finds out it can talk at all, and refusing either turns a wrong
constant into a connection that never opens.

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

**8 of the 8 declared.**

| AHP | ahpd | Status | Notes |
| --- | --- | :---: | --- |
| `root/sessionAdded`, `root/sessionRemoved`, `root/sessionSummaryChanged` | catalogue lifecycle | ✅ | To the connections watching the root channel and no others. `sessionAdded` carries the whole `summary`; `sessionRemoved` carries `session`; `sessionSummaryChanged` carries `session` and a `changes` partial with the three identity fields left out |
| `otlp/exportLogs` | the host's own log | ✅ | `ahp-otlp://logs/{level}`, advertised at the handshake, carrying an OTLP/JSON `ExportLogsServiceRequest` verbatim - the same lines the daemon writes to stdout. Stateless: never replayed, and a subscriber gets only what happened after it arrived |
| `otlp/exportTraces`, `otlp/exportMetrics` | turns and tool calls | ✅ | `ahp-otlp://traces` and `ahp-otlp://metrics`, both literal channels - the protocol defines template variables for `logs` alone. A turn is a `SPAN_KIND_SERVER` span and every tool call in it a `SPAN_KIND_CLIENT` child, sent as each one ends and joined by `traceId`. The metrics are cumulative sums against the process start, so a collector arriving late reads totals rather than a difference. Both are built from the actions this host already dispatches, so a second backend gets them without knowing they exist |
| `root/progress` | making a session | ✅ | Only when `createSession` carried a `progressToken`, and only to the client that sent it: the token is that request's. Three frames against a total of 2 - the tree, the agent, ready - because making a worktree is `git worktree add` plus whatever the client asked to bring along, which on a large repository is seconds somebody otherwise waits through with nothing on screen |
| `auth/required` | an MCP server that needs signing in | ✅ | Sent off the same state change that carries the requirement - a server saying `authRequired` - to the connections watching that session, once per resource. A client reads it and pushes a token back with `authenticate`. Expiry of a token this host *accepted* is still not reported: nothing here verifies one, so it never learns that one has gone stale |

## State actions

**92 of the 96 declared, across nine channels.** Grouped by channel; a group is
🚧 when some of it is served.

| channel | ahpd | Status | Notes |
| --- | --- | :---: | --- |
| `root/*` | 4 of 4 | ✅ | `agentsChanged`, `activeSessionsChanged`, `terminalsChanged`, and `configChanged` - the last one client-dispatched: VS Code pushes `defaultShell` at connect, and everything else it pushes is kept and read back |
| `session/*` | 28 of 28 | ✅ | Everything a catalogue row and a detail pane read. Two are served and rarely fire: `creationFailed`, for a session an automation could not start - one a client asked for fails inside `createSession`, where there is a request to fail - and `customizationRemoved`, for a customization that went while the rest stayed. `serverToolsChanged` carries the whole set, which is what full replacement means, and goes to every running session when `host.setTools()` is called. `session/workingDirectorySet`, `Removed` and `Replaced` are served: the SDK takes its directories when the CLI starts and offers no way to add one after, so a change starts the backend again *resumed* - the same conversation in a wider place - and is refused `-32004` while a turn is running. Index 0 is the process root: `Removed` on it is refused, and a root that moves is `Replaced` rather than a removal followed by an addition |
| `chat/*` | 26 of 30 | ✅ | The turn, its parts, its tools and its questions. `pendingMessageSet` / `Removed` serve both kinds: a queued message waits for the running turn and a **steering** one goes into it, because the prompt handed to the CLI is a generator that stays open for the life of the session. `toolCallStart` opens a call `streaming` as soon as the model names the tool, `toolCallDelta` appends the arguments' JSON to `partialInput` as it arrives, and `toolCallReady` closes it with the parsed input - so a row is drawn before its arguments exist rather than after. `toolCallAuthRequired` / `AuthResolved` are the mid-call sign-in: the SDK surfaces no per-call auth moment, so the join is made here - every tool named `mcp__<server>__<tool>` carries a `ToolCallMcpContributor`, which the reducer requires before it will take either action, and a server that starts asking blocks whatever was running against it. Paired with `session/inputNeededSet` (kind `toolAuthentication`), and only when the resource was actually discovered: the action carries a whole `McpAuthRequirement`, and a client told to sign in with nowhere to do it is worse than one told the server errored. Not emitted: four client-dispatchable ones, each refused in its own words rather than as unserved: `truncated` (the harness compacted its context, and every one of those turns is still in the transcript), `inputAnswerChanged` (this host holds no `inputRequest` part to keep a draft on - the question lives on `session.inputNeeded`), `toolCallResultConfirmed` (no call this host builds sets `requiresResultConfirmation`) and `toolCallContentChanged` (a contributor's to send, for a tool the client itself provides - every call here is the backend's own and carries no `ToolCallContributor`). `workingDirectorySet` / `Removed` are served: a chat may hold any subset of its session's directories - never more - and a change starts that one chat again, resumed, leaving the session's other chats where they are |
| `terminal/*` | 11 of 11 | ✅ | `data`, `input`, `resized`, `claimed`, `titleChanged`, `cleared`, `exited`. `cleared` drops the scrollback and keeps the size, the title and the claim - a client clears a terminal to stop reading what is there, not to give it up - and nothing reaches the process, which has no notion of its own output being discarded. `exited` is announced when the pipes drain rather than when the process goes, because between the two there is output written and not yet read. The other four are shell integration and arrive with a pseudoterminal: `shellTerminals({ pty })` takes a binding rather than importing one - `node-pty` is the daemon's optional dependency and never the library's - and under it the shell prints its own OSC 133 marks, which become `commandExecuted`, `commandFinished` and `cwdChanged`, with `commandDetectionAvailable` said once at the start. Without a binding the shells run on pipes and the state says `isPty: false` and `supportsCommandDetection: false`, which is what the protocol has those flags for |
| `changeset/*` | 8 of 8 | ✅ | Both forms, chosen per change: `fileSet` / `fileRemoved` when fewer actions than files moved, `cleared` when everything went, `statusChanged` when only the status did, and `contentChanged` when the whole set is the smaller thing to send. They reduce to the same state, which is what makes choosing between them safe. A changeset whose files did not move says nothing about them at all - re-sending the set a client already holds tells it nothing |
| `automation/*` | 4 of 4 | ✅ | |
| `automationRun/*` | 5 of 5 | ✅ | `lifecycleChanged`, `primarySessionChanged`, `cancelRequested`, and `sessionSet` / `sessionRemoved` - sent as the difference, because neither carries a whole set: one action per session that joined and one per session that went. `memoryAutomations` starts one session per run and a store may start several; either way a session disposed is unlinked from the run it belonged to, which clears `primarySession` when it was that one |
| `resourceWatch/*` | 1 of 1 | ✅ | |
| `annotations/*` | 5 of 5 | ✅ | An editor's furniture, and the one channel whose state is entirely a client's: nothing here produces a mark, and what this host contributes is that a mark one client made is one every other client in the session can see. Kept per session under `<sessionUri>/annotations`, reduced with the package's own `annotationsReducer` so host and client cannot disagree, and echoed with `origin`. An action naming an annotation the session does not have is refused rather than echoed - the reducer answers an unknown id by handing back the state it was given, and echoing that would leave the client holding a mark this host never kept |

### Client-dispatchable actions this host acts on

`chat/turnStarted`, `chat/turnCancelled`, `chat/turnResume`,
`chat/toolCallConfirmed`, `chat/toolCallComplete`, `chat/inputCompleted`,
`chat/pendingMessageSet` / `Removed`, `chat/queuedMessagesReordered`,
`chat/draftChanged`, `chat/workingDirectorySet` / `Removed`,
`session/configChanged`, `session/titleChanged`, `session/isReadChanged`,
`session/isArchivedChanged`, `session/activeClientSet` / `Removed`,
`session/customizationToggled`,
`session/mcpServerStartRequested` / `StopRequested`,
`session/workingDirectorySet` / `Removed` / `Replaced`,
`changeset/filesReviewChanged`, `terminal/input`, `terminal/resized`,
`terminal/claimed`, `terminal/titleChanged`, `terminal/cleared`,
`automation/createRequested` / `updateRequested` / `removed`,
`automationRun/cancelRequested`, `root/configChanged`,
`annotations/set` / `updated` / `removed` / `entrySet` / `entryRemoved`.

Anything else dispatched is **refused**, not dropped: an envelope carrying
`rejectionReason` goes back to the connection that sent it, naming the action
and saying what would not have it. A client applies an action before sending
it, so a host that stayed silent left that client holding a change this host
never made.

A refusal moves no `serverSeq` and is not buffered for replay, because it moves
no state; and it goes to the one connection that dispatched it rather than to
everyone watching, because nobody else applied it optimistically and a client
that reduced one would apply the very change this host declined to make.

### Server-origin actions this host emits

`session/ready`, `session/titleChanged`, `session/activityChanged`,
`session/metaChanged`, `session/configChanged`, `session/changesetsChanged`,
`session/customizationsChanged` / `customizationUpdated`,
`session/chatAdded` / `chatRemoved` / `chatUpdated` / `defaultChatChanged`,
`session/inputNeededSet` / `inputNeededRemoved`,
`session/mcpServerStateChanged`, `session/activeClientRemoved` -
`chat/turnStarted`, `chat/responsePart`, `chat/delta`, `chat/reasoning`,
`chat/toolCallStart` / `toolCallReady` / `toolCallConfirmed` /
`toolCallComplete`, `chat/inputRequested`, `chat/inputCompleted`,
`chat/usage`, `chat/activityChanged`, `chat/turnComplete`,
`chat/turnCancelled`, `chat/error`, `chat/turnsLoaded` -
`changeset/contentChanged` / `operationsChanged` / `operationStatusChanged` -
`terminal/data` / `titleChanged` / `resized` / `claimed` / `exited` -
`root/agentsChanged` / `activeSessionsChanged` / `terminalsChanged` / `configChanged`.

## Behaviour worth knowing

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
npm run schema                            # after a protocol bump
npm run wire -- test/fixtures/wire.jsonl  # or a capture from scripts/tee.mjs
```
