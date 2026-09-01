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

## A-02-01 — A terminal's exit code is still sent the 0.8.0 way

This host builds against 0.9.0 and `terminalInfo()` still emits a flat `exitCode`. In 0.9.0 that field moved inside `lifecycle`, which is a union — `{ status: 'running' }` or `{ status: 'exited', exitCode? }` — and the flat one is gone from the type.

Nothing is visibly broken, which is why it survived the bump: `ahpc` reads both spellings, and a client reading only the new one sees a terminal that never exits rather than an error. That is the bad kind of quiet — the host is advertising 0.9.0 and describing a terminal in the previous version's shape, so the client that behaves correctly is the one that gets it wrong.

Found while bumping the client, not while bumping the host: the host's own bump moved no types because every payload here is a `Bag`, which is exactly what let a stale shape through.

**Suggestions.** (1) Emit `lifecycle` and drop the flat field, which is what 0.9.0 says and what a client negotiating 0.9.0 is entitled to. (2) Emit both for a release, on the grounds that a client written against 0.8.0 may still be connected — although this host answers 0.9.0 only when a client asked for it. (3) Audit the rest of the root channel the same way before doing either, since `Bag` will have hidden any other field that moved.

## A-01-03 — What is left of the protocol

Counted against `@microsoft/agent-host-protocol` **0.9.0**, which is the version this host builds against and the newest published: **40 commands** and **96 state actions** declared, of which this host serves **34 commands** and names **64 actions**.

The version is worth stating rather than glossing, and the thing it used to explain has gone. VS Code advertises `1.0.0`, which is **not published** — its copy is vendored from the protocol repository and runs ahead of npm, where 0.9.0 is the newest. So negotiating down is permanent rather than temporary: this host answers 0.9.0 to a VS Code that asked for 1.0.0 first, and will keep doing that until whatever 1.0.0 is ships.

What the bump did close is the automation channel, which 0.8.0 did not declare at all. It is now declared and served, on a clock: `scheduledAutomations()` reads the protocol's own five-field cron in a named time zone, keeps definitions in `automations.json`, and catches up at most one missed occurrence — which is what `misfirePolicy: runOnce` means and is its default.

**The six commands not served.** Audited one at a time rather than labelled in a group, because "named refusal" turned out to be covering for two things that were not. The list starts at `b` and skips `d` and `f`: `a` was the write half of `resource*`, `d` was `createResourceWatch`, `f` was the clock, and all three shipped. A letter is not reused any more than a number is.

- **A-01-03b — `authenticate`**: called a refusal here for a long time on the grounds that "the SDK has nowhere to put a token". That was **wrong**, and checking it is what found it: the SDK's `query()` takes `env`, and its own documentation names `ANTHROPIC_API_KEY` as the credential the subprocess reads. So there is somewhere to put one, and this is a gap.

  What it would take: advertise `https://api.anthropic.com` in `AgentInfo.protectedResources` — the protocol says a server MUST accept any `resource` it has itself advertised, and this host advertises none, so no client can legally call `authenticate` today — hold the pushed token, and pass it as `ANTHROPIC_API_KEY` in the `env` handed to `query()`. The MCP half is not reachable in 0.9.0: `McpServerAuthRequiredState` is `{ kind }` and carries no `resource`, so a client cannot name an MCP server to authenticate.

  **Suggestions.** (1) Do it, and hold the token per host rather than per connection — a session outlives the connection that created it, and the credential is consumed when its subprocess is spawned. (2) Do it per connection, which is stricter and means a session started by one client cannot be resumed with another's credential; more correct and more surprising. (3) Leave it and say so in the README: this host runs as whoever started it, and the credential is that person's environment. That is what is true today, and it is a real answer for a daemon on your own machine and a poor one for `a shared machine`.
- **A-01-03c — `sessionConfigCompletions`**: config values that need looking up. Every key this host offers is an enum, so there is nothing to look up. VS Code calls it only for a key whose schema asks for it, which none of ours does.
- **A-01-03e — `otlp/exportTraces` and `exportMetrics`**: VS Code's client says `// Not recorded, yet` against both, so there is nothing on the other end. A genuine refusal, and one the reference implementation makes for us.
- **A-01-03g — `root/progress`**: VS Code *does* consume this — it fires as a notification and is meant for host-level work correlated by a `progressToken`, "e.g. a shared SDK download". This host has nothing slow enough at the host level to report; the slow things are turns, and those have their own channel. A refusal, but a thinner one than the others: the moment something here takes a visible amount of time outside a turn, it should say so.
- **A-01-03h — `auth/required`**: pairs with A-01-03b. Consumed by VS Code, and unemitted here for the same reason `authenticate` is unserved.

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
