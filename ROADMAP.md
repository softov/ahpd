# What is next, and why

Ordered by what unblocks a client, not by what is interesting to build. Each entry says what it costs a person today, and each ends with the two or three ways it could go — so a decision is a choice between named options rather than an open question.

Each entry carries a **reference code** so a conversation, a commit or an issue can name one without quoting it. `A-01-xx` is something missing; `A-02-xx` is something wrong. A code belongs to its entry for as long as the entry exists and is not reused after it is removed — a number that came back meaning something else would make every older reference to it silently wrong, which is why the numbering has gaps.

What has shipped is not listed. This file is what is left; `git log` is what was done, in the words the change was made in.

---

# Who this is a host for

This is the part that decides everything below it, so it goes first.

**This daemon is not ahpc's server.** It is an AHP host, and the protocol has more than one client. VS Code is the other implementation, it connects over a plain WebSocket, and it has been connected to this one — so "nothing calls that" is not a reason to leave anything unserved, because the thing that calls it is an editor somebody is already running. Every judgement further down is made against *a client*, not against ours.

Point VS Code at it, in `settings.json`:

```json
"chat.remoteAgentHostsEnabled": true,
"chat.remoteAgentHosts": [
  { "name": "ahpd", "address": "ws://127.0.0.1:9187", "connectionToken": "…" }
]
```

`address` may be bare (`127.0.0.1:9187`) or a full `ws://` / `wss://` URL; the token goes on the URL as `?tkn=` by the client, which is one of the two forms this host already accepts. `connectionToken` may be left out for a loopback host started without one.

What was checked, against a running daemon and a client sending VS Code's own handshake verbatim:

| what | result |
| --- | --- |
| version negotiation | the client offers `1.0.0, 0.8.0, 0.7.0, 0.6.0, 0.5.2, 0.5.1`; this host answers `0.8.0`, which is the newest both know. Negotiating down is what the client's own comment says it is for, so an editor newer than this daemon connects rather than refusing |
| `initialize` | `serverInfo`, the root snapshot, `defaultDirectory` and `completionTriggerCharacters` come back in the shape the client reads |
| sessions and changesets | `listSessions`, `createSession`, `subscribe`, and a changeset subscribed to by the URI its template became |
| operations | `commit` and `discard` advertised with status, the destructive one carrying the `confirmation` the client MUST display |
| the write gate | invoking without a grant is refused `-32009` carrying the `resourceRequest` that would unlock it; after the grant the same call commits, and the commit is in `git log` |
| watching a file | `createResourceWatch` on the project, then `added` / `updated` / `deleted` as the tree moves. VS Code's own filesystem provider degrades to a no-op watch without it, so a mounted tree used to go stale the moment the agent touched anything |
| editing a file | `resourceResolve` hands back an `etag`, `resourceWrite` without a grant is refused `-32009` carrying the request that would unlock it, sending that request back verbatim grants it, and the save then goes through with `ifMatch`. Re-using the stale etag is refused `-32011`, which is the lost update the field exists to stop |
| the boundary | `resourceRequest` for `file:///etc/shadow` is refused, because it is not in a served directory |
| automations, on a clock | a definition loaded from `automations.json` at boot, its `nextRunAt` computed in `America/Sao_Paulo`, and `* * * * *` firing twice a minute apart **with nobody connected** — which is the whole point of a daemon holding the clock. Then over a socket: `runAutomation`, the run's session carrying `origin`, and switching one off clearing both its next run and its `run` verb |

Two bugs came out of that drive and neither was visible from the source. An automation switched off still announced its *old* next run, because the inner store says "this changed" from inside its own `update` and the host reads the entry straight back — the clock was recomputed a moment too late. And the session an automation started carried no `origin` at all: the run knew which session it had made, and the session knew nothing about the run, which is the half a catalogue actually shows.

And on Deno as well as Node, which is what closed A-01-04: the same drive, on the same built output, under `deno 2.9.6`. It found one real difference — creating a file is a `rename` event on Node and a `change` event on Deno — so the watcher stopped reading the runtime's event names and looks at the file instead.

So the answer to "will my editor work against this" is yes, for the conversation, the catalogue, the terminals, the filesystem including saving to it, and the changesets including acting on them. What it will *not* do is everything in A-01-03 below, and that list is now written against what VS Code actually calls rather than against what this repository's own client happens to need.

---

## How a gap gets found

Two sweeps, because neither finds what the other does.

**Check the words, not only the shape.** A conformance audit that counted every action on every channel and every field on every state still missed a status word no client recognises, because the field was present, its type was a string, and only its *value* was wrong. The port types now take their vocabularies from the package as `` `${Enum}` `` — a template literal over a string enum is the union it declares, so the words move when the package does and a wrong one is a compile error. What a type cannot state is checked in `test/vocabulary.test.ts`: that the values this host actually writes, through paths where something was cast or came from the SDK, are members of the vocabulary they claim. One wrinkle worth knowing rather than an entry of its own — every enum the package declares is `declare const enum` while the `.js` beside it emits an ordinary runtime object, so a *named* value import of one is `TS2748` under `verbatimModuleSyntax`. A namespace import with the declared type cast away reads them fine, which is what that test does.

**Diff the protocol's own sources on every bump.** Every wire payload this host builds used to be a `Bag`, which is what made the shape of a release invisible: the 0.9.0 bump moved zero types here and needed no code change, while two of the four things it moved were live and wrong. The payloads are now typed against the package at the places they are constructed — `src/types/wire.ts` says how — so a field the protocol *removes* is a compile error. That still does not catch a field the protocol *adds* which this host should start sending, and catching those is what the diff is for: the automation channel and the error response part were both found that way, and neither typing nor a test would have.

**Ask the schema, not the key name.** `host.ts` imports no backend and is meant not to know one exists, and it held four Claude property names — routing `permissionMode`, `model`, `effortLevel` and `outputStyle` by name and refusing `thinking` by name. None of that was a fact about the host. A backend's schema now declares the two things the generic layer needs: `sessionMutable`, which the protocol already has, and `scope` — `'session'` for a key the chats of one session share, `'chat'` for one each answers for itself. Everything else goes through one `setConfig`, which answers `true` or a sentence, because only the backend knows whether a key or a value was the problem.

**Read the reference client too, not only the package.** The keys that cost the most this year are not in `@microsoft/agent-host-protocol` at all — `autoApprove`, `mode`, `isolation`, `branch`, `Permissions` and the `worktree*` family live in `vscode/src/vs/platform/agentHost`, because the protocol's config schema is deliberately generic and the conventional names live where the pickers do. A-01-10, A-01-11 and A-01-12 all came out of reading that tree. An audit counted against the package's declared types cannot see any of them. The same tree holds a *host* as well as a client, and reading that half is what settled A-01-09 and A-01-15: its backends meet the same harnesses this one does, so where a judgement here was "the SDK reports nothing, so the state cannot be filled", there is an implementation nearby that had to decide the same thing and wrote down what it chose.

[docs/AHP.md](docs/AHP.md) is the maintained table of what is served, feature by feature. This file does not repeat it: what is here are the judgements, which a table cannot hold.

## A-01-11 — A model is four fields out of ten

`SessionModelInfo` declares ten and this host now fills `id`, `name`, `provider` and `configSchema`. `provider` was simply absent — a required field never sent, because a backend answers `{ id, name }` (it has one provider, and naming it per row would be the same word repeated) and nothing added it on the way out.

`configSchema` is the one that draws a control, and it closes the half of this entry that was wrong rather than missing. Reasoning effort is a **per-model** property: the CLI reports a different `supportedEffortLevels` for each — some take all five, some take one, some take none — and this host advertised one session-wide `effortLevel` with all five values, so a level the chosen model does not support was accepted and then did nothing. Each model now carries its own `thinkingLevel` schema built from what that model actually supports, and a model that supports none carries no schema at all.

`effortLevel` stays advertised as a session key. Removing a key a client has already drawn is a control that vanishes, and the two do not conflict: one is the session's default and the other is the model's own form.

**What is left, and four of the five are decided.** `maxContextWindow`, `maxOutputTokens`, `maxPromptTokens`, `supportsVision` and `policyState`. The SDK reports none of the first four on `ModelInfo` — it has `supportsEffort`, `supportedEffortLevels`, `supportsAdaptiveThinking`, `supportsFastMode` and `supportsAutoMode`, and nothing about context or vision. The reference host is in the same position and answers it the same way: it keeps two projections of a Claude model, and the one that reads the SDK sends `provider`, `id`, `name`, `supportsVision: false` and `configSchema` and nothing else, while the limits appear only on the Copilot-routed projection that reads a CAPI catalogue's `capabilities.limits`. Field for field, that is what this host now sends.

What a client does with the five absent is worth knowing rather than guessing at. VS Code never reads `maxContextWindow` at all; it feeds `maxPromptTokens` and `maxOutputTokens` into a language-model record as `?? 0`, where only its BYOK bridge consumes them; it reads `supportsVision` as `?? false`, so absent and `false` are the same value; and it uses `policyState` for exactly one filter, `!== 'disabled'`, so an absent one means the model is offered. Nothing draws a context window from an agent host's model.

**Suggestions.** (1) Taken: leave the four limits and `policyState`, because the harness does not report them and `policyState` would be this host claiming a policy it does not enforce. (2) Still open, and the only thing left here: take the three `supports*` flags the SDK *does* report into `_meta`, which the protocol has for exactly this and which a client MAY read. (3) Revisit if the SDK starts reporting model limits.

## A-01-09 — An MCP server that needs signing in cannot be signed into

Reported as an error today, and after two reversals it stays that way - not for the reason first given, which was wrong, but because the harness will not let this host honour the state the protocol asks for.

**What the retreat costs, measured against a client rather than argued.** VS Code turns `McpServerStatus.AuthRequired` into a sign-in inside the conversation: it reads `resource`, `oauthClient`, `authorization_servers`, `scopes_supported`, `requiredScopes` and `reason` off the state, renders a part the person can click, and on the click runs the workbench's own OAuth — dynamic client registration and all — then pushes the token back through AHP `authenticate`. Against `error` none of that is drawn. What a person gets is one line in a hidden Output channel, *Server 'x' failed: …*, at error severity.

**The reason given for the retreat was wrong, and the reference host is the proof.** This entry claimed that inventing a `resource` is worse than omitting the state, because a client's `authenticate` MUST name a resource the server advertised. Microsoft's codex backend is in precisely this position — codex reports a `failed` startup with a human-readable "not logged in" and no metadata at all — and it does four things this entry ruled out. It matches the harness's own words with a regex over *not logged in*, *mcp login*, *unauthorized*, *401*. It fetches `<url>/.well-known/oauth-protected-resource` itself, with a fifteen-second timeout, to find the authorization server. When discovery fails it still emits `authRequired`, carrying bare `{ resource, resource_name }` and a logged warning that one-click sign-in may not complete — an incomplete resource is explicitly the better answer. And the server URL is not invented in the first place: it is the canonical resource identifier the MCP authorization spec names.

**One of the two things it depends on is there; the other is not, and that decides it.** The URL is: `McpServerStatus` carries a `config` — "includes URL for HTTP/SSE servers" in the SDK's own words — so the canonical resource identifier comes off the same status this host already reads, and no second reader of `.mcp.json` is needed. Somewhere to put a token a client hands back is not. `setMcpServers` looked like it, and both remote configs do take `headers`, but its own documentation is explicit: it "only affects servers added dynamically via this method or the SDK", and "servers configured via settings files are not affected". This host passes no `mcpServers` at all — every server a session has came from the CLI's own settings, `.mcp.json`, or a plugin. So naming one in `setMcpServers` does not re-declare it; it declares a second, dynamic server beside it, and the one that needs signing in stays as it was.

**So the halves do not separate, and shipping the first alone makes a client worse.** `authRequired` is what draws VS Code's in-chat sign-in, and its button runs the workbench's OAuth and calls `authenticate`. A host that asks for a token it must then refuse with `-32602` — or accept and drop — has put a person through a sign-in to arrive back where they started. The `error` state at least ends in a sentence.

**What the current state actually costs is smaller than it first read.** The `start` action is on every server row whatever its state, so `startMcpServer` reaches `reconnectMcpServer` and the CLI runs its own sign-in. That opens a browser on the machine the daemon is on — which for a daemon on the same machine as the editor, the ordinary case, is the right machine. What is lost is a banner and a log line's wording, not a way in.

**Suggestions.** (1) Taken: leave it as an error, and stop treating this as a gap in the host. The state the protocol wants is one this host cannot honour, and the way in that exists already works where the daemon is local. (2) Ask the SDK for a way to hand a token to a server it did not declare — that is the single change that makes `authRequired` honest here, and it is a gap in what the harness exposes rather than in the protocol. (3) Take MCP configuration over entirely, reading `.mcp.json` and its siblings and passing `mcpServers` into the query so every server is one this host declared: it would work, and it means re-implementing the CLI's discovery across user, project, enterprise and plugin scopes, which is a subsystem rather than a fix.

## A-01-15 — A resource a client publishes cannot be read

AHP is symmetrical: `ServerCommandMap` declares ten methods a host may call *on* a client — the eight `resource*`, plus `resourceRequest` and `createResourceWatch` — and the reference host uses them to read URIs its own client serves. This host has the machinery: `Peer.request` correlates a question with its answer, and a response frame is no longer answered with an error. Nothing is routed through it.

**The rule this entry called missing is not missing.** It said the blocker was that no scheme registration exists anywhere in the protocol, so a daemon several unrelated clients connect to cannot know which one owns a URI. Reading the reference host settles that: there is nothing to register, and ownership is never inferred. A client-side URI is wrapped as `vscode-agent-client://<clientId>/<scheme>/<authority>/<path>` — **the owning connection's id is the authority** — and the wrapping happens at intake, in the code that received the reference: a plugin is tagged with the client that declared it, an attachment with the client that sent it. One provider is registered for the scheme once, and per-client authorities are added as connections arrive. A daemon with unrelated clients does the same thing, because the connection a reference came in on is the owner and nobody has to announce a scheme.

**What is actually left.** Nothing sends this host a reference to read. That is the whole of it, and it becomes a cost the first time a client publishes something — a virtual filesystem, a plugin served from the editor — rather than a design question waiting on an answer.

**Suggestions.** (1) Wait for a client that publishes something, and when one does, tag the reference at intake with the connection it arrived on. (2) If this host ever mints URIs of its own for that traffic, copy the shape rather than the scheme: the client id belongs in the authority, where every routing decision downstream reads it without a table. (3) Nothing to ask the protocol for — the earlier suggestion to do that was answering a question the reference implementation had already answered.

## A-01-03 — What is left of the protocol

Counted against `@microsoft/agent-host-protocol` **0.9.0**, which is the version this host builds against and the newest published: **40 commands** and **96 state actions** declared, of which this host serves **34 commands** and names **75 actions**. The per-channel breakdown is [docs/AHP.md](docs/AHP.md) and is not repeated here — it drifted from this file once already, and one maintained table is worth more than two that disagree.

The version is worth stating rather than glossing, and the thing it used to explain has gone. VS Code advertises `1.0.0`, which is **not published** — its copy is vendored from the protocol repository and runs ahead of npm, where 0.9.0 is the newest. So negotiating down is permanent rather than temporary: this host answers 0.9.0 to a VS Code that asked for 1.0.0 first, and will keep doing that until whatever 1.0.0 is ships.

What the bump did close is the automation channel, which 0.8.0 did not declare at all. It is now declared and served, on a clock: `scheduledAutomations()` reads the protocol's own five-field cron in a named time zone, keeps definitions in `automations.json`, and catches up at most one missed occurrence — which is what `misfirePolicy: runOnce` means and is its default.

**The five commands not served.** Audited one at a time rather than labelled in a group, because "named refusal" turned out to be covering for two things that were not. The list skips `a`, `b`, `d` and `f`: `a` was the write half of `resource*`, `b` was `authenticate`, `d` was `createResourceWatch`, `f` was the clock, and all four shipped. A letter is not reused any more than a number is.

- **A-01-03c — `sessionConfigCompletions`**: config values that need looking up. Every key this host offers is an enum, so there is nothing to look up. VS Code calls it only for a key whose schema asks for it, which none of ours does.
- **A-01-03e — `otlp/exportTraces` and `exportMetrics`**: VS Code's client says `// Not recorded, yet` against both, so there is nothing on the other end. A genuine refusal, and one the reference implementation makes for us.
- **A-01-03g — `root/progress`**: VS Code *does* consume this — it fires as a notification and is meant for host-level work correlated by a `progressToken`, "e.g. a shared SDK download". This host has nothing slow enough at the host level to report; the slow things are turns, and those have their own channel. A refusal, but a thinner one than the others: the moment something here takes a visible amount of time outside a turn, it should say so.
- **A-01-03h — `auth/required`**: `authenticate` shipped and this did not. It is what a host sends when a token it accepted has expired or when a resource newly needs one, and nothing here can tell: this host does not verify a token, so it never learns that one has gone stale — a session started with a dead key fails inside the harness, and the harness's words are what a client sees. Emitting it would mean recognising an authentication failure in the agent's own error output, which is a guess about another program's strings. A refusal, and a thinner one than it looks: the moment this host verifies a token, it can say when one stopped working.

**The 21 state actions never emitted** are grouped by channel in [docs/AHP.md](docs/AHP.md), each with its reason. One of those reasons is worth arguing about rather than reading:

- The `workingDirectory*` set is nearly not a gap. `session/workingDirectorySet` and `Removed` are emitted in one window only: a client creates a backend session before the first message is sent, so the session exists while the answer about where it runs is still somebody's to give, and a change of isolation there starts it again in the directory the new answer names. After a turn has run the directory is fixed, because a session that moves is a conversation whose second half cannot see the files its first half was about. `chat/workingDirectorySet` is still never emitted: a chat does not have one of its own here.

`chat/truncated` stays refused for a reason worth keeping: it means "drop the turns before this one", and when the harness compacts, every one of them is still in the transcript and still readable. What was compacted is the model's context, not the conversation.

`ahpc dispatch <uri> <type> --field k=v` sends any client-dispatchable action verbatim, so this list is a thing that can be run rather than read off the types.

**Four other surfaces, swept the same way and mostly clean.** Counting methods and actions was never the whole audit; these are the rest of what a client can see.

| surface | this host |
| --- | --- |
| state fields | every field of `RootState`, `AgentInfo`, `SessionState`, `ChatState`, `Turn`, `TerminalState`, `ChangesetState` and `ChatSummary` is filled. `SessionModelInfo` is 4 of 10 (A-01-11), and each model carries its own `configSchema` because reasoning effort is per model, and `ChatState.steeringMessage` is unset because a steering message is consumed as it arrives, so nothing ever waits in it. `ChatSummary.interactivity` is absent, which the protocol says defaults to `Full` — the right answer for a host with no read-only chats |
| command params and results | one field unread out of every declared `*Params` / `*Result`: `InvokeChangesetOperationResult.followUp` (optional, and this host's operations produce no follow-up). `CreateSessionParams.activeClient` is read, and takes the creator into the session as it is made. `PaginatedParams` is read by both `fetchTurns` and `listSessions`, the second of them only when a client asks: `limit` omitted means the whole catalogue, because neither client that connects to this host reads `nextCursor`. `DispatchActionParams.clientSeq` is read now, and echoed back inside `origin`, which is the thing a client reconciles against |
| error codes | all 15 declared are raised. `TurnInProgress` (-32004) is the newest of them and answers a *changeset operation* dispatched mid-turn; a **turn** dispatched while one is running is still queued rather than refused, which is the better answer and the one a client can act on |
| `_meta` | the types name no well-known keys at all, so there is nothing to diff. What is known came from a conformance case, which is why `git.branch` is the only one written |

**Suggestions.** (1) Leave the rest as named decisions and stop treating the table as a backlog — OTLP and shell integration are refusals with reasons, and an entry that never shrinks is not a roadmap. Annotations were the one that stopped being a refusal on inspection, and are now served. (2) Take `sessionConfigCompletions`, but only alongside a config key that actually needs looking up: serving it against five enums is a method that answers nothing. (3) Take `session/serverToolsChanged` by giving this host tools of its own to contribute — it is empty for a true reason today, and the reason would stop being true the moment there was one.
