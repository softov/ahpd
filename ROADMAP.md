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

**Check the words, not only the shape.** A conformance audit that counted every action on every channel and every field on every state still missed a status word no client recognises, because the field was present, its type was a string, and only its *value* was wrong. The port types now take their vocabularies from the package as `` `${Enum}` `` — a template literal over a string enum is the union it declares, so the words move when the package does and a wrong one is a compile error. What a type cannot state is checked in `test/vocabulary.test.ts`: that the values this host actually writes, through paths where something was cast or came from the SDK, are members of the vocabulary they claim.

**Diff the protocol's own sources on every bump.** Every wire payload this host builds used to be a `Bag`, which is what made the shape of a release invisible: the 0.9.0 bump moved zero types here and needed no code change, while two of the four things it moved were live and wrong. The payloads are now typed against the package at the places they are constructed — `src/types/wire.ts` says how — so a field the protocol *removes* is a compile error. That still does not catch a field the protocol *adds* which this host should start sending, and catching those is what the diff is for: the automation channel and the error response part were both found that way, and neither typing nor a test would have.

**Read the reference client too, not only the package.** The keys that cost the most this year are not in `@microsoft/agent-host-protocol` at all — `autoApprove`, `mode`, `isolation`, `branch`, `Permissions` and the `worktree*` family live in `vscode/src/vs/platform/agentHost`, because the protocol's config schema is deliberately generic and the conventional names live where the pickers do. A-01-10, A-01-11 and A-01-12 all came out of reading that tree. An audit counted against the package's declared types cannot see any of them.

[docs/AHP.md](docs/AHP.md) is the maintained table of what is served, feature by feature. This file does not repeat it: what is here are the judgements, which a table cannot hold.

## A-02-06 — The protocol's enums cannot be named from typed code

Every enum the package declares is `declare const enum` in its `.d.ts` while the `.js` beside it emits an ordinary runtime object for the same name. Under `verbatimModuleSyntax` — which this repository uses, and which is the setting a modern TypeScript project is told to use — importing any of them as a *value* is a compile error. So `ChangesetStatus` exists at run time, is exported, has the right members, and cannot be read from a file that is typechecked.

**What it costs.** Type positions are unaffected: `` `${ChangesetStatus}` `` works, which is how A-02-05's narrowing is written. What is lost is checking a value at run time — `Object.values(ChangesetStatus).includes(x)` is the obvious way to validate something that arrived from outside the type system, and it cannot be written. `test/vocabulary.test.ts` reads the vocabularies out of the shipped `.d.ts` text instead, which works and is not a copy, but is a parser this repository maintains against a file format it does not own.

**Whose problem it is.** The package's, and it looks like an oversight rather than a decision: a `const enum` is meant to be erased at compile time and have no runtime object, and this one has both. `preserveConstEnums` produces exactly this shape. Nothing here can fix it.

**Suggestions.** (1) Report it upstream with the two-line reproduction, since every consumer using `verbatimModuleSyntax` hits it and most will conclude the enums are unusable rather than that the declaration is wrong. (2) Keep reading the declarations, which is what the vocabulary test does, and accept the parser as the cost of the workaround. (3) Copy the values into this repository and check against the copy — which is precisely the defect A-02-05 exists to stop, and is listed only to be refused.

## A-01-16 — Three worktree keys a client seeds and this host does not take

A-01-10 shipped with `isolation`, `branch` and `worktreeIncludeFiles`, and the half of this entry that was worth more is now closed too: a session created with `isolation: 'worktree'` reports it back on its own channel, read-only, beside the backend's settings — so a client can draw "isolated, on `agents/1a2b3c4d`" rather than inferring it from the path.

What is left are three the reference client declares and this host does not advertise: `worktreeBranchPrefix` (a prefix the client forwards from the person's `git.branchPrefix`), `worktreeBranchTrack` (whether the new branch tracks its upstream) and `worktreeCreateNewBranch` (check out the chosen branch instead of making one). All three are `readOnly` in the reference and seeded by the client rather than picked, so their absence costs a preference and not a capability — and the last of them is the only one that changes behaviour, since this host always makes a branch.

**What it costs today.** A person whose `git.branchPrefix` is `softov/` gets `agents/1a2b3c4d` rather than `softov/agents/1a2b3c4d`, and somebody who wanted the session to *continue* an existing branch cannot ask for it. Neither is a session that fails; both are a session that did something slightly other than what the person had configured elsewhere.

**Suggestions.** (1) Take `worktreeCreateNewBranch` alone, since it is the one with behaviour behind it, and leave the two cosmetic ones until somebody notices. (2) Take all three, which is the same merge and the same strip as the first cut. (3) Leave them: a branch name is a name, and the daemon's is at least predictable.

## A-01-12 — Tools cannot be allowed or denied for a session

`Permissions` is a platform config key — per-tool allow and deny lists — and VS Code's own Claude host advertises it *unchanged*, with a comment saying why: "the Claude SDK accepts `allowedTools` / `disallowedTools` natively". This host advertises nothing of the sort, so the only permission control it offers is the all-or-nothing mode in A-01-10's neighbour.

**What it costs today.** "Always allow this tool in this session" is the ordinary way a person stops being asked about the one command they trust, and it is the control that makes `default` mode usable on a long session. Without it the only way to stop being asked is `bypassPermissions`, which stops being asked about *everything* — the safety control is a cliff rather than a slope.

The SDK takes both lists when the query is built, and `canUseTool` is where this host already sits between the agent and the person, so a list could be enforced here as well as passed down.

**Suggestions.** (1) Advertise the platform key and pass the lists to the SDK at creation, which is the smallest thing that works and matches what the reference host does. (2) Enforce in `canUseTool` too, so a list changed on a *running* session takes effect without a restart — the SDK takes these when the query is built and this host is the only thing that can act on a later change. (3) Leave it, and accept that this host's permission control is one axis with no exceptions.

## A-01-11 — A model is two fields out of ten, and the effort control is in the wrong place

`SessionModelInfo` declares ten fields and this host fills `id`, `name` and `provider`. Missing: `maxContextWindow`, `maxOutputTokens`, `maxPromptTokens`, `supportsVision`, `policyState` and — the one that changes a screen — `configSchema`.

**Where effort actually belongs.** This host advertises `effortLevel` and `thinking` as *session* config keys, flat, the same for every model. VS Code's own Claude host does neither: reasoning effort is a **per-model** `configSchema` carrying a `thinkingLevel` property, and its `enum` comes from that model's own `reasoning_effort` list — different Claude models support different subsets (`['low','medium','high']`, `['high']`, `[]`), and a model supporting none renders no control at all. `createClaudeThinkingLevelSchema` in `common/claudeModelConfig.ts` is the whole of it, and the protocol's own comment says the same: "Configuration schema describing model-specific options (e.g. thinking level). Clients present this as a form and pass the resolved values in `ModelSelection.config`."

So this host offers one effort control for models that do not all take the same levels, and offers it in a place where a client draws it as a generic row rather than beside the model it belongs to. `thinking` is a second control for the same axis, immutable for a reason (A-01-03), and would fold into this one.

**What it costs today.** An effort level the chosen model does not support is accepted and then does nothing. A client cannot show a context window, cannot grey out a model whose policy blocks it, and cannot tell a vision model from one that will refuse an image.

**Suggestions.** (1) Take `configSchema` first and leave the rest: it is the only one of the six that draws a control, and the CLI's `supportedModels()` is already called at startup. (2) Take the numeric limits alongside it if the control protocol reports them, and leave `policyState` — this host enforces no model policy and inventing one would be worse than an absent field. (3) Leave `effortLevel` advertised as well during a transition, since removing a key a client has drawn is a control that vanishes.

## A-02-04 — The generic layer holds a list of Claude property names

`src/host.ts` routes `permissionMode`, `model`, `effortLevel` and `outputStyle` by name, and refuses `thinking` by name, in a file that imports no backend and is meant not to know one exists. Every other seam in this repository is a port; this one is four string comparisons.

**What it costs today.** Nothing a person can see, and everything a second backend would hit: `examples/` already ships two, and a config key either of them advertises is a key `host.ts` fans out to the wrong place or drops. The bug is latent rather than absent — the schema says what a property *is* and not who applies it, so the knowledge has to live somewhere, and it ended up in the one file that should not have it.

**Suggestions.** (1) Two fields on the schema property type — `scope: 'session' | 'chat'` and `mutable: boolean` — and `host.ts` fans out by scope and refuses immutables generically. Not an abstraction layer; two fields, and the property names go back to the backend that owns them. (2) Move the whole fan-out into the `Session` port and let a backend take its own config, which is more honest and more to write. (3) Leave it, and say in `host.ts` that the generic layer knows four Claude keys — a comment is worth more than a silence, and it is what the next backend author would need.

## A-01-09 — An MCP server that needs signing in cannot be signed into

Reported as an error now, and this entry stays open because that is a retreat rather than a fix.

The correction first, because the old entry had it backwards. It claimed `McpServerAuthRequiredState` was `{ kind }` and carried no `resource`, so the MCP half was unreachable in 0.9.0. That was **wrong**: it extends `McpAuthRequirement`, which requires a `reason` *and* a `resource: ProtectedResourceMetadata` whose identifier is the canonical MCP server URI per RFC 8707, with `authorization_servers` the MCP authorization spec calls REQUIRED. The protocol is fine and complete. This host is the one that cannot fill it in.

All the SDK reports is `{ name, status, serverInfo?, error? }` — `status: 'needs-auth'` and not one word about where to sign in. There is nothing here to put in `resource` that would not be invented, and an invented one is worse than an absent one: a client's `authenticate` `resource` MUST match one the server advertised, so a made-up identifier is a token this host would then have to refuse. So `needs-auth` is now an `error` carrying the harness's own words, which is a state this host can satisfy completely and a sentence a person can still read. What is lost is the distinction a client could have acted on — and it could not have acted on it anyway.

**What this found on the way.** The `error` state was malformed too, and had been all along: `McpServerErrorState` requires `error: ErrorInfo`, and this host sent a bare `message`. Every other kind in the union — `ready`, `starting`, `stopped` — is `{ kind }` and nothing else, and used to get a `message` bolted on regardless. The same class of defect as the terminal one in A-02-02, found the same way, and for the same reason: these payloads are `Bag`, so nothing checks them.

**Suggestions.** (1) Ask the SDK to report what the CLI already knows — it performs the OAuth flow, so it has the server URI and the authorization server, and this is a gap in what it exposes rather than in the protocol. That is the only fix that gets the real state back. (2) Read the MCP server's own configuration from `.mcp.json` and friends and synthesise the metadata: honest for an HTTP server, impossible for a stdio one, and a second reader of files the CLI already owns. (3) Leave it as an error and stop tracking this, on the grounds that a client cannot act on the difference.

## A-01-15 — A resource a client publishes cannot be read

AHP is symmetrical: `ServerCommandMap` declares ten methods a host may call *on* a client, and the reference host uses them to read `vscode-agent-client:` URIs its own client serves. This host now has the machinery — `Peer.request` correlates a question with its answer, and a response frame is no longer answered with an error — and does not route anything through it.

**What is actually missing is smaller than it looks, and harder.** Not the transport, which exists. The rule: *which connection owns which URI scheme*. There is no scheme registration anywhere in the protocol — not in `ClientCapabilities`, not in `initialize`, not in any action. VS Code gets away with a scheme its own client always owns, which is a single-client assumption a daemon several unrelated clients connect to cannot make.

**What it costs today.** Nothing yet, and that is the honest reason it is not built: no client connected to this host publishes a resource. It becomes a cost the first time one does — a virtual filesystem, a plugin served from the editor — and then it is not a feature to add but a conversation to have about ownership.

**Suggestions.** (1) Wait for a client that publishes something, and let what it publishes decide the routing rule. (2) Route by last-announcer — the connection that most recently named a scheme owns it — which is guessable, cheap, and wrong the moment two clients announce the same one. (3) Ask the protocol for a scheme registration, since the gap is theirs rather than ours: every implementation that has more than one client will need the same rule.

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

- The `workingDirectory*` set is not a gap. Directories are fixed at creation here, and a session that moves is a conversation whose second half cannot see the files its first half was about.

`chat/truncated` stays refused for a reason worth keeping: it means "drop the turns before this one", and when the harness compacts, every one of them is still in the transcript and still readable. What was compacted is the model's context, not the conversation.

`ahpc dispatch <uri> <type> --field k=v` sends any client-dispatchable action verbatim, so this list is a thing that can be run rather than read off the types.

**Four other surfaces, swept the same way and mostly clean.** Counting methods and actions was never the whole audit; these are the rest of what a client can see.

| surface | this host |
| --- | --- |
| state fields | every field of `RootState`, `AgentInfo`, `SessionState`, `ChatState`, `Turn`, `TerminalState`, `ChangesetState` and `ChatSummary` is filled. `SessionModelInfo` is 3 of 10 (A-01-11), and `ChatState.steeringMessage` is unset because a steering message is consumed as it arrives, so nothing ever waits in it. `ChatSummary.interactivity` is absent, which the protocol says defaults to `Full` — the right answer for a host with no read-only chats |
| command params and results | one field unread out of every declared `*Params` / `*Result`: `InvokeChangesetOperationResult.followUp` (optional, and this host's operations produce no follow-up). `CreateSessionParams.activeClient` is read, and takes the creator into the session as it is made. `PaginatedParams` is read by both `fetchTurns` and `listSessions`, the second of them only when a client asks: `limit` omitted means the whole catalogue, because neither client that connects to this host reads `nextCursor`. `DispatchActionParams.clientSeq` is read now, and echoed back inside `origin`, which is the thing a client reconciles against |
| error codes | all 15 declared are raised. `TurnInProgress` (-32004) is the newest of them and answers a *changeset operation* dispatched mid-turn; a **turn** dispatched while one is running is still queued rather than refused, which is the better answer and the one a client can act on |
| `_meta` | the types name no well-known keys at all, so there is nothing to diff. What is known came from a conformance case, which is why `git.branch` is the only one written |

**Suggestions.** (1) Leave the rest as named decisions and stop treating the table as a backlog — OTLP and shell integration are refusals with reasons, and an entry that never shrinks is not a roadmap. Annotations were the one that stopped being a refusal on inspection, and are now served. (2) Take `sessionConfigCompletions`, but only alongside a config key that actually needs looking up: serving it against five enums is a method that answers nothing. (3) Take `session/serverToolsChanged` by giving this host tools of its own to contribute — it is empty for a true reason today, and the reason would stop being true the moment there was one.
