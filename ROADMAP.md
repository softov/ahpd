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

## A-02-02 — What else moved under 0.9.0, and what it cost

A-02-01 is closed, and the audit it asked for is done: every `state.ts` in the protocol package diffed 0.8.0 against 0.9.0, field by field, and each removal checked against what this host actually emits.

**Four things moved. Two of them were live here.**

| moved | this host |
| --- | --- |
| terminal `exitCode` → `lifecycle`, and *required* in both `TerminalInfo` and `TerminalState` | emitted neither — a 0.9.0 client read `lifecycle.status` as `undefined` |
| `Turn.error` removed; a failure is now an `ErrorResponsePart` in `responseParts` | emitted neither — the state said `error` and nothing said why |
| session `creationFailed` → `failed` | never emitted the old name |
| `chat` added to `TerminalSessionClaim` | only ever emits a client claim |

Both live ones are fixed. `lifecycle` goes out beside the flat `exitCode`, because this host really does negotiate down to 0.5.1 and every version before 0.9.0 reads the flat one. A failed turn now carries its reason as a part, which is the better home for it anyway: what the agent said before it failed still stands, so the failure belongs after those things rather than beside them.

**And one the audit found that has nothing to do with 0.9.0.** `root/terminalsChanged` fired when a terminal was created and when it was disposed, and not when the shell inside it exited — so the catalogue described a dead terminal as running until somebody closed it. That was true before the bump and invisible: the old shape had no exit code to be wrong about. The new one says `{ status: 'running' }` out loud, which is what made it findable. A stale silence leaves a client with less to go on; a stale assertion tells it something untrue.

**What the audit says about the method, which is the part worth keeping.** The 0.9.0 bump moved zero types here and needed no code change, because every wire payload in this host is a `Bag`. That is what makes the shape of a release invisible, and it is why this had to be done by diffing the protocol's own sources rather than by waiting for a compiler. The same is true of the next release.

**Suggestion (2) is now done, and it found more than the audit did.** The payloads are typed against the package at the places they are constructed — `src/types/wire.ts` says how and why. Turning it on surfaced two shape defects nothing had noticed and no test had failed on: every *successful* turn went into the history with no `state`, because that field was only ever set when something went wrong, and every `Message` this host built went out with no `origin`, which the protocol requires on all of them. Both are the same class as the terminal and MCP ones, and neither showed up in an audit that was looking for exactly this — because they were not *changed* by 0.9.0, they had simply always been wrong.

What is checked now: the terminal channel end to end, a terminal claim off the wire (which is parsed rather than cast, and refuses a malformed one), the root channel's terminal list, an MCP server's state, a turn as it is built, and every message inside one.

**What is left.** `responseParts` is still a `Bag[]` — seven part kinds and an eight-state tool call, built up piece by piece as an agent talks. It is named as `WireTurn` rather than left implicit so the gap is visible. Worth closing before the next bump for the same reason the rest was: a `Bag` nobody wrote down is how this started.

**Suggestions.** (1) Type `responseParts` too, which is the last of it. (2) Do the 0.8.0-against-0.9.0 diff on every protocol bump anyway — typing catches a removal, and it will not catch a field the protocol *adds* that this host should now be sending. That is what an audit is for, and it is how the automation channel and the error part were found. (3) Leave the rest as a habit.

## A-01-09 — An MCP server that needs signing in cannot be signed into

Reported as an error now, and this entry stays open because that is a retreat rather than a fix.

The correction first, because the old entry had it backwards. It claimed `McpServerAuthRequiredState` was `{ kind }` and carried no `resource`, so the MCP half was unreachable in 0.9.0. That was **wrong**: it extends `McpAuthRequirement`, which requires a `reason` *and* a `resource: ProtectedResourceMetadata` whose identifier is the canonical MCP server URI per RFC 8707, with `authorization_servers` the MCP authorization spec calls REQUIRED. The protocol is fine and complete. This host is the one that cannot fill it in.

All the SDK reports is `{ name, status, serverInfo?, error? }` — `status: 'needs-auth'` and not one word about where to sign in. There is nothing here to put in `resource` that would not be invented, and an invented one is worse than an absent one: a client's `authenticate` `resource` MUST match one the server advertised, so a made-up identifier is a token this host would then have to refuse. So `needs-auth` is now an `error` carrying the harness's own words, which is a state this host can satisfy completely and a sentence a person can still read. What is lost is the distinction a client could have acted on — and it could not have acted on it anyway.

**What this found on the way.** The `error` state was malformed too, and had been all along: `McpServerErrorState` requires `error: ErrorInfo`, and this host sent a bare `message`. Every other kind in the union — `ready`, `starting`, `stopped` — is `{ kind }` and nothing else, and used to get a `message` bolted on regardless. The same class of defect as the terminal one in A-02-02, found the same way, and for the same reason: these payloads are `Bag`, so nothing checks them.

**Suggestions.** (1) Ask the SDK to report what the CLI already knows — it performs the OAuth flow, so it has the server URI and the authorization server, and this is a gap in what it exposes rather than in the protocol. That is the only fix that gets the real state back. (2) Read the MCP server's own configuration from `.mcp.json` and friends and synthesise the metadata: honest for an HTTP server, impossible for a stdio one, and a second reader of files the CLI already owns. (3) Leave it as an error and stop tracking this, on the grounds that a client cannot act on the difference.

## A-01-10 — A session cannot be given a worktree of its own

VS Code dispatches `isolation` at session creation and this host answers `isolation is not a config key this backend takes`, so every session runs in the folder it was pointed at and two sessions in one repository edit the same files under each other.

**Why it was not here before.** It looked like a client's business rather than a host's, which is exactly backwards — and the mistake is worth naming, because it is the same one A-01-03 makes elsewhere. `isolation` does not appear in `@microsoft/agent-host-protocol` at all: the protocol's config schema is deliberately generic, a backend advertises whatever property names it likes, and the *conventional* names live in the reference client. So an audit counted against the package's declared types — which is what A-01-03 is — could not see this, and the whole family with it: `isolation`, `branch`, `worktreeBranchPrefix`, `worktreeIncludeFiles`, `worktreeBranchTrack`, `worktreeCreateNewBranch`. They are in `vscode/src/vs/platform/agentHost/common/sessionConfigKeys.ts`, and that file says which side owns each one. These six are marked **host-owned** and "not passed to agents", which is as clear a statement as there is that this daemon is the thing that is missing.

`autoApprove` and `mode` were in that same blind spot and are now served — the two axes a client draws a permission picker from, translated onto the CLI's single `permissionMode` by `permissionFor` in `src/session.ts`. That is the shape the rest of this entry would take.

**What it means.** `isolation: 'folder'` is today's behaviour. `isolation: 'worktree'` means the host makes a `git worktree` for the session, off `branch`, named with `worktreeBranchPrefix`, with `worktreeIncludeFiles` copied in — untracked files a checkout would not carry, which is how a `.env` reaches the session that needs it. The session then runs there, and its changeset is against that branch rather than the shared tree.

**What it costs today.** Two agents on one repository is the ordinary case for a *sessions server* — it is most of the reason to run one — and right now they share a working tree. The second turn's changeset contains the first turn's edits, `discard` on a file discards somebody else's work, and neither client shows that the two are related.

**Suggestions.** (1) Take it in the `changes` port, which already spawns `git` and already knows the scopes: a worktree is a directory the port makes and reports, and `createSession` is handed it as `workingDirectory` — no new dependency, and a host given no `changes` port advertises no `isolation`, which is honest. (2) Take only `isolation` and `branch` first and leave the three worktree-shaping keys unadvertised: a client draws what a host advertises, so a half-served family is a half-drawn form rather than a broken one. (3) Leave it, and say in the schema that this host serves one directory per session — which is a refusal a person can read, and better than the silence it gives now.

## A-01-11 — A model is two fields out of ten, and the effort control is in the wrong place

`SessionModelInfo` declares ten fields and this host fills `id`, `name` and `provider`. Missing: `maxContextWindow`, `maxOutputTokens`, `maxPromptTokens`, `supportsVision`, `policyState` and — the one that changes a screen — `configSchema`.

**Where effort actually belongs.** This host advertises `effortLevel` and `thinking` as *session* config keys, flat, the same for every model. VS Code's own Claude host does neither: reasoning effort is a **per-model** `configSchema` carrying a `thinkingLevel` property, and its `enum` comes from that model's own `reasoning_effort` list — different Claude models support different subsets (`['low','medium','high']`, `['high']`, `[]`), and a model supporting none renders no control at all. `createClaudeThinkingLevelSchema` in `common/claudeModelConfig.ts` is the whole of it, and the protocol's own comment says the same: "Configuration schema describing model-specific options (e.g. thinking level). Clients present this as a form and pass the resolved values in `ModelSelection.config`."

So this host offers one effort control for models that do not all take the same levels, and offers it in a place where a client draws it as a generic row rather than beside the model it belongs to. `thinking` is a second control for the same axis, immutable for a reason (A-01-03), and would fold into this one.

**What it costs today.** An effort level the chosen model does not support is accepted and then does nothing. A client cannot show a context window, cannot grey out a model whose policy blocks it, and cannot tell a vision model from one that will refuse an image.

**Suggestions.** (1) Take `configSchema` first and leave the rest: it is the only one of the six that draws a control, and the CLI's `supportedModels()` is already called at startup. (2) Take the numeric limits alongside it if the control protocol reports them, and leave `policyState` — this host enforces no model policy and inventing one would be worse than an absent field. (3) Leave `effortLevel` advertised as well during a transition, since removing a key a client has drawn is a control that vanishes.

## A-01-12 — Tools cannot be allowed or denied for a session

`Permissions` is a platform config key — per-tool allow and deny lists — and VS Code's own Claude host advertises it *unchanged*, with a comment saying why: "the Claude SDK accepts `allowedTools` / `disallowedTools` natively". This host advertises nothing of the sort, so the only permission control it offers is the all-or-nothing mode in A-01-10's neighbour.

**What it costs today.** "Always allow this tool in this session" is the ordinary way a person stops being asked about the one command they trust, and it is the control that makes `default` mode usable on a long session. Without it the only way to stop being asked is `bypassPermissions`, which stops being asked about *everything* — the safety control is a cliff rather than a slope.

The SDK takes both lists when the query is built, and `canUseTool` is where this host already sits between the agent and the person, so a list could be enforced here as well as passed down.

**Suggestions.** (1) Advertise the platform key and pass the lists to the SDK at creation, which is the smallest thing that works and matches what the reference host does. (2) Enforce in `canUseTool` too, so a list changed on a *running* session takes effect without a restart — the SDK takes these when the query is built and this host is the only thing that can act on a later change. (3) Leave it, and accept that this host's permission control is one axis with no exceptions.

## A-02-03 — Steering is refused for a reason that may no longer be true

`chat/pendingMessageSet` with `kind: 'steering'` is answered `steering messages are not served yet`, on the grounds — written in `src/host.ts` — that "the SDK has nowhere to put one".

That looks wrong. The prompt this host hands the SDK is an async generator that stays open for the life of the session (`input()` in `src/session.ts`): it yields whatever is pushed into `waiting` and parks when there is nothing. Pushing a message into it while a turn is running is exactly what steering is, and nothing in the loop stops it — `queue` already pushes through the same door, it just waits for the turn to end first.

**What it costs today.** Typing while the agent works queues the message behind the turn it was about. A person correcting an agent mid-way — the most ordinary thing there is — is answered after it has finished doing the thing they were trying to stop.

**Suggestions.** (1) Try it: push the message immediately instead of queueing, and see whether the CLI takes it mid-turn. The change is one branch, and the reason for refusing is a claim nobody has tested. (2) If it does not work, keep the refusal and say the *tested* reason rather than the assumed one. (3) Either way, `ChatState.steeringMessage` and `ChatSummary.interactivity` are the two state fields this host never sets, and the first is only unset because of this.

## A-01-13 — `!` in the composer does not run a command

`InitializeResult.terminalCommandPrefix` is the prefix a host recognises at the start of a message as "run the rest of this as a terminal command". The standardised convention is `"!"`, and **absence means the host does not support it** — so this host's silence is already a correct answer, just not the useful one. VS Code implements the client half (`node/localCommands/bangLocalCommand.ts`) and this host has terminals, so both ends of it exist and nothing joins them.

**What it costs today.** Running one command in the session's directory means opening a terminal channel, which is several actions and a panel, for something that is one line of typing in every other tool.

**Suggestions.** (1) Advertise `"!"` and run the remainder through the `terminals` port, as one non-interactive command whose output becomes a response part — a host given no `terminals` port advertises no prefix, which is honest. (2) Advertise it and route through the agent instead, as though somebody had asked it to run the command, so the transcript records a tool call and the confirmation rules apply. (3) Leave it: the absence is already the specified way to say no.

## A-01-03 — What is left of the protocol

Counted against `@microsoft/agent-host-protocol` **0.9.0**, which is the version this host builds against and the newest published: **40 commands** and **96 state actions** declared, of which this host serves **34 commands** and names **64 actions**. [docs/AHP.md](docs/AHP.md) is the maintained table and counts commands and server notifications apart, which is the more useful split; the numbers here are the two groups added together.

The version is worth stating rather than glossing, and the thing it used to explain has gone. VS Code advertises `1.0.0`, which is **not published** — its copy is vendored from the protocol repository and runs ahead of npm, where 0.9.0 is the newest. So negotiating down is permanent rather than temporary: this host answers 0.9.0 to a VS Code that asked for 1.0.0 first, and will keep doing that until whatever 1.0.0 is ships.

What the bump did close is the automation channel, which 0.8.0 did not declare at all. It is now declared and served, on a clock: `scheduledAutomations()` reads the protocol's own five-field cron in a named time zone, keeps definitions in `automations.json`, and catches up at most one missed occurrence — which is what `misfirePolicy: runOnce` means and is its default.

**The five commands not served.** Audited one at a time rather than labelled in a group, because "named refusal" turned out to be covering for two things that were not. The list skips `a`, `b`, `d` and `f`: `a` was the write half of `resource*`, `b` was `authenticate`, `d` was `createResourceWatch`, `f` was the clock, and all four shipped. A letter is not reused any more than a number is.

- **A-01-03c — `sessionConfigCompletions`**: config values that need looking up. Every key this host offers is an enum, so there is nothing to look up. VS Code calls it only for a key whose schema asks for it, which none of ours does.
- **A-01-03e — `otlp/exportTraces` and `exportMetrics`**: VS Code's client says `// Not recorded, yet` against both, so there is nothing on the other end. A genuine refusal, and one the reference implementation makes for us.
- **A-01-03g — `root/progress`**: VS Code *does* consume this — it fires as a notification and is meant for host-level work correlated by a `progressToken`, "e.g. a shared SDK download". This host has nothing slow enough at the host level to report; the slow things are turns, and those have their own channel. A refusal, but a thinner one than the others: the moment something here takes a visible amount of time outside a turn, it should say so.
- **A-01-03h — `auth/required`**: `authenticate` shipped and this did not. It is what a host sends when a token it accepted has expired or when a resource newly needs one, and nothing here can tell: this host does not verify a token, so it never learns that one has gone stale — a session started with a dead key fails inside the harness, and the harness's words are what a client sees. Emitting it would mean recognising an authentication failure in the agent's own error output, which is a guess about another program's strings. A refusal, and a thinner one than it looks: the moment this host verifies a token, it can say when one stopped working.

**The 33 state actions never emitted**, by channel:

| channel | n | why |
| --- | ---: | --- |
| `annotations/*` | 5 | an editor's furniture — a client marks a range and the marks are shared. VS Code has a whole service for it. Nothing here produces one, and it is the one group where "no caller" is still true from both ends |
| `chat/*` | 7 | `toolCallDelta` is deliberate and said in the code: arguments stream as JSON, and a row redrawn per keystroke of a JSON blob says nothing until it is complete. `toolCallAuthRequired` / `AuthResolved` are mid-call MCP authentication, a moment the SDK does not surface. `truncated`, `inputAnswerChanged`, `toolCallResultConfirmed`, `toolCallContentChanged` are client-dispatchable and would be ignored |
| `changeset/*` | 4 | `fileSet`, `fileRemoved`, `cleared`, `statusChanged` are the incremental form of a changeset. This host now emits `contentChanged` after an operation, which is the coarse form of the same thing — worth replacing with the fine one only once a changeset is big enough that re-sending it is felt |
| `session/*` | 5 | `customizationRemoved` — the list goes out whole and nothing removes one alone. `creationFailed` is not needed rather than missing: `createSession` finishes or throws inside the request. `serverToolsChanged` is empty for a true reason — `serverTools` are tools the *host* contributes, and this host defines none. The `workingDirectory*` set is below |
| `terminal/*` | 5 | `cwdChanged`, `commandExecuted`, `commandFinished`, `commandDetectionAvailable` are shell integration, which needs a PTY this daemon does not have; `isPty: false` is the honest form of all four. `cleared` is client-dispatchable |
| `chat/workingDirectory*`, `session/workingDirectory*` | 5 | directories are fixed at creation here, and a session that moves is a conversation whose second half cannot see the files its first half was about |
| `root/configChanged` | 1 | host-wide configuration, which this daemon has none of that a client may change |

`chat/truncated` stays refused for a reason worth keeping: it means "drop the turns before this one", and when the harness compacts, every one of them is still in the transcript and still readable. What was compacted is the model's context, not the conversation.

`ahpc dispatch <uri> <type> --field k=v` sends any client-dispatchable action verbatim, so this list is a thing that can be run rather than read off the types.

**Four other surfaces, swept the same way and mostly clean.** Counting methods and actions was never the whole audit; these are the rest of what a client can see.

| surface | this host |
| --- | --- |
| state fields | every field of `RootState`, `AgentInfo`, `SessionState`, `ChatState`, `Turn`, `TerminalState`, `ChangesetState` and `ChatSummary` is filled. `SessionModelInfo` is 3 of 10 (A-01-11), and `ChatState.steeringMessage` is unset because of A-02-03. `ChatSummary.interactivity` is absent, which the protocol says defaults to `Full` — the right answer for a host with no read-only chats |
| command params and results | three fields unread out of every declared `*Params` / `*Result`: `terminalCommandPrefix` (A-01-13), `InvokeChangesetOperationResult.followUp` (optional, and this host's operations produce no follow-up), and `DispatchActionParams.clientSeq` — a client sends it and this host neither orders nor deduplicates by it, which is worth knowing rather than fixing |
| error codes | 14 of the 15 declared are raised. Only `TurnInProgress` (-32004) is not, and deliberately: a turn dispatched while one is running is *queued* here rather than refused, which is the better answer and the one a client can act on |
| `_meta` | the types name no well-known keys at all, so there is nothing to diff. What is known came from a conformance case, which is why `git.branch` is the only one written |

**The blind spot this method still has.** All of it counts against `@microsoft/agent-host-protocol`, and the keys that cost the most this year were not in it — `autoApprove`, `mode`, `isolation`, `branch`, `Permissions` and the `worktree*` family live in the reference client, because the config schema is deliberately generic and conventions live where the pickers do. A-01-10, A-01-11 and A-01-12 all came out of reading `vscode/src/vs/platform/agentHost` rather than the package. Any future audit has to read both.

**Suggestions.** (1) Leave the rest as named decisions and stop treating the table as a backlog — annotations, OTLP and shell integration are refusals with reasons, and an entry that never shrinks is not a roadmap. (2) Take `sessionConfigCompletions`, but only alongside a config key that actually needs looking up: serving it against five enums is a method that answers nothing. (3) Take `session/serverToolsChanged` by giving this host tools of its own to contribute — it is empty for a true reason today, and the reason would stop being true the moment there was one.
