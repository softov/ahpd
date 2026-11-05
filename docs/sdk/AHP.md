# AHP compatibility

Counted against [`@microsoft/agent-host-protocol`](https://microsoft.github.io/agent-host-protocol/)
**1.0.0**, which is what this repository builds against and the newest
published.

The versions negotiated are the package's own `SUPPORTED_PROTOCOL_VERSIONS` -
`1.0.0` and `0.9.0` - and this host answers the highest of them the client
offered, as the specification asks. It also speaks `0.10.0`, the version VS
Code 1.141 offers, which reads the 1.0.0 wire: an offer that holds `0.10.0` and
agrees on nothing above it is answered `0.10.0`, as VS Code's own host does. A
refusal lists `1.0.0`, `0.10.0` and `0.9.0`. VS Code 1.140 offers `0.9.0` and
is answered `0.9.0`, and an editor newer than this daemon connects rather than
refusing.

Everything below was read off the source and the type declarations, not off the
specification: nothing here is listed because AHP defines it.

A thing the protocol declares no field for travels in `_meta`, which every shape
that carries one declares open. The keys this host invents there are named
`ahpd.<name>` - `ahpd.owner`, `ahpd.staged`, `ahpd.commit`,
`ahpd.cost`, `ahpd.model` and the rest - so a reader can tell this host's
extensions from the protocol's. A key the protocol or the reference client
defines keeps its own spelling: `command`, `description`, `argumentHint` and
`uri` on a completion item, `toolKind` on an action, `git`, `github`,
`githubData` and `workingDirectoryKeys` on a session, and the `vscode.` and
`agentHost/` key spaces.

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

**33 of the 33 declared**, one row each. `dispatchAction` is the partial one -
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

One spelling is taken as another: `ahp-automations://catalog` is the
automations catalogue, on the two commands and on `subscribe`, `reconnect`
and `dispatchAction`. The protocol names the channel `ahp-automations://`, and
for two weeks the reference host spelt it with an authority so the URI survived
a round trip through its own URI class; Insiders builds from that window still
subscribe under it, and were refused here with `-32001` about a session nobody
had named. Answered under whichever spelling the client used, the way the root
is: the root and the automations catalogue are this host's own channels.

| command | ahpd | Notes |
| --- | :---: | --- |
| `initialize` | ✅ | Answers with the highest version the client offered that it speaks; a refusal carries `supportedVersions` to retry with, and an entry that is not a `MAJOR.MINOR.PATCH` version is `-32602` naming it. `initialSubscriptions` come back as snapshots in the same response, and a channel is on the watch list only once its snapshot has been taken - one that could not be is not subscribed, and the client is told if it asks. `automations` is advertised only when this host was given a store, because presence is what *permits* a client to use the channel, and it carries `create` and `schedules`, and `customizations` as well when this host was given a directory to copy client plugins into, because a template may then name one; `terminalCommandPrefix` is `"!"` only when it was given a `terminals` port, and a `!command` is then this host's local command whatever the session's backend, never sent to the model as a question - [TERMINALS.md](TERMINALS.md#who-opens-one). |
| `ping` | ✅ | A round trip, and the one method the specification says works before the handshake - a liveness check that needed one first could not tell a half-open socket from a busy one. |
| `subscribe` | ✅ | The snapshot is taken *at* a `serverSeq`, and anything dispatched while it was being taken is replayed on top of it. Subscribing twice to one channel is answered twice, including while the first snapshot is still in flight; the reference host cancels the earlier subscribe and answers it `-32001`, so a client written against that one may never send the second. A chat snapshot carries every turn the host keeps when the subscribe names no `view`, and then no `turnsNextCursor`. A `view.turns` that is a positive integer is answered with the newest that many turns, and with a cursor while older ones are left; any other count gets the newest `PAGE`. |
| `unsubscribe` | ✅ | A notification, so it carries no id and gets no reply. Per connection: one client unsubscribing does not stop another's stream. |
| `reconnect` | ✅ | Replays what a dropped client missed from its `lastSeenServerSeq`, or hands back whole snapshots when the gap is longer than the buffer. Every channel it comes back for is read first and then joined at once, so an action said while a later one is read reaches it once, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1577-L1583) activates a reconnect's subscriptions together. A channel it resumes whose state this host let go of since the client was served it, a session asleep that nobody watched, opens again from its record, and the client is handed the snapshots: the actions since apply to that state and not to the one it holds. The reference keeps the same per-client [baseline debt](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/protocolServerHandler.ts#L690-L701). The buffer holds the last 1000 envelopes, or `replayBytes` of them, whichever comes first, so a handful of large actions shorten it below the count - see [A client that stops reading](#a-client-that-stops-reading). Stateless notifications - the OTLP channels - are never replayed, because they carry no `serverSeq` to have been missed from. A client's new locale rides the request's `_meta` as `ahpd.locale`, a request's extra input; one it does not send keeps the locale it had. A client this host keeps no record of is refused `-32008` `Reconnect client not found: <id>`, and starts again with `initialize`: a record is forgotten once its client has been gone ten of VS Code's 30 s disconnect windows, when another client arrives, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2064-L2076) prunes its client records. |
| `dispatchAction` | 🚧 | A notification. The echo carries `origin` - the `clientId` and `clientSeq` the dispatch came with - and one this host will not act on comes back carrying `rejectionReason` instead. See [state actions](#state-actions) for which. A client's dispatches wait, in the order it sent them and across every connection of that client, only on what this host must have before it can apply one: a session woken or read from the catalogue, one being started again, a message's attachments written, a turn's check. A wait has no time limit, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L12492-L12507) queues a client's dispatches. |
| `listSessions` | ✅ | Most-recently-modified first, live sessions included. Pages when a client sends `limit` and answers the whole catalogue when it does not, because neither client that connects here reads `nextCursor` and a default page size would be a catalogue silently cut down to it. A cursor this host did not issue is `-32602`. |
| `createSession` | ✅ | Takes the URI the client chose, under whatever scheme it chose it. `activeClient` puts the creating client into the session as it is made. Its `clientId` is the one the client introduced itself with, and a request whose entry names any other, or none, is refused with `-32602` before anything is made, as [VS Code's host](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2209-L2213) refuses it. |
| `disposeSession` | ✅ | Closes every chat, the terminals the session claimed, and its worktree - unless somebody's work is still in it, which is the one thing a daemon cannot judge the value of. A dirty tree is kept where it is and the path is logged. The backend is told too, and deletes its own copy of the conversation: Claude its transcript, pi its session file, cofold its store's record, and an ACP server its session when the server advertised `session/delete`. A row this host only listed is deleted the same way, without a teardown, and a backend whose store cannot delete is left to keep the conversation, which the host says once per provider. Nothing here can be undone. |
| `createChat` | ✅ | Each chat is its own agent process on one directory set and one config. A `fork` source continues the conversation from a named turn under a new backend id, carrying the turns through as visible history; a `sideChat` copies nothing and hands the model what that turn said, on its first prompt and nowhere else. |
| `disposeChat` | ✅ | Answers `null`. The session's default chat, and a chat this host does not hold, are answered the same with nothing removed, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1871-L1880) keeps a session's default chat. |
| `moveChat` | ✅ | A 1.0.0 addition that VS Code's agent host refuses with `MethodNotFound`. Moves the chat named by `channel` after an anchor in its own session, or first when `after` is absent; a `session` destination names another session this host is running, and `newSession` is one it makes. Only a chat that advertises `movable` is taken: the default chat, one whose backend cannot be resumed by its own id, and one running a turn are each refused `-32602`, and nothing changes. Every refusal is VS Code's: its words, and its `reason` from VS Code's fixed set in the error's `data`, `notMovable` here. An anchor that names no chat of the session, or the chat itself, is refused `invalidAnchor`. A move between sessions carries the chat and its workers with it, as [VS Code's host moves ownership](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/AGENTS.md#L374): the chat keeps its state, its canvases and its runtime, which goes on under the session it was launched for until the chat's next turn starts it again under the destination, on the backend id it is held under, with the turns it had and in the folders it was working in; a relaunch that fails ends that turn. A worker keeps the URI it was given. The destination has to run the same provider on the same `config.computer` as the source: another provider is refused `differentProvider`, another computer `unsupported`, and a destination this host is not running `destinationNotFound`. An unread chat that counts toward its session's read state carries the unread with it, as VS Code synchronizes the bits after a move: a read destination is marked unread, and an unread source whose other counted chats are read is marked read. Ownership and catalog order are written before anything is published, so a client is never told the chat is in two places or in none: the source is told `session/chatRemoved`, the destination `session/chatAdded` and `session/chatsReordered`, and both catalogue rows move. `newSession` makes a session whose id is the chat's backend id and whose non-movable default chat is the moved one, under the URI it already had. |
| `createTerminal` | 🧩 | The `terminals` port. Opens in a directory this host serves, under the URI the client chose. |
| `disposeTerminal` | 🧩 | Kills the process group rather than the shell, because a detached shell's children outlive it. |
| `createResourceWatch` | 🧩 | A channel per watch, with globs for `includes` and `excludes`. No dispose command, as the protocol has none: the last `unsubscribe` releases the watcher. |
| `fetchTurns` | ✅ | Walks back from the `turnsNextCursor` a snapshot carries, which is there only when a `view` left older turns behind. With no cursor it answers nothing older, because the host keeps no record of which window a connection was given. The page arrives as `chat/turnsLoaded` on the channel rather than in the result, so every client watching the chat gets it. Answered for the chat under the URI it is held by. |
| `completions` | ✅ | `/` against the session's own commands - read from the `children` of its containers, because a prompt or a skill is never a top-level customization - falling back to the harness-wide list when a session has not answered yet. `@`, and every `#` that is not a chat, against the files this host serves, relative to the session's own directory. `#chat:` against the other chats of the session, filtered case blind on the title, newest first and capped at twenty - each item a `chat` attachment naming the chat and pinning `endTurn` to its last completed turn, which is absent for a chat that has not finished one. A `#` still on its way to `#chat:` - `#`, `#ch`, `#chat` - is answered with those chats and then the files both, because VS Code asks every provider at once and its client shows the merged list; only a word that already says `chat:` is answered with chats alone. A chat a tool started is not offered, and neither is the chat the text is being typed in; a session's chat is answered under the name the client knows it by, which for the default chat is the one built from the session channel it created. A skill the CLI loaded and did *not* put behind a slash is the agent's own and stays out of the menu. Every item carries `_meta.command`, without which the reference client drops it - see [a slash command is a message](#a-slash-command-is-a-message) - and a skill carries `_meta.isSkill: true` beside it, which is what keeps one in an automation's text in the reference client's editor. |
| `authenticate` | ✅ | A token for a resource this host advertised, kept per connection and spent only on that connection's sessions, which for an MCP server are the sessions it watches. `ahpd://users` is the one resource whose token this host verifies itself, against its own user directory; every other resource keeps the unverified pass-through a backend or an MCP server needs. A `target` names one MCP server of one session, and the token is that server's alone: no server beside it, no other session and no backend's own resource is given it. A target is refused `-32602` in VS Code's words for a kind other than an MCP server, `Unsupported authentication target kind`, and for one naming no MCP server of a session this host holds, `Authentication target must identify an MCP server in an existing session`. An empty token takes it back, which is the protocol's word for signing out, and with a target takes back only that server's; `expiresIn` says how long it is good for, and past that it is neither spent nor kept. A token the directory does not know answers `-32007`. See [Users](USERS.md). |
| `resolveSessionConfig` | ✅ | The same schema a session reports, so a catalogue row is configurable before it is resumed. Iterative: what has been answered comes back answered, so re-asking does not quietly undo a choice. This host contributes seven worktree properties of its own when it was given a `worktrees` port and the directory is a repository. |
| `sessionConfigCompletions` | ✅ | `branch`, the one key of this host's own with more values than a picker holds. The schema seeds twenty, most recently committed first; this answers what somebody types, matching on substring. A plugin's key is answered by whoever registered it - `@ahpd/computer` lists the machines it made - and `resolveSessionConfig` asks that answerer once with an empty query to seed the property's `enum`, so a client can label the value it holds before opening anything. A key with nobody registered is an enum a client already has, answered with nothing. |
| `invokeChangesetOperation` | 🧩 | The `changes` port advertises the verbs; this host owns their status. A result may carry a `followUp`. An operation that writes needs no grant, exactly as the resource half does not. An identical invocation in flight shares the one run, and another of the same operation waits for the one before it, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostChangesetOperationService.ts#L431-L471) runs its operation lanes. |
| `resourceRead` | 🧩 | The `resources` port, anywhere on the machine. The changeset source is asked first, because the `before` side of an edit is not a file on disk. |
| `resourceList` | 🧩 | The same port and the same fence. |
| `resourceResolve` | 🧩 | What a URI actually is - type, size, times, and an `etag` for a file, which is what makes `resourceWrite`'s `ifMatch` usable. |
| `resourceWrite` | 🧩 | Served to any connection, as the read half is; the store decides the path. The store resolves the *parent*, so what is written is where a listing said it is. `-32011` when `ifMatch` no longer matches. |
| `resourceDelete` | 🧩 | The same gate and the same store. |
| `resourceMkdir` | 🧩 | `mkdir -p` semantics, as the protocol declares. |
| `resourceMove` | 🧩 | Both ends checked. Refused `-32602` across two different clients, because neither peer could carry that out. |
| `resourceCopy` | 🧩 | The same. |
| `resourceRequest` | ✅ | Answered yes for any `file:` URI, as the reference host answers it, and logged. It withholds nothing, because the write half is served without it; a URI this host does not mediate is refused `-32009`. |
| `listAutomationTriggerDefinitions` | 🧩 | *Event* triggers only. A schedule is protocol-defined and never listed; manual is not a trigger at all, and an empty trigger list on a definition is what manual-only means. Answered on `ahp-root://`, which is what it declares. |
| `runAutomation` | 🧩 | The session is created here rather than in the store, because only this file knows what a session is - the store is handed a function and gets a URI back. `enabled` and a disable condition do not gate a press: the protocol has them govern the runs an automation schedules for itself, so a switched-off automation still runs by hand, and `-32001` here means there is no automation at that resource and nothing else. |
| `fetchAutomationRuns` | 🧩 | Answers `{}` and nothing else, which is what the protocol declares for it: the page is not the result. Asking grows the automation's entry by one page of runs, newest first, and every subscriber of `ahp-automations://` reads the longer `runs` and the next `runsNextCursor` off the `automation/set` that follows, so the client that asked and the clients that did not are told the same thing. The cursor is the entry's own `runsNextCursor`, and one this host did not issue is refused `-32602`; one count per automation, so every client sees the same page. |

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
`serverTools`) is how a session's agent reaches one. The rest of what an agent
gets from this host is the reference host's own set - `list_sessions`,
`send_message`, `create_session` and the others in `tools/session.ts`, and the
artifact three in `tools/artifacts.ts` - under the same names and schemas, so a
skill written for VS Code's host runs here.

## Server notifications

**9 of the 9 declared**, one row each. These carry no `serverSeq` and are never
replayed: a client that dropped and came back has missed them, and must not be
handed them again as if it had not.

| notification | ahpd | Notes |
| --- | :---: | --- |
| `action` | ✅ | The envelope every state action rides in: `channel`, `action`, `serverSeq`, and the `origin` of whatever caused it. Counted with the [state actions](#state-actions) rather than here. |
| `root/sessionAdded` | ✅ | Carries the whole `summary`, to the connections watching the root channel and no others. A running session's `summary` carries `chats` and `defaultChat`. |
| `root/sessionRemoved` | ✅ | Carries `session`. |
| `root/sessionSummaryChanged` | ✅ | Carries `session` and a `changes` partial with the three identity fields - `resource`, `provider`, `createdAt` - left out, because the protocol says they MUST be. `activity` is `null` when there is none: a partial is spread over the row a client holds, so a key left off is a field that did not move, and a row that went idle kept saying what its last tool was doing. The type says `string`; the reference host sends `null` and its client reads it as cleared. `chats` carries the session's whole compact chat catalogue and replaces the list a client holds, and `defaultChat` names the chat a client gets when it names none. A row and the state it opens build that list with one function, so they cannot disagree about which chats a session has. A running session's moves are said together once they have been quiet for 100 ms, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L212-L330) flushes a session marked dirty; a session nothing runs is said at once. |
| `root/progress` | ✅ | Only when the request carried a `progressToken`, and only to the client that sent it: the token is that request's and means nothing to anybody else. Three frames against a total of 2 - the tree, the agent, ready - because making a worktree on a large repository is seconds somebody otherwise waits through with nothing on screen. |
| `auth/required` | ✅ | Off the same state change that carries the requirement, to the connections watching that session, under the session's URI, once per resource. And `reason: 'expired'` to the one connection whose token ran out, at the moment it does, naming a session it watches whose server waits for that resource, or the root channel: nothing here verifies a token, but `authenticate` carries `expiresIn`, so when one goes stale is a fact this host holds. |
| `otlp/exportLogs` | ✅ | `ahp-otlp://logs/{level}`, a template a client expands before subscribing - a literal URI would mean every subscriber got every line. Carries an OTLP/JSON `ExportLogsServiceRequest` verbatim, the same lines the daemon writes to stdout. A subscribe to any of the three telemetry channels answers an empty result with no snapshot, the channels being stateless, and the channel joins the client's subscriptions. |
| `otlp/exportTraces` | ✅ | `ahp-otlp://traces`, a literal channel: the protocol defines template variables for `logs` alone, and one of this host's invention would be a channel nobody can expand. A turn is a `SPAN_KIND_SERVER` span and every tool call in it a `SPAN_KIND_CLIENT` child, joined by `traceId` and sent as each ends, each carrying the spec's correlation attributes `ahp.session.id`, `ahp.turn.id` and, on a call, `ahp.tool_call.id` with `gen_ai.tool.name`. A turn that ends in `chat/error` has status `Error` with its message; a cancelled one's status is left unset, as OpenTelemetry sets `Error` only where a convention calls the outcome one. |
| `otlp/exportMetrics` | ✅ | `ahp-otlp://metrics`. OpenTelemetry's GenAI histograms, `gen_ai.invoke_agent.duration` and `gen_ai.invoke_agent.tool_calls` per turn and `gen_ai.execute_tool.duration` per tool call, with the units and bucket boundaries the conventions name, cumulative against the process start, so a collector arriving late reads totals rather than a difference it missed the beginning of. |

## State actions

**102 of the 103 declared, across nine channels**, one row each. The one that is
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
| `root/agentsChanged` | host | ✅ | Sent at the handshake and again when the boot probe answers, so a client that connected before the CLI replied gets the models, commands and customizations rather than an empty list it caches. A session's CLI handshake says the list when it differs whole from the one last said, a model renamed under its id and an answered empty list among the changes, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L575-L606) publishes its agents. |
| `root/activeSessionsChanged` | host | ✅ | A count, not a list: the protocol's "Number of active (non-disposed) sessions on the server" ([state.ts L39](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-root/state.ts#L39)), the sessions a client's list holds from their `root/sessionAdded` to their `root/sessionRemoved`. Every row of the catalogue counts, a session running, one asleep and a transcript a listing found alike, so the number is the rows `listSessions` answers. No VS Code client reads it: its reader is VS Code's host's own lifetime tracker. Moves when a session is made, sleeps, wakes or is disposed, and when a listing finds or loses rows; said only when the number the root's clients hold is another. |
| `root/terminalsChanged` | host | ✅ | The whole `TerminalInfo` list, sent when a terminal opens, closes, or exits on its own, and after every title and every claim, as [VS Code's terminal manager](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L626-L641) broadcasts it; a session's terminals closed with it are said one at a time, as each goes. |
| `root/configChanged` | client | ✅ | The one root action a client originates: VS Code pushes its window's keys at connect. Every declared key it pushes is kept and read back on every root snapshot, whether or not this host acts on it; a key no schema declares is refused by name, and the rest of the push goes through. Each key is one value for the whole host, which the last push from any window sets and every client reads, as [VS Code's host](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/common/agentHostConfigurationSync.ts#L47-L55) keeps one root config for every window: the window's own five among them, `defaultShell`, `workspaceTrust`, `terminalAutoApproveEnabled`, `terminalAutoApproveRules` and `editAutoApprovePatterns`. A push needs `config:change`, and a push of `workspaceTrust` alone `trust:push` ([AUTHENTICATION.md](AUTHENTICATION.md#trusted-folders)). |

The schema a client draws its controls from holds three kinds of key: the ones VS Code's client pushes, this host's own, and the daemon's.
`packages/sdk/src/vscoderootconfig.ts` holds the first, one property per key as VS Code's agent host declares it at `7516b04bc94`, out of `common/agentHostSchema.ts`, `common/agentMerge.ts` and `common/automationConfig.ts`.
Two entries resolve a constant from `src/vs/platform/chat/common/chatSettings.ts` and write the literal it holds, naming the file by URL.
This host acts on `defaultShell`, which a client's terminal opens, on `workspaceTrust`, on `globalAutoApproveEnabled`, on `eligibleForAutoApproval`, on `terminalAutoApproveEnabled`, `terminalAutoApproveRules` and `editAutoApprovePatterns`, and on three of its own: `changeWords`, which says where a commit message and a pull request's words come from, `clientQueueBytes` and `replayBytes`, which bound what the host holds for a client that is not reading ([A client that stops reading](#a-client-that-stops-reading)); nothing else it declares changes what it does.
`eligibleForAutoApproval` is VS Code's map of tool name to boolean, where `false` means the tool asks every time.
It is one value for the whole host, and setting it needs `config:change`.
The host keeps it in memory only, as VS Code's host keeps its root config.
A daemon that restarts therefore holds no rule until a window pushes it again.
A key names one tool exactly, or every tool of a server through `<server>/*`.
A key is the backend's own tool name, matched with its case, so Claude's `Bash` and pi's `bash` are different keys.
A tool this host offers is `ahp/<name>` in every backend.
A matched call asks in every backend and every permission mode, `bypassPermissions` included.
A `dontAsk` session refuses the call instead of asking.
The question offers no "always" option, so an answer applies to that call alone.
cofold puts the question for a matched call and deletes the approval it remembered for that tool first; in `dontAsk` it denies the call instead.
A call to a matched host tool through `/mcp` is refused, because that door has no session to ask in.
An ACP agent decides itself whether to ask about its own tools, so the rule reaches only the MCP tools this host serves it.
A session inside a machine does not read the rule yet, so a matched call runs there with no question; [deferred.md](../../.project/plans/host/101-a-rule-makes-a-tool-call-ask-every-time/deferred.md) says why.
The three terminal keys are the host's one value each, which the last push from any window set, and every session runs under them.
On a host with people, they answer only the turns the session's owner sends, as `workspaceTrust` does.
A shell command runs without a question when the rules allow every sub-command and deny none.
A deny rule makes the call ask rather than refusing it.
A rule is `true` to approve, `false` to deny, `null` for no rule, or `{ approve, matchCommandLine }`.
A key written `/.../flags` is a regular expression where any other is a prefix of a sub-command.
A line the rules cannot read asks as well, which is what `unanalyzable` says.
A write redirect is allowed only inside the session's working folder and when `editAutoApprovePatterns` matches the target; any other redirect asks.
Where no window pushed `terminalAutoApproveRules`, the daemon's `terminalAutoApproveDefaults` applies.
Under `vscode`, the default, that is VS Code's table; under `none` it is no rule at all.
An empty table that a window pushed approves nothing and is not replaced by either.
Only an approved command is said with `confirmed: not-needed`, and `terminalAutoApproveEnabled: false` turns the check off.
The rest are declared so that a client can draw each one. A value pushed for one reads back as a setting, not as an unknown key.
The description on such a key describes VS Code's agent host, not this one. `automationsEnabled` reads as a promise, and automations here run whatever it says.
Three keys VS Code declared before 1.140 are not declared here, because 1.140 dropped them: `artifactToolsCompactPrompts`, `deferredTitleGeneration` and `activeAgentTitleGeneration`.
The artifact tools carry the long wording and no other, and every session runs under the deferred title strategy, with no key to change either.
A client older than 1.140 that still pushes one of the three has that key refused by name, and the rest of its push applied.

### `session/*` — 30 of 30

| action | origin | ahpd | Notes |
| --- | :---: | :---: | --- |
| `session/ready` | host | ✅ | After the backend is running and before the session is announced. A client told about a session it cannot yet subscribe to has been told about something that is not there. |
| `session/creationFailed` | host | ✅ | For a session an automation could not start, where there is no request to fail. One a client asked for fails inside `createSession` instead. |
| `session/chatAdded` | host | ✅ | Carries the whole `ChatSummary`. The reducer reads `action.summary.resource`, and a chat named any other way arrives as a `TypeError` inside it. |
| `session/chatRemoved` | host | ✅ | On `disposeChat` of a chat that is not the session's default. |
| `session/chatUpdated` | host | ✅ | Only when the row actually moved, read off the chat's own state after each of its actions, and carrying only the fields that moved: `title`, `status`, `modifiedAt`, `interactivity`, `origin` or `movable`, and `activity` with a status change, as VS Code's host forwards it. `resource` names the row and is never among them, because the protocol says a sender MUST omit it. A chat says something on every delta, and a summary re-sent per token is a list redrawn per token. |
| `session/defaultChatChanged` | host | ✅ | Relayed from the host of a session in a machine; this host keeps a session's default chat for the session's life. |
| `session/chatsReordered` | host | ✅ | The whole order a session's chats end up in after a move inside that session, and never what a client sends - the host is the one that knows the order. Every chat the session holds is named exactly once, which the canonical reducer checks before it applies anything. Written to the stored chat list as well, so a restart rebuilds the chats where the move left them. |
| `session/titleChanged` | both | ✅ | A client may rename a session, or one chat when it dispatches on the chat's channel, the way the reference host reads it, and the title is taken as it was sent, a blank one included. On a chat's channel the client's action goes out on that channel, then the chat's held title and its row in the session take the title together, with this host's `session/chatUpdated`, and a default chat renames its session after, with this host's `session/titleChanged`; no chat action carries a title, so a client already holding the chat reads the new one in its row and in its next snapshot. On the session's channel the client's action goes out there, and a session that counts one chat or none (every chat but a tool's, a worker's and a hidden one, as its read state counts them) has its default chat's held title and row take the title after it, with this host's `session/chatUpdated`, as the reference host carries a session's rename down; a session with peer chats keeps its default chat's. The protocol's text has no client rename of a chat. This host also names one after its first message, because an untitled row is one nobody can find again, and an agent renames a chat with `rename_chat` the same way. |
| `session/serverToolsChanged` | host | ✅ | Full replacement, which is what the action means: it carries the new set rather than a difference. Sent to every running session when `host.setTools()` is called. |
| `session/activeClientSet` | both | ✅ | A client announcing itself, and this host putting the creating client into the session it just made. The entry is held under the `clientId` it carries, another client's or none, as the protocol's reducer keys it; it is held, echoed and shown as the client sent it, `tools` included or left out, as VS Code's host takes it ([agentSideEffects.ts L2008-L2011](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L2008-L2011)), in a session whose backend ended as in any other; one for a session this host neither runs nor lists is refused "No agent for session: <uri>", as VS Code's restore refuses it. An entry that names no tools, or no client, provides none. A client's leaving takes out the entry under its own id, as VS Code's host removes a leaving client's entry ([protocolServerHandler.ts L1659-L1677](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1659-L1677)), so an entry that names no client stays until a set replaces it. The `customizations` it carries are read as well: each plugin is copied into this host's own directory and reported on the session. A run announces one of these too, as a client called `Automation`, carrying the copies its template named - which is how a plugin a template named reaches a session nobody is connected to. |
| `session/activeClientRemoved` | both | ✅ | Host-managed on the way out: a client that unsubscribes, drops without reconnecting in time, or reconnects without resubscribing is removed by this host rather than left in the list. |
| `session/workingDirectorySet` | client | ✅ | The SDK takes its directories when the CLI starts and offers no way to add one after, so a change starts the backend again *resumed*: the same conversation in a wider place. Refused while a turn is running. A folder the set holds already starts nothing and goes to every client of the session. |
| `session/workingDirectoryRemoved` | client | ✅ | Index 0 is the process root and the protocol says a client MUST NOT remove it, so this host refuses a removal of it. A folder the set does not hold starts nothing and goes to every client of the session. |
| `session/workingDirectoryReplaced` | both | ✅ | `directory` names the entry and `replacement` the folder put in its place, a replacement the set holds already keeping the earlier of its two places, as the protocol's reducer applies it. The only way index 0 may move, which is why this host advertises `primaryReplacement` beside `immutablePrimary`: a new first folder is a move, which this host says from the folder it was to the folder it is, a worktree of it when the session is isolated, before the client's own action comes back. A replacement of a folder the set does not hold starts nothing and goes to every client of the session. |
| `session/inputNeededSet` | host | ✅ | Carries `request`, not a bare entry. Four kinds reach it: a chat elicitation, a tool confirmation, a client-executed tool, and a tool blocked on an MCP sign-in. |
| `session/inputNeededRemoved` | host | ✅ | Carries the `id` alone, which is the upsert key the set half used. |
| `session/customizationsChanged` | host | ✅ | The whole list, seeded from the boot probe so a session is not empty for its first several seconds, then replaced when its own CLI answers. The plugins a session's clients handed it are laid after the backend's own, here and in the snapshot alike. Each customization carries the decision this host keeps for the folder the session works in, and the one for every session. A decision made in one session therefore reaches a session that has decided nothing. A customization kept off there is said to the backend as well, when that backend reports what it found for itself. |
| `session/customizationToggled` | client | ✅ | Carries `enablement` per scope rather than a flat flag. For an MCP server this host turns it into `toggleMcpServer`, or into `reconnectMcpServer` when the server was off because nobody had signed in. An id naming a client plugin is this host's to answer and the backend is never asked: it has never heard of a customization one of this host's clients announced. The action is said to every client of the session as it was sent, with its sender's origin, before anything it switches, and the session's state holds it as the protocol's reducer takes it. A decision about a plugin or a server is this host's to keep, the client's enablement whole as VS Code's host records it ([agentSideEffects.ts L416-L428](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L416-L428)), so a switch that carries no entry for the session leaves the session no decision of its own; a backend with no live switch takes it when it next loads the customization. Each session the decision reaches has its customizations said again with `session/customizationsChanged` where resolving them moved them, and only there, as VS Code republishes them ([agentSideEffects.ts L609-L647](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L609-L647)). What this host applies for a sender who may not change the host for everybody is that session's decision alone. |
| `session/customizationUpdated` | host | ✅ | One row, when a server's enablement moved as well as its state - `mcpServerStateChanged` carries the state alone, so a server that came back on would arrive `ready` with the switch still drawn off. Also how a client plugin's copy settles, `loaded` or `error`, after `session/customizationsChanged` said the whole list with it `loading`, as VS Code's plugin controller says one ([copilotAgent.ts L11243-L11330](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L11243-L11330)). |
| `session/customizationRemoved` | host | ✅ | Sent one at a time for a server taken out of the configuration, rather than re-sending the whole list. The removal is the change. |
| `session/mcpServerStateChanged` | host | ✅ | The protocol's words, not the SDK's: `ready`, `stopped`, `error`, `authRequired`, `starting`. Each kind carries different required fields, and only the last two carry any. |
| `session/mcpServerStartRequested` | both | ✅ | Said with the client's origin, which answers it, and then asked of the backend; followed by `session/mcpServerStateChanged` carrying the state the CLI reports once it has tried, the state the server was in included, as the protocol's guide has a host follow a start; a reconnect that throws is answered the same way. A start the backend does not make leaves a server that is not ready, failed or waiting on a sign-in in `error`, `mcp-server-start-failed` with why, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2026-L2056) does. Also how a server nobody has signed into is signed into, because lifting the disabled flag alone brings it straight back needing one. A server a stop switched off has the CLI's disabled flag lifted before it reconnects. |
| `session/mcpServerStopRequested` | both | ✅ | The CLI's own disabled flag stops the server, and the customization keeps the enablement it had, since a stop manages the process and leaves the enabled intent where it was. Said with the client's origin, which answers it, then asked of the backend, and followed by the state the CLI reports whenever that is other than `stopped`, as after a toggle that throws. A stop the backend does not make is logged. |
| `session/mcpServerBackgroundRequested` | client | ✅ | A server starting with `blocking: true` holds a turn back until it is ready, and this asks for the turn to go on while the server keeps starting. The request goes to every client of the session with its sender's origin, the protocol's reducer clearing a starting server's `blocking`, and is then handed to a backend that takes it. No backend that ships here holds a turn on a starting server: the Claude CLI has no seam for it and reports no `blocking`. The server keeps the state the reducer leaves, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2066-L2072) leaves it. On a session nested in a machine it is carried to the host inside as the client sent it, where whether the server blocks is the inner session's own state, and that host's echo answers the client. |
| `session/isReadChanged` | client | ✅ | This host's own bit, kept per session and never seen by a backend, and moved with its chats' bits as the reference host moves them. The chats it is made of are the session's open chats but a tool's and a hidden one. A session marked read while one of two or more of those chats is unread stays unread, and the client's own action goes out saying so. A session of one such chat takes that chat to its new bit, read or unread, with this host's `chat/isReadChanged` after the session's action. The protocol's text keeps the two apart ("neither action implies the other"), and VS Code's host couples them, which is the behavior this host follows. This host sends it too: a turn's end marks a read session unread, after the turn's chat, unless that chat is a tool's or hidden, so a worker's end, and a `!` command's, leave the session's bit as it is; and a chat's read action moves it, as `chat/isReadChanged` says. |
| `session/isArchivedChanged` | client | ✅ | The same, and the reason a row with no agent running still has a status to report. The bit is the session's alone: each chat keeps its own, as VS Code's host keeps a session's flags apart from its chats' ([agentHostStateManager.ts L3369-L3374](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3369-L3374)). |
| `session/activityChanged` | host | ✅ | What the session is doing in one line, as its backend says it. Absent means idle, which is a field left off rather than an empty string. The session's held state also takes the activity of whichever chat is driving it, in place and with no action, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3280-L3334) folds its chats into a session, so a snapshot and the catalogue row say it. |
| `session/changesetsChanged` | host | ✅ | The catalogue of changesets a client may subscribe to. A template with no variables is the whole scope; the `{turnId}` ones are not served. |
| `session/configChanged` | both | ✅ | A key whose property says `scope: chat` reaches this chat only; anything else reaches every chat in the session, because a voice set on one of them is a session where two conversations answer differently. One answer for the action, given by this host's own checks of it: every key in the client's own keys, said before anything it causes, or one refusal with nothing of it kept, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13576-L13679) checks a config change, says it and then applies it to its agents. Each key then goes to the backend, and one it could not take is logged in its words. A change that moves where the session runs before its first turn is checked against the policies first and said, and the backend, which reads such a key only when it starts, is started again at the session's next turn boundary as that turn's preparation, as [VS Code relaunches a runtime there](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L1095-L1101); a start that fails ends that turn as a send that failed, and a machine the start made from a source the client named is said after it as this host's. Sent on a chat's channel, it is answered on that channel. `sensitiveEditLocations` is this host's: every session's schema declares it as VS Code's host does, this host takes it without asking the backend and says it back on every snapshot, and a command whose redirect writes into one of its locations asks ([sessionPermissions.ts L774-L815](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/sessionPermissions.ts#L774-L815)). Every backend is handed it all the same, at its start and as it moves, with its answer deciding nothing, as VS Code's host hands its agents every key but its own ([agentService.ts L520-L528](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L520-L528)), so a nested session's host inside judges its commands by the same locations. The locations are read whole, as VS Code's host reads a key ([agentConfigurationService.ts L544-L566](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentConfigurationService.ts#L544-L566)): a value with an entry missing its string `path` or boolean `isDirectory` is no locations. |
| `session/metaChanged` | host | ✅ | Replaces `_meta` whole, which is why the git facts are rebuilt rather than patched: a host with two sources of `_meta` would have each take the other's away. |

### `chat/*` — 35 of 35

| action | origin | ahpd | Notes |
| --- | :---: | :---: | --- |
| `chat/turnStarted` | both | ✅ | A client starts a turn; this host also starts one when a queued message is taken up, and then carries `queuedMessageId` so the client can retire its own row. A turn a client sends while another turn runs is taken: its start is said at once and takes the running turn's place in every client's state, as the protocol's reducer replaces the active turn, and the backend runs it once the work in front of it is done, as VS Code's host hands a client's start to its agent at once and its agents run each in turn. The turn it replaced runs on, its actions name it, and it is in no history; a stop of the turn that took its place stops that work and drops the turns waiting behind it. A `!` command's turn is this host's local command whatever the backend, run at once, with another turn running or none, and before the checks that admit a question, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/localCommand/localCommandContribution.ts#L14-L41) runs its local commands ahead of its admission; a host on its way out ends it unrun, as it ends any turn then - [TERMINALS.md](TERMINALS.md#who-opens-one). The start a client is answered with is its own action exactly as it sent it, said by this host once its own checks of it have passed, and then admitted, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTurnStarter.ts#L95-L136) admits one: a turn on an archived session or chat, a worker's read-only chat, an agent that has ended, a policy that refuses it or a host on its way out ends in `chat/error` on it. Its preparation, the chats it attaches read out, a machine set where this host's branch is and a session being started again, runs before its prompt goes out: a preparation or a send that fails ends it in `chat/error` too, and a turn stopped meanwhile is never handed to the backend, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2180-L2346) prepares and sends one. A start the backend says of a turn the chat holds is not said again. A start on a session nested in a machine is admitted here, its session's bits, its policy and its machine, and then carried to the host inside as the client sent it, whose echo answers the client, as a [VS Code relay](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/relayTransport.ts#L123-L137) forwards each frame as sent; the client's later actions on it reach that host behind it, and so do its stop, its pending messages, its draft and its answers. Steering that came too late to steer a turn starts the same way, carrying the steering message's id, as AHP 1.1.0 shows a steering message taken in by a turn of its own - [CHATS.md](CHATS.md#turns). A cofold session still reading the conversation it resumes, forks or rewinds holds the turns it is handed until it has read it, and one that then finds a turn running, the one that opened before it or a paused run the resume reopened, takes its place the same way. Who sent a turn is this host's own record, held while the turn runs for what it runs and charges, and no action carries it, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L77-L83) keeps a pending message's sender. |
| `chat/delta` | host | ✅ | Appends to a `markdown` part. The part is opened first, always - a delta naming a part nobody opened is text the client has nowhere to put. |
| `chat/responsePart` | host | ✅ | Opens a part. Also how a complete block arrives when it did not stream. |
| `chat/toolCallStart` | host | ✅ | As soon as the model names the tool, before its arguments exist. Carries a `ToolCallMcpContributor` for anything named `mcp__<server>__<tool>`, and `_meta.toolKind` - `terminal`, `read`, `search`, `subagent` - from the harness's own tool names: not protocol, but the one key the reference client routes a row's renderer by, and without it every call is a name in a box. A tool with no kind here carries no `_meta` rather than a guess. The same hint is on the call in a snapshot and on one read back from a transcript. A `Task` or `Agent` call also carries the reference's `subagentDescription` and `subagentAgentName` from its input, and `subagentChatUri`, the worker chat's URI, which the host stamps on a start, delta and ready whose kind is `subagent`, as VS Code's host stamps them; a later action goes out as the backend made it, and a snapshot carries the stamp on a call whose last `_meta` came on one of those three. |
| `chat/toolCallDelta` | host | ✅ | Appends the arguments' JSON to `partialInput` as it arrives, so a row is drawn while the call is still being written rather than after. |
| `chat/toolCallReady` | host | ✅ | Closes a streaming call with the parsed input. `confirmed: not-needed` unless `canUseTool` actually asked - without it the reducer draws every call in the transcript as a question nobody put. A Claude `Write`, `Edit` or `MultiEdit` waiting for approval also carries `edits`: one `FileEdit` whose `before` is the file as it is and whose `after` content the host serves under `ahp-edit://pending/...` until the call is settled, so the diff is drawn before the person decides. No `diff` counts, because the SDK sends no unified diff to count, and none of it holds the confirmation back. |
| `chat/toolCallConfirmed` | both | ✅ | A client answering; and this host saying what was answered, for the other clients watching. |
| `chat/toolCallComplete` | both | ✅ | The result as one object. A tool that failed is `completed` with `result.success: false` - `ToolCallStatus` has no `failed`. From a client too, for a tool that client provides: that is what unblocks the agent. Only the client a call names as its contributor may send one, wherever the chat holds the call, a call a stop ended included; one for a call the chat does not hold is said all the same, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13654-L13679) says every completion. The client's own result is said to every client of the chat with that client's origin, and then goes on to the harness, a result whose client asked to have it confirmed once a client approves it; what the harness says of the call afterwards reduces to nothing. A Claude `Bash` result too large to send carries a `terminal` block after its text, which is the notice Claude gave the model: the terminal this host rebuilds, exited, from the output Claude saved, `isPty: false`, with Claude's preview and `truncated: true`, as the reference's Claude agent does. The call read back from Claude's transcript carries it again while the output is kept - [TERMINALS.md](TERMINALS.md#a-terminal-a-tool-result-names). |
| `chat/toolCallResultConfirmed` | client | ✅ | Said as the client sent it, and the call is then where the reducer leaves it: a client's call completed with `requiresResultConfirmation` goes on to the harness once a client approves its result, the result its client gave, and a denied one goes as a failure, "The user denied the tool result.", as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1631-L1671) forwards a client's result. |
| `chat/toolCallContentChanged` | both | ✅ | Streaming into a call, which is the *contributor's* to do. What a tool prints is its client's to say: it goes to every client of the chat with that client's origin, and the chat's held state folds it into the call, so a client that subscribes afterwards is served it. Refused from anyone but the client named in the call's `ToolCallClientContributor`, wherever the chat holds the call, and for a call no client contributes - a call of the agent's own has no contributor to be. One for a call the chat does not hold is said, as VS Code's host says it. From this host too, for a running subagent: the harness's `task_progress` line goes out as `_meta.progressMessage` - the reference client's key for a line on a running row - never into `content`, which is what the tool answered and not what it was doing on the way. The same line twice is said once, and the completion takes it off again. And for a `!` command, the terminal it runs in, as soon as the terminal opens and with no `_meta`, so a client watches the output arrive, as the reference host names its own: the terminal is what the call shows, and the completion names it again - [TERMINALS.md](TERMINALS.md#who-opens-one). |
| `chat/toolCallAuthRequired` | host | ✅ | The SDK surfaces no per-call auth moment, so the join is made here: a server that starts asking blocks whatever was running against it. Only when the resource was discovered - the action carries a whole `McpAuthRequirement`, and a client told to sign in with nowhere to do it is worse than one told the server errored. |
| `chat/toolCallAuthResolved` | host | ✅ | When the server is ready again, paired with the `session/inputNeededRemoved` that lifts the session-level block. |
| `chat/turnComplete` | host | ✅ | Carries a required `duration`. A turn that ended badly ends with `chat/error` instead; both are endings, and which one says how it went. |
| `chat/turnCancelled` | both | ✅ | Also carries a required `duration` - a missing number here is `NaN`, which throws inside the reducer rather than drawing anything. A stop of no running turn stops nothing and goes to every client of the chat as the client's own action, which the reducer leaves as nothing, as VS Code's host takes it ("Ignoring cancellation of an inactive turn"): a stop on a chat that runs no turn, a stop that names a turn other than the running one or names none, a worker's chat included, and a stop on a session asleep in the catalogue, which runs none and stays asleep. The protocol's validation table has a server refuse a stop with no active turn. A stop of a turn still being prepared, its policy checked, its machine set or its session started again, ends it in every client's state, and the turn is never handed to the backend, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2241-L2310) checks for a cancel before each step of a send. A stop of the running turn is said to every client when it is taken, so the turn ends in their state at once, and the backend is then told; a completion the backend says of that turn afterwards is not said, and another end it says is said and reduces to nothing, as the reference host ends the turn, aborts the agent, and drops only a stopped turn's completion of what its agent says ([agentSideEffects.ts L900-L918](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L900-L918)). An action a client sends on the chat before the backend has let the stopped turn go is applied at once to the idle chat its clients hold, as VS Code's host hands a client's turn to its agent while an abort may still be under way: a turn is said at once and runs once the stopped work is done. A message queued then is taken up at once the same way, as VS Code's host takes up a message set on an idle chat. A stop takes every pending steering message out with this host's own `chat/pendingMessageRemoved`, said right behind the stop and before the backend is told, and starts nothing behind it, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1921-L1955) clears every pending steering entry at a cancel and then aborts its agent. |
| `chat/error` | host | ✅ | The ending, not a message beside one: it carries the `turnId` and the duration the completion would have. |
| `chat/turnResume` | client | ✅ | [VS Code's host's](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13490-L13516) conditions are checked against the chat's held state in its order and refused in its words: a turn running ("Cannot resume while a turn is active."), an archived session or a read-only chat ("Cannot resume a read-only or archived chat."), a turn that is not the latest, errored with a resumable error ("The requested turn is not the latest resumable errored turn."), and a backend that cannot run a turn again ("The session provider does not support turn resume."). The resume is then said with its sender's origin and the backend runs the turn again; a backend that holds no such turn to run ends the turn again in a `chat/error` that can be resumed, with the time the turn ran, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1850-L1860) ends a resume its agent rejects. A client's stop of a resumed turn is said with the time the turn ran across both its runs, as VS Code's host measures it. pi continues from the model call that failed, so the tools the turn already ran are not run again, and it marks a failed model call `resumable` on the turn's error part, also on the last turn read back from its file. Claude cuts the conversation back to the end of the turn before, with `resumeSessionAt`, and sends the prompt again; a conversation whose first turn failed is deleted and started over under its id. The calls the failed turn ran are run again, because the cut drops them with the prompt. It marks a failed model call `resumable` only when there is a turn to cut back to, so a turn refused before the CLI, a CLI that is gone and a refused login carry none. Cofold cuts its store through the last message of the turn before, with `sessions.truncate`, and runs the prompt again under the turn's own message id; a conversation whose first turn failed has its session deleted, and `run()` makes it again on the same workspace. The calls the failed turn ran are run again. It marks a failed run `resumable` unless the run never started (`start_failed`) and when the turn before has a point this process watched run, or there is no turn before. A pi file or an ACP replay that ends while its last turn's request still ran reads that turn back in error, with VS Code's `executionInterrupted` part, "The agent was interrupted before this request finished.", as VS Code's reader ends a turn whose request is still active, whether a call is still open or every tool returned and nothing came after. pi marks it `resumable`, and a resume asks the model again from where the file ends, an answer cut off while it asked for tools first taken out of its context; ahpd resumes no ACP turn, so ACP's carries no `resumable`. A Claude transcript reads such a turn as VS Code's Claude reader does: cancelled with a call open, and complete otherwise. |
| `chat/activityChanged` | host | ✅ | What this chat is doing, in the tool's own words while one runs. Sent with no `activity` to clear it. |
| `chat/isReadChanged` | client | ✅ | Marks one chat read or unread, and moves its session's read bit after it as the reference host does: a chat of the session's read state, which every open chat is but a tool's and a hidden one, marked unread marks a read session unread, and the last of them read marks an unread session read, with this host's own `session/isReadChanged`. A chat that was read already and has a sibling moves nothing of the session's, and a sibling chat's bit is its own. The bit is kept per chat, so a chat comes back read when a client opens it again, and it survives a restart. It is projected into the chat's `ChatSummary.status` and into its `SessionChatSummary.status`, which is what the protocol asks a host to synchronize. Setting what is already set moves nothing and goes to every client of the chat. This host clears a chat's bit as a turn starts, where a client's reducer clears it from the start itself, and says nothing there, as the reference host says nothing; and it says a chat unread at every turn's end, whatever its bit, as the reference host's markUnread does, a worker's chat included. A `!` command's turn end says nothing of read state, so its chat stays as its start left it. The lead chat of a session nested in a machine is run by the host inside, which is the one producer of its state, as a VS Code relay sends a client's messages to the host running the session: a client's read goes to that host, which answers the client, and the bit it says, at a client's read or a turn's end, is the chat's here. |
| `chat/isArchivedChanged` | client | ✅ | Archives one chat, or restores it. The bit is kept per chat and goes out to every client of the chat, the sender's copy carrying its origin, and it is projected into the chat's `ChatSummary.status` and its `SessionChatSummary.status`, as the read bit is. On the session's default chat it is refused, "Only a known independently manageable non-default chat can be archived.", as VS Code's host refuses it ([agentService.ts L13453-L13464](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13453-L13464)), whether the session runs or not and with nothing woken; a session is archived by its own `session/isArchivedChanged`. The protocol's text makes archiving the default chat "equivalent to archiving the session", and VS Code's window sends that archive on the chat's channel, so a VS Code client sees the refusal VS Code's host gives. A chat archived on its own is marked read too, since nobody comes back to a chat filed away for what is new in it, and that read moves its session as any chat's read does. Setting what is already set moves nothing and goes to every client of the chat. The lead chat of a session nested in a machine is its session's default chat, so an archive of it is refused here and reaches nothing inside. |
| `chat/workingDirectorySet` | client | ✅ | Refused, "Unsupported action: chat/workingDirectorySet", whatever it names, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L139-L142) refuses it. A chat takes its own folders when it is made, with `createChat`'s `workingDirectories`. |
| `chat/workingDirectoryRemoved` | client | ✅ | Refused, "Unsupported action: chat/workingDirectoryRemoved", as `chat/workingDirectorySet` is. |
| `chat/usage` | host | ✅ | Tokens and the model that spent them, at the end of the turn. What the protocol names no field for rides `_meta` where a backend reports it: `ahpd.cacheWriteTokens`, `ahpd.reasoningTokens`, `ahpd.context` (`{ used, size }`) and `ahpd.cost` (`{ amount, currency }`, never the reference host's bare number). |
| `chat/reasoning` | host | ✅ | Appends to a `reasoning` part. Defined against that kind specifically - the canonical reducer returns the state unchanged for a `chat/delta` naming one, which draws a thinking header with nothing under it. |
| `chat/pendingMessageSet` | both | ✅ | Both kinds: a `queued` message waits for the running turn, a `steering` one goes into it - the prompt handed to the CLI is a generator that stays open for the life of the session. The pending messages are this host's, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L29-L326) holds them: a client's is said as it sent it, which answers it, and held in the chat's state. This host starts the head as a turn of its own, named by its `queuedMessageId`, when a turn completes or a `!` command's turn ends, steering first; a stopped or failed turn leaves the queue waiting until a client queues, takes back or reorders a message while nothing runs, and nothing starts behind a failure a client can resume, nor while the backend holds steering it was handed - [CHATS.md](CHATS.md#turns). Steering goes to the backend while a turn runs, at the turn's start and on each of the turn's actions until the backend takes it, and one the backend hands back unsent steers the turn that runs then, or runs next. Steering sent with no turn running runs as a turn of its own, as VS Code's host runs steering that came too late to steer a turn; the protocol's text has a host store it until a turn starts. A steering message Claude's CLI answers after the turn's last answer is answered in that turn, which stays open for it, and reads back there after a restart - [CHATS.md](CHATS.md#turns). A backend that takes no steering refuses it, a turn running or not, in VS Code's host's words: "The session provider does not support steering messages." The steering message a running turn holds, sent again under its id, is answered and not handed to the agent twice when it is the same message, and refused with "Cannot change a steering message while it is being processed." when it is another, as AHP 1.1.0 has a host reject an edit it can no longer honor. |
| `chat/pendingMessageRemoved` | both | ✅ | When a client takes one back, and when this host takes the chat's steering out at a stop. A client's removal is said as it sent it, one of a message the chat no longer holds included, which the reducer leaves as it was. A steering message the backend was handed is withdrawn from it; while a turn runs, a backend that cannot withdraw one keeps it, and the removal is refused with "Cannot change a steering message while it is being processed.", the reference host's words, as AHP 1.1.0 has a host reject a removal it can no longer honor - [CHATS.md](CHATS.md#turns). A client's removal while nothing runs starts the head of the queue, as VS Code's host drains it. |
| `chat/queuedMessagesReordered` | both | ✅ | Said as the client sent it: the queue is this host's. Anything the order did not name keeps its place behind what did, rather than being dropped for not having been mentioned. A client's reorder while nothing runs starts the head of the queue, as VS Code's host drains it. |
| `chat/draftChanged` | both | ✅ | A `Message`, not a string. Held by the session so two people on one chat see each other's, which is the only reason a draft is on the wire at all. Taken for a session nothing is running for too - kept by this host until one starts and handed over when it does, because typing into a row from the catalogue is what somebody does *before* there is any reason to start an agent, and refusing it is a composer that empties itself as it is typed into. The draft the chat already holds goes to every client of the chat and is not handed to the backend again. |
| `chat/inputRequested` | host | ✅ | From the CLI's own elicitation. Mirrored to `session/inputNeeded` so a client watching the catalogue sees the session is blocked. |
| `chat/inputAnswerChanged` | client | ✅ | One question of an open request, as somebody types the answer. Held on the request this host already keeps open and echoed to everyone watching the chat, for the reason `chat/draftChanged` is: two people answering one elicitation are answering one form. Kept on the request rather than beside it, so a client that arrives mid-question reads what is already filled in from `session.inputNeeded` - and so `chat/inputCompleted` carrying no answers of its own is completed with what was synced, which the protocol says is where they are. Taken on a worker's chat too, and for a backend that keeps no drafts, whose clients then hold the draft the host says. A draft or submitted answer with no value, or whose value lacks the payload its kind names, is refused, as the protocol's validation table asks; a value of a kind the protocol does not list is taken, the kinds being `@nonexhaustive`. An acceptance is refused where a required question has no submitted answer, synced or carried: a draft and a skip are not one. |
| `chat/inputCompleted` | both | ✅ | Accept, decline or cancel. Declining is an answer, and the CLI is told it rather than left waiting. |
| `chat/truncated` | client | ✅ | Drops the turns after a named one - the edit-and-resend flow, and nothing to do with the harness compacting its own context. Served as a rewind, because dropping them from the screen alone would leave the agent answering the message that was edited away: the CLI is started again resumed at the kept turn's *last* chain entry, the turns up to there are handed over as the seed, and the session id is kept so a later resume reaches the truncated conversation rather than the one this dropped. The truncation is said first, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1968-L1990) says one before its provider cuts anything, one at a turn the chat does not hold included, which the reducer leaves as nothing and cuts nothing, and a backend that cannot cut keeps its history, as VS Code's provider with no truncation does: a turn whose backend names no rewind point for it, one read back by a backend that names points only for the turns it watches run, drops from every client and stays in the backend; the Claude backend names the end of each turn it reads back. The action's `turnId` is optional, meaning "clear everything", which as a rewind is a cut before the first prompt and names no entry at all; that form starts the chat over instead, as VS Code's agent host does: the backend stops, its conversation is deleted through the backend's `delete`, and a new one starts for the same chat with nothing to resume. A backend with no `delete` keeps the conversation, and a delete that fails is logged and the chat comes back on the conversation it had. Compaction *is* handled and is a different thing: the harness announces it as `compact_boundary`, and this host turns it into a `systemNotification` response part saying how many tokens went where - the turns it compacted are all still in the transcript, so dropping them would be untrue. |
| `chat/turnsLoaded` | host | ✅ | The answer to `fetchTurns`, sent on the channel rather than in the result, so every client watching the chat gets the page and not only the one that asked. A page of older turns reads the same as the tail window that came before it. |
| `chat/backgroundWorkSet` | host | ✅ | Upserts one entry by its `id`, which is `shell:<task_id>` or `subagent:<task_id>` off the harness's own task id. Only the Claude backend has anything to report: its `background_tasks_changed` is the whole live set and its `task_started` says what each one is, so one task is said once and again only when what it is changes. A `shell` carries the command of the `Bash` call that started it; a `subagent` carries the worker chat's URI, which is the same chat the spawning call links. A chat running nothing has no `backgroundWork` key rather than an empty one. A backend that says the action itself has it said as it came, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L901-L912) says what its agent reports. |
| `chat/backgroundWorkRemoved` | host | ✅ | One entry that stopped running, by the same `id`, and a no-op for an id this chat was never told about. A task the harness is no longer running leaves the level, and a terminal notification ends one whatever the level says; `ambient` tasks are never listed at all. |
| `chat/movableChanged` | host | ✅ | Whether this chat may be the source of a move, which is the host's own answer and not the client's. Sent when that answer changed, and the owning session's row follows as `session/chatUpdated` so `ChatSummary.movable` keeps up. Never `true` for the chat its session hands out, because `default` is a role and not a chat. A chat running a turn is not movable, and neither is one whose backend cannot be asked for the conversation again. |
| `chat/canvasesChanged` | host | ✅ | The whole list a chat shows, or no `canvases` when it holds none. Only a plugin's canvas calls send it - [PLUGINS.md](../plugins/PLUGINS.md#showing-a-canvas-on-a-chat) - and only to a connection at `0.10.0` or later. |

### `canvas/*` — 1 of 1

| action | origin | ahpd | Notes |
| --- | :---: | :---: | --- |
| `canvas/stateChanged` | host | ✅ | The canvas's whole `CanvasState`, replaced rather than patched, on the canvas's own `ahp-canvas:/<base64url(chat)>/<uuid>` channel. A new canvas is sent before the chat that lists it, so a client told about a resource can subscribe to a channel that already answers. In memory only: a URL is not reused after a restart. |

The two canvas actions are registered at `0.10.0`, and this host sends them to
a connection that agreed on `0.10.0` or later and to no older one. That holds
for the live broadcast and for a replay alike, because both go through the one
filter `seenBy` applies - [versioning](https://github.com/microsoft/agent-host-protocol/blob/main/docs/specification/versioning.md).
The chat's list is in `ChatState.canvases` on every version, so a client at
`0.9.0` reading the snapshot sees the key and no change about it.

A canvas is opened, updated and closed by a plugin, through its own three calls
- [PLUGINS.md](../plugins/PLUGINS.md#showing-a-canvas-on-a-chat) - and
`canvasesEnabled`, a root key off by default, is what turns them on
([HOST.md](HOST.md#root-config)). A client cannot open or close one.

### `terminal/*` — 11 of 11 🧩

| action | origin | ahpd | Notes |
| --- | :---: | :---: | --- |
| `terminal/data` | host | ✅ | Every byte the shell wrote except its OSC 133 and OSC 7 marks, which the protocol keeps out of the output, and the same bytes are kept as scrollback so a client subscribing late sees what happened. Capped, because a terminal left running `tail -f` is a host holding a day of output for a client that may never come back. |
| `terminal/input` | client | ✅ | Under pipes a `^C` is turned into a signal to the process group, the work a line discipline does under a pseudoterminal, where the byte is written through. Side-effect only and still a terminal action, so it goes to every client of the terminal and is held for replay, as [Every accepted action](#every-accepted-action-goes-to-every-client-of-its-channel) says. Input to a shell that has exited, or to a command's output terminal, goes out too and reaches no process, as [VS Code's host](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L520-L527) writes input only to a running process. |
| `terminal/resized` | both | ✅ | A pseudoterminal is told and sends `SIGWINCH` itself. Without one, a command's output terminal included, the size is kept because the state reports it and a client draws to it. A client's size, and each of the three below, is taken by the terminal and said as the client sent it, as [VS Code's terminal manager](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L223-L246) applies a client's terminal action its host said. |
| `terminal/claimed` | both | ✅ | Who the terminal belongs to: a client, or a session that opened it for a `!` command. A claim that names neither is refused. |
| `terminal/titleChanged` | both | ✅ | Set by a client, or defaulted to the shell's own name. The title it already has moves nothing and goes to every client of the terminal. |
| `terminal/cwdChanged` | host | ✅ | Read out of the shell's own OSC 7, so it is a fact rather than a guess. Under a pseudoterminal only. |
| `terminal/exited` | host | ✅ | Announced when the pipes drain rather than when the process goes: between the two there is output written and not yet read, which is exactly what a terminal opened for one command reads back. A terminal a tool call names is still a channel once nothing live answers for it: a subscribe gets the exited state rebuilt from the output this host kept, and nothing after it - [TERMINALS.md](TERMINALS.md#a-terminal-a-tool-result-names). |
| `terminal/cleared` | both | ✅ | Drops the scrollback and keeps the size, the title and the claim - a client clears a terminal to stop reading what is there, not to give it up. Nothing reaches the process, which has no notion of its own output being discarded. |
| `terminal/commandDetectionAvailable` | host | ✅ | Said once, with the shell's first OSC 133 mark: a shell under a pseudoterminal may print none, and then it is never said. A client MUST check this before relying on command boundaries. |
| `terminal/commandExecuted` | host | ✅ | From the shell's OSC 133 `C` mark, said where the mark stood, with the command line read back off what was typed since the prompt. |
| `terminal/commandFinished` | host | ✅ | From the `D` mark, said after the output printed before it, so that output is the command's; with the shell's own exit code and the duration since `C`. |

### `changeset/*` — 8 of 8 🧩

| action | origin | ahpd | Notes |
| --- | :---: | :---: | --- |
| `changeset/statusChanged` | host | ✅ | When only the status moved and the files did not. `recomputing` goes out before a changeset is read again, so a client keeps the files it has. `ready` follows when the read comes back, and a read that gives nothing puts the previous status back. A read that fails keeps the earlier result and says its status again, and says `error` with `computeFailed` and the cause only where there is no earlier result, as VS Code's host ends a computation with no new result. |
| `changeset/fileSet` | host | ✅ | Chosen when fewer actions than files moved. |
| `changeset/fileRemoved` | host | ✅ | The same choice, for a file that left the set. |
| `changeset/filesReviewChanged` | client | ✅ | A client marking files reviewed. The one changeset action a client originates. Applied as the protocol's reducer applies it, to the files the changeset holds; a changeset that keeps no review, the working tree's among them, is refused. A turn that changes a file again takes the tick off its row in the session's changeset, the branch's and the turn's own. |
| `changeset/contentChanged` | host | ✅ | Chosen when the whole set is the smaller thing to send. It reduces to the same state as the per-file pair, which is what makes choosing between them safe. |
| `changeset/operationsChanged` | host | ✅ | The verbs the source advertises, with this host's own answer to whether each may be pressed now. Asked again whenever the session's running state flips, a turn that ended in `chat/error` included, and said only where the list differs from the one the channel holds, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostChangesetOperationService.ts#L367-L375) dispatches it. |
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
| `automation/createRequested` | client | ✅ | A request: what follows it is `automation/set` saying what this host actually holds, and then the request itself, the client's answer, which reduces to nothing. `disableConditions` is checked before the store is asked: a kind named twice, a condition that is neither of the two kinds, an `afterRuns` whose `max` is not a whole number of one or more, and an `afterDate` that is not a timestamp are each refused with the reason. A template whose `session.customizations` is a non-empty list is copied while the client that named it is still connected, when this host has a directory to copy client plugins into, and the copies go on the entry; a host with none refuses it rather than keeping a definition whose every run loads nothing. A list is refused before the store is asked when a plugin in it names no id, names an id another in the same list names, or names no URI. A create at a resource this host already keeps says the one kept again, by `automation/set` and the request after it, when its definition is the one sent, and is refused `Automation already exists: <uri>` when it differs. |
| `automation/updateRequested` | client | ✅ | A patch. Absent keys are left alone, so one client does not revert another. A patch that names `disableConditions` is held to the same rules a create is, and one that names none is a patch about something else. A patch that names `session.customizations` is held to the same rules a create is: the copies it names are made and a list it cannot honour refuses the patch whole, an empty list says the template has no plugins and drops the copies it had, and a patch that says nothing about them leaves them where they are. A patch of an automation this host does not keep is refused `Automation not found: <uri>`. |
| `automation/set` | host | ✅ | What this host holds after either request, each request answered by itself after it, and how a store with a clock announces one that fired on its own. |
| `automation/removed` | both | ✅ | Refused `Automation operation 'remove' is not available: <uri>` when the catalogue says `remove` is not among the operations. A removal of an automation the store does not hold is the protocol's idempotent no-op, and comes back to every client of the catalogue as it was sent. |

### `automationRun/*` — 5 of 5 🧩

| action | origin | ahpd | Notes |
| --- | :---: | :---: | --- |
| `automationRun/lifecycleChanged` | host | ✅ | `pending`, `running`, `completed`, `failed`, `cancelled`, and when each happened. A run that failed says so rather than vanishing. |
| `automationRun/sessionSet` | host | ✅ | One action per session that joined. Neither this nor its pair carries a whole set, so what goes out is the difference since the last time this looked. |
| `automationRun/sessionRemoved` | host | ✅ | And one per session that went - a disposed session is unlinked from the run it belonged to, so a client is not left pointing at a channel nobody can open. |
| `automationRun/primarySessionChanged` | host | ✅ | The one a client opens when it opens the run. Cleared when that session is the one removed. |
| `automationRun/cancelRequested` | client | ✅ | Stops the turns the run's sessions are running, and the run settles as their backends end them; a run with no session yet settles `cancelled` at once. Taken, it is answered to the client that sent it alone, since it changes no state of its own, and the run's `automationRun/lifecycleChanged`, said to everyone, is what came of it. Refused in VS Code's words: `Automation run not found: <uri>` for a run the store does not hold, `Automation run is already terminal: <uri>` for one already over, and `Automation run cancellation was not accepted: <uri>` for one none of whose sessions is running a turn. |

Whose work an automation is reaches a client as `_meta['ahpd.owner']`, on the
entry in the catalogue snapshot and on every `automation/set`, and on the run's
own state the same way - `user:<id>` or `root:<host>`, as a turn's sender is
spelled. Never as a field of its own: the protocol declares `_meta` on both
shapes and no `owner`, so an owner under that name is one no client can read. A
run's is the automation's, not whoever pressed Run. Absent on a host given no
users directory, which has nobody to name.

`disableConditions` is honoured rather than echoed. An `afterRuns` counts the
scheduled runs admitted since the allowance began - cancelled and failed ones
included, manual ones never - and the entry carries that number as `runCount`,
absent while the definition names no `afterRuns`. An `afterDate` is compared
against the clock. Meeting either sets `enabled: false` on the definition this
host holds and announces it as an `automation/set`, so a client reads the switch
rather than being told separately, and nothing is removed: a switched-off
automation still offers `run` and still runs by hand. A fresh allowance is an
`afterRuns` added where there was none, or a switched-off automation switched
back on, and it resets the count to `0`; clearing the conditions re-enables
nothing.

### What a refusal is

Anything dispatched that this host will not act on is **refused**: an envelope
carrying `rejectionReason` names the action and says what would not have it. A
client applies an action before sending it, and the refusal is what tells it to
put its own state back. The one action dropped is a session's read or archive
toggle naming a session this host does not know, which no client holds pending:
see [an action naming nothing here](#an-action-naming-nothing-here).

A refusal is an action envelope like any other. It takes the next `serverSeq`,
is held for replay, and goes to every client subscribed to the channel the
action was sent on, as the
[specification](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/subscriptions.md#L140-L143)
sends an action and as the reference host records and broadcasts a rejection.
The client that sent it is told even where it watches no such channel. No state
takes a refusal: the client that sent the action drops it from what it holds
pending, and the others hold nothing of it.

A refusal reaches only who the accepted action would reach. A request on
`ahp-automations://?owner=me` goes to its sender and its owner, as its echo
does. A refusal to a client the users gate has not passed takes the same road
and is held for replay, as the reference host records and broadcasts its
rejection of a sender it has not authenticated.

An action the protocol does not let a client send, a type it does not know
included, is refused "Server-only action: <type>" before anything reads it, and
`chat/workingDirectorySet` and `chat/workingDirectoryRemoved` are refused
"Unsupported action: <type>", in
[VS Code's host's](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2811-L2815)
words.

## Behaviour worth knowing

What these things are, rather than how they behave on the wire: a session is [SESSIONS.md](SESSIONS.md), a chat is [CHATS.md](CHATS.md), a terminal is [TERMINALS.md](TERMINALS.md), a tool is [TOOLS.md](TOOLS.md), a resource is [RESOURCES.md](RESOURCES.md), what it cost is [USAGE.md](USAGE.md), and an automation is [AUTOMATIONS.md](AUTOMATIONS.md).

### Restarts

| | |
| --- | --- |
| read and archived survive one, if the host was given a store that keeps them | `IsRead` and `IsArchived` are this host's rather than a backend's and are shared by every client, so where they go is a `SessionStore`. `memorySessions()` is the default and forgets them; `fileSessions()` writes them down. `@ahpd/server` chooses with `--sessions file\|memory` and defaults to the file |
| so do the settings chosen for a session | the configuration values in force are kept the same way, in the same store, and come back with it |
| the sessions themselves come back either way | they are read from the backend's own transcripts, so what a store decides is only whether what this host added on top of them comes back too |

### A client that stops reading

A client that reads slower than the host writes leaves every frame it has not
taken in its socket's queue, and nothing in the protocol bounds that queue: a
socket sends while it is open, and what it holds until the client reads it is
the socket's own business. `clientQueueBytes` bounds it, 16 MiB by default.
Before each send the peer reads what its wire still holds - `bufferedAmount` on
Node's `ws` and on Deno's `WebSocket`, `getBufferedAmount` on Bun, the write
buffer's length on stdio - and a client past the limit is named in the log and
closed rather than written to. The frame that would have crossed the limit is
dropped with the close, and so is every answer still in flight to it.

A client closed this way is not a client lost: it reconnects with its
`lastSeenServerSeq` as any client does, and is answered from the replay buffer
or with snapshots. A wire that cannot say what it holds - the in-process pair -
is never closed for being behind.

The replay buffer is bounded twice: the last 1000 envelopes, or `replayBytes`
of them, 32 MiB by default, whichever comes first. An envelope weighs the
length of the text it goes out as, measured once when the host buffers it, and
the oldest are dropped while either limit is passed. The newest is kept
whatever it weighs on its own, because one action larger than the whole budget
is still the state this host holds.

Both keys are this host's own in the root config schema, and both are read
where they are used rather than held, so a value pushed while the host runs
applies to the next send and to the next action buffered. Either may be pushed
down to 1 MiB and no further, and pushing one needs `config:write`
([AUTHENTICATION.md](AUTHENTICATION.md#trusted-folders)).

### Turns

| | |
| --- | --- |
| a turn is said back | `chat/turnStarted` arrives from a client and this host emits it again. Nothing in a client applies what it sent itself, so a host that reduced it privately goes on to emit response parts for a turn no client has |
| the running turn is `activeTurn` | and is not in `turns`. It moves across when it completes |
| who sent a turn is the host's | as a typed reference, `user:<id>` for somebody who signed in and `root:<host>` for a turn the deployment's own token started, held while the turn runs for what the host runs and charges: the usage record names it, a plugin's `turn_start` and `turn_end` carry it, and no action or state a client reads does, as VS Code's host keeps a pending message's sender ([queueDrainContribution.ts L77-L83](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L77-L83)). `origin` on a chat state names a kind of sender: `startedBy` gives a chat `{ kind: 'user' }`, which says a person opened it |
| a part exists before it streams | `chat/responsePart` creates it, `chat/delta` appends to it |
| the append action follows the part | `chat/delta` is defined against a *markdown* part and `chat/reasoning` against a *reasoning* one, and the canonical reducer returns the part unchanged when they do not match. Thinking sent as a `chat/delta` opens a part and never fills it |
| one action ends a turn | `chat/turnComplete` when it worked, `chat/error` when it did not - and `chat/error` *is* the ending, carrying `turnId`, a required `duration` and the error part it appends. Both `chat/turnComplete` and `chat/turnCancelled` carry a required `duration` too: a client clamps it with `Math.max(0, duration)`, so an absent one is `NaN` rather than a missing number and throws inside the reducer |
| `serverSeq` moves with every envelope | a refusal included. A snapshot is taken at a sequence number and every action after it carries a greater one, which is how a client knows it missed nothing |

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
both provide `openFile` and the model is offered one list. The call a client
runs names the tool as the client announced it, `openFile`, with the server's
prefix and the client's id taken off, as [VS Code's Claude](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L637-L638)
takes the prefix off, so the client that owns it finds the tool to run.

**Joining the call to the handler is this host's problem.** They arrive
separately and neither carries the other's name: the assistant frame opens the
call under the harness's id, and the in-process handler is invoked with the
input and nothing else - the SDK surfaces a `toolUseID` to `canUseTool` and to
hooks, and *not* to a tool. So the two are matched by tool name and then by the
input itself, which is what tells two concurrent calls of one tool apart.

**The completion answers the client.** A client's `chat/toolCallComplete` is what
unblocks the agent. Its result is said to every client of the chat with the
origin of the client that gave it, so the row is drawn finished once, and then
goes back to the harness, which writes the tool result; what the harness says
of the call afterwards is said and reduces to nothing.

**A client that leaves fails its calls.** Outstanding calls are answered as
failed rather than left open: the agent is waiting on a promise nothing can
settle any more, and a turn that hangs for ever is worse than a tool that says
it could not run.

### Being asked

`session/inputNeeded` is a **list**, and `session/inputNeededSet` carries
`request` and adds *or updates* the entry with that id; `inputNeededRemoved`
carries the `id`. Four kinds are served, one per `SessionInputRequestKind`:

| kind | what it is | answered by |
| --- | --- | --- |
| `toolConfirmation` | a tool call waiting to be allowed, raised where a backend stops a call to ask a person (`canUseTool`) | `chat/toolCallConfirmed`, keyed by `toolCall.toolCallId` |
| `chatInput` | a question the agent asked, raised where a backend puts an elicitation to a person | `chat/inputCompleted`, keyed by `request.id`, with `response: 'accept' \| 'decline' \| 'cancel'` |
| `toolClientExecution` | a running call to a tool an active client provides, raised by the client call holder as the frame reports it | `chat/toolCallComplete`, keyed by `toolCall.toolCallId`, from the client the call was reported against |
| `toolAuthentication` | a call blocked mid-run on an MCP server's sign-in. The host raises it from the call's own state once a `chat/toolCallAuthRequired` leaves the call waiting, under VS Code's id `toolAuthentication:<chat>:<turn>:<call>`, with the turn and the call, as VS Code's input-needed contribution raises it | the `authenticate` command, not a `chat/*` action: the call goes on with `chat/toolCallAuthResolved` and the host lifts the entry with `session/inputNeededRemoved` |

All four are held in a map keyed by id, never in one slot: the CLI calls
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

### The platform keys the window pushes

`sandboxEnabled` and `shellInitScripts` are the reference host's platform
config keys. The Claude backend here declares `shellInitScripts` under the same
name so the window's control works against it. It does not declare
`sandboxEnabled`: the sandbox is a field of a Claude preset (`sandbox`:
`default`, `on` or `off`), set by whoever configured the backend, so the window
draws no sandbox control for a Claude session. A session stored while that
control existed still holds an `on`, and an `on` sets the sandbox as a preset's
`sandbox: "on"` does, so an upgrade never runs a session less sandboxed than it
was. A preset that says `off` is somebody asking for no sandbox, and it wins
over that stored value. A sandbox asked for on a machine
that cannot make one is the CLI's refusal to report, not a command run outside
one. `shellInitScripts` is the list of
`{ shell, script }` the window generates for the folder's shell profile and
selected Python environment, `readOnly` so it is sent and not drawn. The
SDK's shell tool has no setting for one, so a `PreToolUse` hook on `Bash`
puts a `source` of the bash entry in front of every command: the script is
written to a file of its own for the session's life and rewritten on each
change, its stderr is dropped and a nonzero status is printed, the way the
reference runtime treats it. A PowerShell entry is kept and not sourced, since
the CLI's shell tool is bash everywhere; an empty list clears the file. What is
put in front is the host's: the owner's rules read the command the model wrote,
a confirmation shows it, and the command runs with the prefix, as
[VS Code's Claude](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeCanUseTool.ts#L174)
asks about the command the model wrote.

### Chat URIs

A session's first chat is `ahp-chat://default/<base64url(sessionUri)>`, the
shape VS Code's host builds and an older VS Code window computes from the
session. `defaultChat`, every entry in `chats` and `ChatState.resource` name the
chat by that one URI, so a client that computed it and a client that read it
hold the same string.

That URI is the session's chat while the session records no other default
chat, or records that one, as VS Code's host gives a derived default chat an
owner only while the session's record agrees
([agentHostChatOwnershipService.ts#L226-L242](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L226-L242)).

`default` is a **role**: it means whichever chat a client gets when it names
none. Dispose that chat and the role moves to another chat of the session, under
that chat's own URI, and the disposed chat's URI names nothing. A second chat is
named by whoever created it, and `ahp-chat:/<id>` is a chat of that URI and of
no session `<id>`. A chat moved to another session keeps its URI
([chat-channel.md#L203-L204](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L203-L204)).

### Session URIs

The protocol names a session `ahp-session:/<uuid>`, and keeps its provider on
`SessionSummary.provider`. This host names every session it makes
`ahp-session:/<uuid>`, as VS Code's host does since commit `bd64649be19`, with
the one exception below.

A session is held under one URI, and answered under that URI alone, for every
client, as VS Code's host keys a session by the URI a client sends
([agentService.ts#L11472-L11490](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L11472-L11490)):

- A session a client creates is held under the channel it named:
  `ahp-session:/<uuid>`, `<provider>:/<uuid>`, or a scheme of the client's own
  ([protocolServerHandler.ts#L2213-L2221](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2213-L2221)).
- A session that already exists keeps the `<provider>:/<uuid>` name it has. The
  host stores each session's URI in its row, so a name survives a restart, and a
  row a client marks or configures keeps the name it was listed by.
- A session listed from a backend's disk that this host keeps no record of is
  `ahp-session:/<id>`, whether a listing or a lookup by id found it.
- A session an agent's tool makes during a turn an older VS Code window sent is
  `<provider>:/<uuid>`, so that window can address it
  ([agentService.ts#L10074-L10108](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L10074-L10108)).

The id inside a session's URI is what the store holds the session under, and
every spelling of that id names the session: the name its row carries, another
scheme this host serves, and `ahp-session:/<id>`. A client that names one of
the others is answered under the name it used, which the host keeps as an alias
for the connection, as VS Code's host answers a session under each identity it
has and derives that session's chat from each of them
([agentHostChatOwnershipService.ts#L264-L287](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L264-L287)),
a chat's owner coming from the records that hold it rather than from its URI
([sessionState.ts#L894-L898](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/state/sessionState.ts#L894-L898)).
A derived default chat URI of any of those spellings is the session's default
chat, while the session's record agrees that its default chat is a derived one;
a session that moved its default to a chat of its own owns no derived chat
([agentHostChatOwnershipService.ts#L226-L242](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L226-L242)).

A URI whose id no session here carries is no session: a subscribe to it answers
`-32001`, as VS Code's host answers a URI no agent of its own serves
([agentService.ts#L14091-L14096](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L14091-L14096)).
A read or archive flag or a mark dispatched on it is dropped with nothing said,
as the protocol has a server ignore an action naming a session that does not
exist
([session-channel.md#L166](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/session-channel.md#L166)),
and a config change, a draft or a turn there is refused as one for a session
nobody has is.

A session a client creates is stored under the id the client chose, by naming
it to the backend, so the backend writes its transcript under that id and the
session's URI opens it after a restart. Only where the client named a UUID,
which is what the backend will take.

### An older VS Code window

A VS Code window names itself `vscode-editor-window` or `vscode-agents-window`
in `clientInfo`. One that does not declare `vscode.ahpSessionUris` in the
`_meta` of `initialize` cannot address an `ahp-session:` session, and one that
does not declare `vscode.ahpChatUris` cannot address an opaque chat. This host
reads both at `initialize`, and at `reconnect` from the name given at
`initialize` and the reconnect's own `_meta`, as VS Code's host does
([protocolServerHandler.ts#L1054-L1055](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1054-L1055),
[#L1350-L1351](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1350-L1351)).
Such a window is shown what it can address
([protocolServerHandler.ts#L4326-L4355](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4326-L4355)):

- A window without `vscode.ahpSessionUris` is listed no `ahp-session:` session,
  told nothing of one in the root, and refused one as a subscription with
  `-32001`. One in its first subscriptions is left out, and at `reconnect` it is
  reported missing.
- A window without `vscode.ahpChatUris` sees only the shaped chats that name
  their session, in a snapshot's `chats` and in the chat list actions, and no
  session whose default chat is another.
- Neither receives an envelope on a channel it may not see, and a move of a chat
  to a session it may not see is refused as a session not found.

Every other client sees every session and every chat.

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

### Every accepted action goes to every client of its channel

A client's action this host accepts is sequenced, applied to the channel's
state and sent to every client subscribed to the channel, the sender's copy
included, with the sender's `origin`. That is the protocol's order for a
dispatch: "**Host sequences it** - assigns a `serverSeq`, applies it to the
authoritative state, broadcasts the action envelope to all subscribed clients"
([AHP and ACP](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/ahp-and-acp.md#how-they-compose)),
and "Session actions go to all clients subscribed to that session's URI", the
same for root, chat and terminal actions
([subscriptions](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/subscriptions.md)).

An action the reducer leaves as it was is one of them. A bit set to what it
already is, a folder the set holds already, the draft the chat holds, a review
of files already ticked, a cancel naming a turn other than the running one, a
background request for a server that is not holding a turn back, the title a
terminal has, and an active client set as the session holds it, each go out
as the client sent them, at the next `serverSeq`, and move nothing. Nothing is
started again for them and no backend is told. So does `terminal/input`, a
side-effect-only action that is still a terminal action, and
`automationRun/cancelRequested`, whose run's lifecycle follows it.

Every client of a terminal is sent the input any client types into it, and a
client that reconnects within the replay buffer is sent it again, as the
[reference host](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4215-L4253)
records and broadcasts it. That includes a password typed at a prompt that
does not echo it. Every client reads what the input did in the `terminal/data`
that follows.

A client that announces itself whenever the session's state moves reads such
an echo as the state moving. One that compares what it would send with the
entry the state holds and with what it sent last, as
[VS Code's session handler](https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L1237-L1253)
does, sends its set once.

A refusal goes to every client of its channel and is held for replay, except
where [What a refusal is](#what-a-refusal-is) says otherwise. It takes the next `serverSeq`,
because a client that has just subscribed holds a snapshot taken at the number
this host was at, and "Subsequent actions will have `serverSeq > fromSeq`"
([state](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/common/state.ts#L357)).

### The snapshot and the actions have to agree

A client driven by actions builds its own state; a client that subscribes reads
the snapshot. Both are this host's answer to the same question, and a field
carried by one and not the other is a client that renders differently depending
on when it arrived. So the host holds the state of the root, of each session and
of each chat as the protocol's reducer makes it of every action it sends on that
channel, from a seed it reads once when the channel opens, and a snapshot is that
state. A backend's own `chatState()` and `sessionState()` are read for the seed
alone, so whatever a backend changes after it is said as an action or not at all.
A session's `status` is its reducer's too, which moves its read, archived and
input-needed bits; what its chats are doing is on their rows and on the
catalogue's row.

### Sessions and the catalogue

| | |
| --- | --- |
| past sessions | every catalogue row opens from its transcript - a file read, no CLI - and is resumed only when somebody starts a turn on it |
| capabilities | models, skills, slash commands, subagents and MCP servers are read from the CLI's *control* protocol at startup, so they are known before any turn. A composer that waited for the first session could only offer them once the conversation had started |
| skills | told apart from built-in prompts, and a skill the CLI keeps for the agent is not offered after a slash. A skill's or a prompt's argument hint is `_meta['ahpd.argumentHint']`, because neither `SkillCustomization` nor `PromptCustomization` declares one, and reaches the slash menu as the completion item's `argumentHint` |
| toggling a skill or prompt | refused out loud: the CLI has no runtime switch, and the list goes back out so the control returns to where it was |
| toggling a plugin | through the CLI's `enabledPlugins`, then read back. A session switch stays where the client put it, which the host keeps by id, because `reloadPlugins` answers only the plugins the CLI is loading and a switched-off one is not among them |
| toggling an MCP server | through the CLI, then read back. Switching on one that is not ready reconnects it, which is how signing in happens |
| who else is here | `activeClients` on the session, `session/activeClientSet` from a client and `activeClientRemoved` from the host - taken out on unsubscribe, on a dropped connection, and on a reconnect that does not ask for the session back, and kept while another window of the same client still is |
| read and archived | kept per session and told to every client, including for rows no agent is running for |
| the model it is on | `_meta['ahpd.model']` on a Claude session's state: `SessionState` declares no model, and `UsageInfo.model` says only what a past turn ran on |
| a chat's backend | `_meta['ahpd.provider']` on the state of a chat whose backend is not the session's: a chat a plugin opened on another harness names it there, because `ChatState` declares no provider and the session's `provider` stays the session's own. A chat served by the session's own backend carries no key, since the session already says it, and a foreign chat's `_meta` keeps whatever the backend put there itself |
| whose a session is | `_meta['ahpd.owner']` on the row and on the session state, in the same typed references a turn's sender is - `user:<id>` or `root:<host>`. It belongs to the session store rather than to the transcript, so it is still there after a daemon comes back. Absent on a host given no users directory, which has nobody to name, and on a session begun before this was kept |
| project and branch | `project` on every row from the path alone, and `_meta.git` beside it when the host was given `gitBranches()` - `branchName`, `upstreamBranchName`, the ahead and behind counts, `uncommittedChanges`, and `baseBranchName` for a worktree |
| pull request | Published twice when the host was given `githubPullRequests()`: under `_meta.githubData[key]`, with the key named by `_meta.workingDirectoryKeys[workingDirectory]`, and beside it under `_meta.github`. The key is the working directory's own `file://` URI, which is what the row's `project.uri` already spells it, and publishing it is what makes it authoritative - a window that has no key for a working directory derives one, and one that does takes the host's. The state itself is `owner` and `repo` from the remote, and for the branch's newest pull request its `pullRequestUrls`, `pullRequestBranchName`, `pullRequestState` (`open`, `closed`, `merged`) and `pullRequestStateUrl` - the reference host's `ISessionGitHubState` keys, which is what draws the state beside the branch. `_meta.github` is still there for a client that reads that one, and is the same object. `_meta.git` is unchanged and is not per folder: a session here has one folder, and the window still reads `_meta.git` for it. Asked with the token a client lent for `https://api.github.com/repos`, advertised on every backend for that purpose, or with `gh` when nobody lent one; asked again when a turn ends |
| what the agent recorded | `_meta['agentHost/sessionArtifacts']` on the session and its row: the artifacts and references the agent recorded with the reference host's `add_artifact_or_reference`, `remove_artifact_or_reference` and `list_artifacts_and_references`, offered under those names with its schemas and answers, and kept by the session store across a restart. The window draws them as pills beside the input, and takes one off with its own request, `vscode/removeSessionArtifact`, which `initialize` says it may make under `_meta['vscode.removeSessionArtifact']`. The reference host's instruction for when to record one goes into the agent's system prompt, since the CLI's prompt takes an `append` |
| when it began | `createdAt` is an identity field and does not move: a resumed session takes the value its own backend's catalogue gives, and a session started here takes the moment it was started. `modifiedAt` is the one that changes |

### An action naming nothing here

A session this host knows is one it is running, one the catalogue lists, or one
its store records as started here. A chat it knows is one a running session
holds, one the store records a session for, or one whose URI names a session it
knows. A target none of these knows is looked for in the catalogue before it is
called unknown. An action on an unknown target is answered as
[VS Code's host](https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentService.ts#L12482-L12531)
answers it:

| Target | Action | Answer |
| --- | --- | --- |
| a session | `session/isReadChanged`, `session/isArchivedChanged` | dropped: nothing is kept for the session, and nothing is said to the sender or to anybody |
| a session | any other | refused |
| a chat, named in `ahp-chat:` | `chat/isReadChanged` | refused "Only a known chat can change its read state." |
| a chat | `chat/isArchivedChanged` | refused "Only a known independently manageable non-default chat can be archived." |
| a chat | any other | said back on the channel the client named, with its origin, to the clients that watch that channel; nothing is kept, reduced or run for it |

The protocol's text has a server ignore every action naming a session or a chat
that does not exist, with no echo
([session channel](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/session-channel.md#L166),
[chat channel](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L351)).
VS Code's host refuses and accepts as the table says, and its client rolls a
refused action back and keeps an accepted one. A session's toggle is the one it
ignores, and a client keeps nothing pending for a session it watches no channel
of.

### Changesets

All four scopes: `session`, `turn/{turnId}`, `compare/{a}/{b}` and
`uncommitted`, at `<sessionUri>/changeset/<scope>`. A changeset is a *scope*
nested under the session URI, so disposal is a prefix scan.

Both sides of every edit: `after` is the file, `before` is `git show HEAD:`
behind a URI this host resolves itself, because what a file used to be is not a
file on disk.

Operations are server-advertised per scope, `disabled` while a turn is running,
and destructive ones carry the `confirmation` a client MUST show. `commit` takes
one file, or on the whole changeset the index when it holds anything and the whole
working tree when it holds nothing, `discard` puts a file or the whole changeset back to HEAD, `revert` puts a file
back to the state the agent found it in, and `stage` and `unstage` move a file, a
folder or the whole changeset in or out of the index. A call with no `target` is
the whole changeset: every change under the session's folder, untracked files
included. `discard` on the whole changeset removes untracked files too, and its
`confirmation` says it cannot be undone. In a repository with no commit it is
refused, because there every file is new and it would delete all of them.

`commit` carries a `confirmation` naming the subject line it will use and what the
whole changeset would take: the staged files when the index holds any, and every
file with the untracked ones counted when it holds none. One sentence serves both
targets, so it reads "Commit as 'X'? The whole changeset takes 3 staged files."
`commit` on one file commits that file as the working tree has it, staged or not,
untracked or deleted, and leaves everything else the index holds staged. On a
renamed row it commits both paths, so git records one rename. The operation is re-declared when the
changeset or the session title moves, so the sentence stays true, and the
invocation decides again from the index at the moment it runs.

A row of an `uncommitted` changeset carries `_meta['ahpd.staged']` and
`_meta['ahpd.unstaged']`, read from `git status --porcelain`'s two letters, so a
client can tell what the index already holds from what the working tree does. A
file can be both (`MM`): a change staged and then changed again. A staged rename
or copy is one row, under its new name. A rename's `before` is the path it came
from, read from HEAD at that path, and its `after` is the new path, so a client
sees two URIs and shows a rename. A copy's source is still there, so a copy keeps
the new path on both sides. The protocol declares no staging field;
the pair lives in `_meta`, which is the bag it leaves for a server's own
vocabulary.

A person stages and unstages from the session. `stage` and `unstage` take a file
or a folder, and the session's own folder or no target means everything under it. VS Code
draws both buttons on every row, a folder is staged from a client that sends one
such as ahpapp, and `git add` in a terminal or VS Code's Source Control work
too. A target above the session's folder is refused, for every resource-scoped
operation and not only these two.

`commit` also takes an optional `_meta['ahpd.commit']`. `message` is the sentence
the commit goes in with, replacing the session title this host would otherwise
use. The protocol has no field for it, so it travels in the bag the reference
client already uses for an operation's arguments.

When nobody gives the words - no `_meta['ahpd.commit']`, no
`_meta['vscode.pullRequest']` - they are written the way `changeWords` on the
root channel says. The key has a `mode` and four values. `session-title` is the
default and is what this host did before the key existed: the session's title
for a commit subject and a pull request title, and the branch's commits for a
pull request body. `forced` requires the person's own words, so a commit with no
message is refused by name and the pull request form is left to fill in. `model`
asks a backend the key names, and `agent` asks the session's own agent in a side
chat of its newest turn. Both of the last two are asked what the reference host
asks: the branch, the base, the changed files, the diff and what the session has
said, answered as a title of at most 72 characters, a blank line, and a markdown
body. An answer that failed or said nothing falls back to `session-title`, and
the operation's message says it fell back and why. A model or an agent that has
not answered in two minutes has its turn cancelled, and falls back the same way,
so a commit is not left waiting on one. `changeWordsTimeoutMs` sets the limit,
and zero there is no limit at all. `model` names a `provider` and a `model`; a
provider this host does not serve, or a model one of them does not list, is
refused at the push. The model's question runs in a session of its own,
opened for that turn and disposed of after it, with no tools offered - a model
naming the work has no business reading or writing the tree it is naming. The
agent's question runs in a side chat, which stays in the session afterwards.

The uncommitted changeset follows the tree between turns. It is re-read when git's
`index` or `HEAD` moves, when a tool call completes, when a client writes a file
through the host, and when a terminal in the session's directory exits. No
trigger costs anything while no client watches a changeset in that directory, the
re-reads are coalesced per directory, and only a move is sent.

The reference host's three are offered under its ids and driven by its request
`_meta`, so its window's buttons work here. `prepare-pull-request` answers a
title, a body and the branches as a `data:application/json` follow-up, which is
what fills that window's form; `create-pr` commits what is uncommitted - on a
branch of its own when the tree is on the base branch - pushes, and opens the
request with what the form said under `_meta['vscode.pullRequest']`, or answers
the open one the branch already has. Both are offered only where the host was
given `githubPullRequests()`, the remote is GitHub's, and the branch has no
request yet. `checkout` is offered on a session nobody has spoken in, takes
`_meta.treeish` and `_meta.preCheckoutAction` (`stash` or `commit`), and
refuses a dirty tree with `-32602` carrying `reason: dirtyWorkingTree`, which
is what the window reads to offer the two.

### Worktrees the window manages

A session made with `isolation: worktree` gets a tree of its own, and the
reference window has five requests of its own for such trees, made when
`initialize` says `_meta['vscode.detachedWorktrees']`. They are served here
over the same trees, so the window's "new session in a worktree" flow runs
against this host unchanged. `vscode/createAgentHostDetachedWorktree` answers a
`handle` and the `resource` of the session's tree, and refuses `-32602` for a
session that has none; `vscode/claimAgentHostDetachedWorktree` marks the handle
as the session's, and refuses one this host never handed out.
`vscode/setAgentHostDetachedWorktreeArchived` takes a clean tree off the disk
once its session is gone, keeping the branch, and puts it back on that branch
when unarchived; a tree with somebody's work in it, or a session still running
in it, stays. `vscode/deleteAgentHostDetachedWorktree` removes tree and branch,
and refuses `-32004` while the session runs.
`vscode/reconcileAgentHostDetachedWorktrees` takes the `scope` and the
`activeHandles` the window still holds, marks those as seen, and lets go of a
clean tree nobody named for a day - the window forgetting a handle is not the
same as a person being done with the branch. The handles live for the daemon's
run: a restart forgets them, and the trees stand until a session or the window
takes them down. A tree is made at `<repo>.worktrees/<name>`, beside its
repository, which is where the reference host puts one - or as
`<dir>/<repo>/<name>` under `--worktrees-root <dir>` when the daemon was
started with one, which is how a machine with many repositories keeps their
trees in one folder instead of one folder beside each. A tree made under a root
is not where the reference host would look for one, so a tree either of them
makes is found by the other only at the default.

A new tree carries what git checked out and nothing else: a checkout has no
`.env`, no `node_modules`, and none of the local configuration the thing needs
to run, so the isolation would work and the session inside it could not build -
a failure the person meets after choosing it rather than while choosing it.
`worktreeIncludeFiles` is what is brought along after the checkout: a list of
patterns, in `.gitignore` syntax, for the git-ignored files to copy in. A
comma-separated string is read as one list. The copy is best effort, one pattern at a time - a pattern that
matches nothing is the ordinary case, and a session that refused to start over
a missing optional file would be worse than one without it.
`worktreeSymlinkFolders` is the same idea for folders, and reaches them by
linking rather than copying: a list of `.gitignore` patterns for the git-ignored
folders to point at the checkout's, which is what makes `node_modules` - the
one a build cannot do without - available at once rather than minutes and
gigabytes later. A link is one directory reached from two places, so a write
into it from inside the worktree is a write into the checkout, which is what
naming the patterns is agreeing to and why only git-ignored folders are
eligible. The links are made before the copy, as the reference makes them, and
the pass is best effort as a whole: a pattern that cannot be linked leaves the
tree without it rather than stopping a session. Both are read when the worktree
is made and neither moves once the session has started.

### What the window asks a host about itself

The rest of the reference window's own requests, served in the shapes it
reads. `vscode/getAgentHostSessionStateFile` answers the backend's own record
of a session - the Claude transcript under `~/.claude/projects`, found under
the CLI's spelling of the directory or any project it moved from - or of one
chat, since a chat here is its own backend session, checked against the
session its record says owns it; `initialize` says so under
`_meta['vscode.getAgentHostSessionStateFile.chat']`, and a backend that
writes no file answers no `resource`. `vscode/collectAgentHostDebugLogs`
packs the session's record as `events.jsonl` and the host's log files under
`agenthost/`, the collector's own names, as a zip written here with what
Node ships or as a directory left where it is; either goes after ten
minutes. Under a `progressToken` it says `root/progress` as it goes and once
when it settles, marked `_meta['vscode.debugLogs']`, refuses a token already
in use, and is called off by `vscode/cancelAgentHostDebugLogs` from the
window that follows it or when that window goes; `initialize` says so under
`_meta['vscode.debugLogsCancellation']`. `vscode/readAgentHostDebugLogsChunk`
reads an archive back a megabyte at a time, and only an archive this host
made. `vscode/removeSessionArtifact` takes a session's URI, a chat's refused,
and restores the session first, refusing one it cannot restore with -32001.
`vscode/stopBackgroundWork` takes `{ chat, id }` and calls the stop the
backend that reported the task gave - the row says it may be stopped under
`_meta['vscode.stopBackgroundWork']`, and the answer is `{ stopped }`.
An unknown chat, an unknown id and a task with nothing to stop are the same
`false`, because a client shows the same thing after each, and a stop that
throws fails the request, as VS Code's host lets its runtime's rejection
through; an empty id or a `chat` that is not an AHP chat URI is `-32602`. The row is
left where it is, and the backend's own `remove` takes it down when the work
has ended. The request needs `chat:cancel`.
`getNetworkDiagnosticsInfo` reports the version the daemon gave, the platform,
the first account a backend is signed in as, the proxy variables that are set
and the endpoints the backends name, each once - the Anthropic API, answering
401 unauthenticated, and the GitHub API where the host was given
`githubPullRequests()` - and `diagnosticsFetch` looks one up over IPv4 and
IPv6 and fetches it, timed, with the body kept to 64 KiB and the proxy it went
through, a URL that does not parse failing the request.
`getManagedSettingsDiagnostics` is an empty list: the policy layer it reports
on is Copilot's. `shutdown` closes the host, every backend stopped and every
store closed, and answers `{}` once that is done, the process and the
connection left running, as [VS Code's host](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L16018-L16051)
shuts its providers down and answers after.

### What is served outside the protocol

Everything above this section is AHP 1.0.0, in the shapes the reference host
serves. What follows is not, and is served anyway: the reference window's own
requests and one of its values, in the shapes it reads, kept so that the window
runs against this host unchanged. A client that speaks only the protocol never
sends one of them and never misses one. Each is named once, with why it stays
and where it is described. A request in neither the package nor this table is
refused `-32601`.

| What | Why it stays |
| --- | --- |
| `activity: null` | A row that went idle has to say so. The partial is spread over the row a client holds, so a key left off would keep the last tool call showing, and the reference host sends `null` where its client reads cleared. [Server notifications](#server-notifications) |
| `shutdown` | The window shuts the host's backends down. [What the window asks a host about itself](#what-the-window-asks-a-host-about-itself) |
| `getNetworkDiagnosticsInfo` | The window's diagnostics screen, where the host reports itself. [What the window asks a host about itself](#what-the-window-asks-a-host-about-itself) |
| `getManagedSettingsDiagnostics` | The same screen, where the policy layer being reported on is Copilot's. [What the window asks a host about itself](#what-the-window-asks-a-host-about-itself) |
| `diagnosticsFetch` | The same screen, which looks one endpoint up and fetches it. [What the window asks a host about itself](#what-the-window-asks-a-host-about-itself) |
| `vscode/createAgentHostDetachedWorktree` | The window's own handle on a tree, so its new-session-in-a-worktree flow runs unchanged. [Worktrees the window manages](#worktrees-the-window-manages) |
| `vscode/claimAgentHostDetachedWorktree` | The same flow, which marks a handle as a session's. [Worktrees the window manages](#worktrees-the-window-manages) |
| `vscode/setAgentHostDetachedWorktreeArchived` | The same flow, which archives a clean tree and puts it back. [Worktrees the window manages](#worktrees-the-window-manages) |
| `vscode/deleteAgentHostDetachedWorktree` | The same flow, which removes a tree and its branch. [Worktrees the window manages](#worktrees-the-window-manages) |
| `vscode/reconcileAgentHostDetachedWorktrees` | The same flow, which lets go of the trees the window has forgotten. [Worktrees the window manages](#worktrees-the-window-manages) |
| `vscode/removeSessionArtifact` | The window takes an artifact pill off with its own request. [Sessions and the catalogue](#sessions-and-the-catalogue) |
| `vscode/stopBackgroundWork` | The Stop button on a background task's row, which the host answers by calling the backend that reported it. [What the window asks a host about itself](#what-the-window-asks-a-host-about-itself) |
| `vscode/getAgentHostSessionStateFile` | The backend's own record of a session, read by the window's debug view. [What the window asks a host about itself](#what-the-window-asks-a-host-about-itself) |
| `vscode/collectAgentHostDebugLogs` | The window's own bundle of logs, for a bug report. [What the window asks a host about itself](#what-the-window-asks-a-host-about-itself) |
| `vscode/cancelAgentHostDebugLogs` | The same bundle, called off by the window that follows it. [What the window asks a host about itself](#what-the-window-asks-a-host-about-itself) |
| `vscode/readAgentHostDebugLogsChunk` | The same bundle, read back a megabyte at a time. [What the window asks a host about itself](#what-the-window-asks-a-host-about-itself) |
| `vscode/devContainers/isDockerAvailable` | The window drives a dev container from its own client and not from here, so the whole surface is the relay it holds. [CONTAINERS.md](../plugins/CONTAINERS.md) |
| `vscode/devContainers/connect` | The same surface: it opens the relay into the container. [CONTAINERS.md](../plugins/CONTAINERS.md) |
| `vscode/devContainers/disconnect` | The same surface: it ends the relay. [CONTAINERS.md](../plugins/CONTAINERS.md) |
| `vscode/devContainers/stop` | The same surface: it stops the container a folder is. [CONTAINERS.md](../plugins/CONTAINERS.md) |
| `vscode/devContainers/remove` | The same surface: it removes the container a folder is. [CONTAINERS.md](../plugins/CONTAINERS.md) |
| `vscode/devContainers/relaySend` | The same surface: one frame written to the host inside. [CONTAINERS.md](../plugins/CONTAINERS.md) |
| `vscode/devContainers/relayMessage` | A notification of that surface: one frame back from the host inside. [CONTAINERS.md](../plugins/CONTAINERS.md) |
| `vscode/devContainers/output` | A notification of that surface: the CLI's and the container's own output, which a person watches while an image builds. [CONTAINERS.md](../plugins/CONTAINERS.md) |
| `vscode/devContainers/relayClose` | A notification of that surface: the relay ended, and it was not this client that ended it. [CONTAINERS.md](../plugins/CONTAINERS.md) |
| `vscode/devContainers/closeConnection` | A notification of that surface: the connection is gone, so forget it. [CONTAINERS.md](../plugins/CONTAINERS.md) |

A plain HTTP request on the WebSocket port is not AHP either, and `listen` answers it 401 when the handshake would refuse its token and 426 when it would admit it, both with `Access-Control-Allow-Origin: *` ([Test a token](../server/REMOTE.md#test-a-token)).

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

An empty token withdraws the one held for that resource - the protocol names
this as revocation beside `expiresIn`, and the reference host does the same.
The next session that client asks for starts on nothing, the way it would for
a client that never pushed. What is already running keeps what it was started
with: a token is spent at start, into the harness's environment, and there is
no way to reach in and take it back out.

A token may come with `expiresIn`, the seconds it has left - a positive
integer, already less the time since the authorization server answered, which
the protocol puts on the client to subtract. This host keeps the moment it
runs out beside the token. A session asked for after that moment starts on
nothing, and the connection that pushed the token is told `auth/required` with
`reason: 'expired'` when it does, carrying the resource's whole RFC 9728 record
so the client knows where to sign in again. Only that connection: the token
was theirs. A token pushed without an expiry has none, and stays until it is
replaced, withdrawn, or the connection goes.

An automation firing at nine in the morning has no connection behind it and runs
on the daemon's own credentials.

This is not the same as the [connection token](AUTHENTICATION.md#the-door), which is about who may reach the host at all.

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

[`packages/sdk/test/conformance.test.ts`](../../packages/sdk/test/conformance.test.ts) drives the host and
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

So [`packages/sdk/test/wire.test.ts`](../../packages/sdk/test/wire.test.ts) closes the objects.
[`tools/schema.mjs`](../../tools/schema.mjs) generates a strict JSON Schema from
the package's own declarations - `additionalProperties: false` everywhere,
which the shipped `state.schema.json` has nowhere - and every frame the test
produces goes through ajv against it. An undeclared key and a missing required
one both fail the build, which is the only reason either is findable before a
client trips over it.

The frames are written out as
[`packages/sdk/test/fixtures/wire.jsonl`](../../packages/sdk/test/fixtures/wire.jsonl): a capture of the
commands and actions above, with timestamps and generated ids replaced by
stable ones so it can be diffed when something moves. The same check runs over
a recording taken off a real daemon, and over a capture in either shape:
`ahpd --wire` writes its capture in the shape VS Code's agent host uses, the
message with `_ahpLog` beside it, and a capture in the older line with the
frame under `frame` is read as well.

```bash
pnpm schema                            # after a protocol bump
pnpm wire -- packages/sdk/test/fixtures/wire.jsonl  # or a capture: ahpd --wire <file>, or scripts/tee.mjs
```
