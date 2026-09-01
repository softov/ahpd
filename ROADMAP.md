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

**Suggestions.** (1) Do this diff on every protocol bump, and say in the commit which fields moved and which were live here — the count of commands and actions says nothing about shapes. (2) Type the wire payloads against the package's own interfaces at the few places they are constructed, so the next removal is a compile error rather than an audit. That is a real change in how this host is written and it would have caught all four. (3) Leave it as a habit rather than a mechanism, which is what it is today.

## A-01-09 — An MCP server that needs signing in cannot be signed into

Reported as an error now, and this entry stays open because that is a retreat rather than a fix.

The correction first, because the old entry had it backwards. It claimed `McpServerAuthRequiredState` was `{ kind }` and carried no `resource`, so the MCP half was unreachable in 0.9.0. That was **wrong**: it extends `McpAuthRequirement`, which requires a `reason` *and* a `resource: ProtectedResourceMetadata` whose identifier is the canonical MCP server URI per RFC 8707, with `authorization_servers` the MCP authorization spec calls REQUIRED. The protocol is fine and complete. This host is the one that cannot fill it in.

All the SDK reports is `{ name, status, serverInfo?, error? }` — `status: 'needs-auth'` and not one word about where to sign in. There is nothing here to put in `resource` that would not be invented, and an invented one is worse than an absent one: a client's `authenticate` `resource` MUST match one the server advertised, so a made-up identifier is a token this host would then have to refuse. So `needs-auth` is now an `error` carrying the harness's own words, which is a state this host can satisfy completely and a sentence a person can still read. What is lost is the distinction a client could have acted on — and it could not have acted on it anyway.

**What this found on the way.** The `error` state was malformed too, and had been all along: `McpServerErrorState` requires `error: ErrorInfo`, and this host sent a bare `message`. Every other kind in the union — `ready`, `starting`, `stopped` — is `{ kind }` and nothing else, and used to get a `message` bolted on regardless. The same class of defect as the terminal one in A-02-02, found the same way, and for the same reason: these payloads are `Bag`, so nothing checks them.

**Suggestions.** (1) Ask the SDK to report what the CLI already knows — it performs the OAuth flow, so it has the server URI and the authorization server, and this is a gap in what it exposes rather than in the protocol. That is the only fix that gets the real state back. (2) Read the MCP server's own configuration from `.mcp.json` and friends and synthesise the metadata: honest for an HTTP server, impossible for a stdio one, and a second reader of files the CLI already owns. (3) Leave it as an error and stop tracking this, on the grounds that a client cannot act on the difference.

## A-01-03 — What is left of the protocol

Counted against `@microsoft/agent-host-protocol` **0.9.0**, which is the version this host builds against and the newest published: **40 commands** and **96 state actions** declared, of which this host serves **34 commands** and names **64 actions**.

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

**Suggestions.** (1) Leave the rest as named decisions and stop treating the table as a backlog — annotations, OTLP and shell integration are refusals with reasons, and an entry that never shrinks is not a roadmap. (2) Take `sessionConfigCompletions`, but only alongside a config key that actually needs looking up: serving it against five enums is a method that answers nothing. (3) Take `session/serverToolsChanged` by giving this host tools of its own to contribute — it is empty for a true reason today, and the reason would stop being true the moment there was one.
