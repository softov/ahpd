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
| `initialize`, `ping` | handshake and version negotiation | ✅ | Answers with a version the client actually offered, in the client's order of preference. `initialSubscriptions` come back as snapshots in the same response. A refusal carries `supportedVersions`, which is what a client reads to pick one to retry with. `automations` is advertised when this host was given a store, because presence is what *permits* a client to use the channel and the three commands |
| `subscribe`, `unsubscribe` | channel subscriptions | ✅ | Per connection, not per channel: one client unsubscribing does not stop another's stream. The snapshot is taken *at* a `serverSeq`, and anything dispatched while it was being taken is replayed on top of it |
| `reconnect` | replay from a `serverSeq` | ✅ | Replays what a dropped client missed, or hands back snapshots when the gap is longer than the buffer |
| `dispatchAction` | client-origin state actions | 🚧 | See [state actions](#state-actions) for which. The echo carries `origin` - the `clientId` and `clientSeq` the dispatch came with - and one this host will not act on comes back carrying `rejectionReason` instead |
| `listSessions`, `createSession`, `disposeSession` | the catalogue and its lifecycle | ✅ | Most-recently-modified first, live sessions included. Every row opens from its transcript - a file read, no CLI - and is **resumed** only when somebody starts a turn on it |
| `createChat`, `disposeChat` | several chats per session | ✅ | Each is its own agent process on one directory and one config. The last one cannot be disposed, and the refusal says so. A session's first chat is named `ahp-chat://default/<base64url(sessionUri)>` - see [chat URIs](#chat-uris) |
| `resolveSessionConfig` | the schema before a session exists | ✅ | The same schema a session reports, so a catalogue row is configurable before it is resumed. A backend advertises its own properties and a client draws what it is given; the Claude backend offers the same five approval modes VS Code's own Claude host does. `autoApprove` and `mode` are conventional keys a client dispatches whatever a host advertises, and are mapped onto that one axis on the way in |
| `sessionConfigCompletions` | — | 🚫 | Every key this host offers is an enum, so there is nothing to look up. VS Code calls it only for a key whose schema asks for it, which none of ours does |
| `fetchTurns` | transcript paging | ✅ | Newest 50 in the snapshot, a cursor for the rest |
| `completions` | `/` against the session's commands | ✅ | Falling back to the harness-wide list |
| `authenticate` | a token for a protected resource | ✅ | See [Authentication](#authentication) |
| `resourceList`, `resourceRead`, `resourceResolve` | reading files | 🧩 | The `resources` port. Only inside the directories the host was told to serve |
| `resourceWrite`, `resourceDelete`, `resourceMkdir`, `resourceMove`, `resourceCopy` | writing files | 🧩 | The same port's optional write half, behind `resourceRequest`. A store without it answers `-32601`, which is not a refusal about a path |
| `resourceRequest` | the write gate | ✅ | Per connection and per resource. An operation that writes is refused `-32009` until granted, and the refusal carries the request that would unlock it |
| `createResourceWatch` | a channel per watch | 🧩 | `resourceWatch/changed` in coalesced batches, globs for `includes` and `excludes`. No dispose command, as the protocol has none: the last `unsubscribe` releases the watcher |
| `createTerminal`, `disposeTerminal` | a shell in a served directory | 🧩 | The `terminals` port |
| `invokeChangesetOperation` | acting on a changeset | 🧩 | The `changes` port advertises the verbs; this host owns their status and the write gate |
| `listAutomationTriggerDefinitions`, `runAutomation`, `fetchAutomationRuns` | automations | 🧩 | The `automations` port. A host given none advertises no `ahp-automations://` channel and answers `-32601` |

## Server notifications

**4 of the 8 declared.**

| AHP | ahpd | Status | Notes |
| --- | --- | :---: | --- |
| `root/sessionAdded`, `root/sessionRemoved`, `root/sessionSummaryChanged` | catalogue lifecycle | ✅ | To the connections watching the root channel and no others. `sessionAdded` carries the whole `summary`; `sessionRemoved` carries `session`; `sessionSummaryChanged` carries `session` and a `changes` partial with the three identity fields left out |
| `otlp/exportLogs` | the host's own log | ✅ | `ahp-otlp://logs/{level}`, advertised at the handshake, carrying an OTLP/JSON `ExportLogsServiceRequest` verbatim - the same lines the daemon writes to stdout. Stateless: never replayed, and a subscriber gets only what happened after it arrived |
| `otlp/exportTraces`, `otlp/exportMetrics` | — | 🚫 | VS Code's own client says `// Not recorded, yet` against both, so there is nothing on the other end |
| `root/progress` | — | ➖ | Host-level work correlated by a `progressToken`. Nothing here is slow enough at the *host* level to report; the slow things are turns, and those have their own channel |
| `auth/required` | — | ➖ | What a host sends when a token it accepted has expired. This host does not verify a token, so it never learns that one has gone stale. Recognising it would mean guessing at the harness's error strings |

## State actions

**64 of the 96 declared, across nine channels.** Grouped by channel; a group is
🚧 when some of it is served.

| channel | ahpd | Status | Notes |
| --- | --- | :---: | --- |
| `root/*` | 4 of 4 | ✅ | `agentsChanged`, `activeSessionsChanged`, `terminalsChanged`, and `configChanged` - the last one client-dispatched: VS Code pushes `defaultShell` at connect, and everything else it pushes is kept and read back |
| `session/*` | 22 of 28 | 🚧 | Everything a catalogue row and a detail pane read. Not emitted: `creationFailed` (`createSession` finishes or throws inside the request, so there is nothing to announce), `customizationRemoved` (the list goes out whole), `serverToolsChanged` (empty for a true reason - `serverTools` are tools the *host* contributes, and this host defines none), and the three `workingDirectory*` (fixed at creation here: a session that moves is a conversation whose second half cannot see the files its first half was about) |
| `chat/*` | 20 of 30 | 🚧 | The turn, its parts, its tools and its questions. Not emitted: `toolCallDelta` (arguments stream as JSON, and a row redrawn per keystroke of a JSON blob says nothing until it is complete), `toolCallAuthRequired` / `AuthResolved` (mid-call MCP authentication, a moment the SDK does not surface), `turnResume`, and the four client-dispatchable ones this host would ignore |
| `terminal/*` | 6 of 11 | 🚧 | `data`, `input`, `resized`, `claimed`, `titleChanged`, `exited`. The five not served are shell integration - `cwdChanged`, `commandExecuted`, `commandFinished`, `commandDetectionAvailable` need a PTY this daemon does not have, and `isPty: false` is the honest form of all four |
| `changeset/*` | 4 of 8 | 🚧 | `contentChanged`, `operationsChanged`, `operationStatusChanged`, `filesReviewChanged`. The four not served - `fileSet`, `fileRemoved`, `cleared`, `statusChanged` - are the *incremental* form of a changeset; this host emits the coarse form, worth replacing with the fine one only once a changeset is big enough that re-sending it is felt |
| `automation/*` | 4 of 4 | ✅ | |
| `automationRun/*` | 3 of 5 | 🚧 | `lifecycleChanged`, `primarySessionChanged`, `cancelRequested`. `sessionSet` / `sessionRemoved` are for a run with more than one session, and a run here has one |
| `resourceWatch/*` | 1 of 1 | ✅ | |
| `annotations/*` | 0 of 5 | ➖ | An editor's furniture: a client marks a range and the marks are shared. Nothing here produces one - but `<sessionUri>/annotations` is *subscribable* and answers `{ annotations: [] }`, because a client opens a session by subscribing to the session, its chat and its annotations together, and a refusal on the third fails the open silently |

### Client-dispatchable actions this host acts on

`chat/turnStarted`, `chat/turnCancelled`, `chat/toolCallConfirmed`,
`chat/inputCompleted`, `chat/pendingMessageSet` / `Removed`,
`chat/queuedMessagesReordered`, `chat/draftChanged`, `session/configChanged`,
`session/isReadChanged`, `session/isArchivedChanged`,
`session/activeClientSet`, `session/customizationToggled`,
`session/mcpServerStartRequested` / `StopRequested`, `terminal/input`,
`terminal/resized`, `automation/createRequested` / `updateRequested`,
`automationRun/cancelRequested`, `root/configChanged`.

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
id inside one is ever read. So `claude:/<uuid>` - which is what VS Code computes
from a session's provider - and `ahp-session:/<uuid>` - which is what this host
lists that same session as - are one session, and both are answered.

Both are also *keyed* as one now. They were not: who owns a session, where it
ran, the bits a client set on it and the settings chosen for it before it starts
were all stored under the catalogue's name, and a lookup under the client's name
found nothing - a row marked read that came back unread, and a browsed session
that could not be continued because no backend owned a name nobody had stored.

And a session answered under an alias has its chat names spelled from that
alias, because a chat URI contains a session URI. Told otherwise, a client
subscribes to the chat it computed, reads a `defaultChat` naming another, and
cannot pair the two: it holds a subscription nothing refers to and a reference
nothing is subscribed to, and draws an empty conversation with no error.

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
