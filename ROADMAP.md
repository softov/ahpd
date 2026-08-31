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

So the answer to "will my editor work against this" is yes, for the conversation, the catalogue, the terminals, the filesystem including saving to it, and the changesets including acting on them. What it will *not* do is everything in A-01-03 below, and that list is now written against what VS Code actually calls rather than against what this repository's own client happens to need.

---

## A-01-03 — What is left of the protocol

Counted against `@microsoft/agent-host-protocol` **0.8.0**, which is the version this host builds against: **37 commands** and **86 state actions** declared, of which this host serves **30 commands** and names **53 actions**.

The version matters and is worth stating rather than glossing. VS Code speaks `1.0.0` and its client calls things 0.8.0 does not declare at all — `runAutomation`, `fetchAutomationRuns`, `listAutomationTriggerDefinitions`. Those are not gaps in this host against its own types; they are a version gap, and closing them starts with the dependency rather than with the code.

**The seven commands not served.** The list starts at `b` and skips `d`, because `a` was the write half of `resource*` and `d` was `createResourceWatch`, and both shipped; a letter is not reused any more than a number is.

- **A-01-03b — `authenticate`**: the client fetches a token and pushes it. The SDK has nowhere to put one, so this host serves the *gesture* — switching on an MCP server that is not ready reconnects it, which is how somebody signs in — and not the token. This one is still a genuine refusal rather than a gap.
- **A-01-03c — `sessionConfigCompletions`**: config values that need looking up. Every key this host offers is an enum, so there is nothing to look up. VS Code calls it only for a key whose schema asks for it, which none of ours does.
- **A-01-03e — OTLP** (`otlp/exportLogs`, `exportMetrics`, `exportTraces`) and **`root/progress`** and **`auth/required`**: a telemetry pipe and two notifications. Nothing here produces them and nothing downstream reads them.

**The 33 state actions never emitted**, by channel:

| channel | n | why |
| --- | ---: | --- |
| `annotations/*` | 5 | an editor's furniture — a client marks a range and the marks are shared. VS Code has a whole service for it. Nothing here produces one, and it is the one group where "no caller" is still true from both ends |
| `chat/*` | 7 | `toolCallDelta` is deliberate and said in the code: arguments stream as JSON, and a row redrawn per keystroke of a JSON blob says nothing until it is complete. `toolCallAuthRequired` / `AuthResolved` are mid-call MCP authentication, a moment the SDK does not surface. `truncated`, `inputAnswerChanged`, `toolCallResultConfirmed`, `toolCallContentChanged` are client-dispatchable and would be ignored |
| `changeset/*` | 4 | `fileSet`, `fileRemoved`, `cleared`, `statusChanged` are the incremental form of a changeset. This host now emits `contentChanged` after an operation, which is the coarse form of the same thing — worth replacing with the fine one only once a changeset is big enough that re-sending it is felt |
| `session/*` | 7 | `customizationRemoved` — the list goes out whole and nothing removes one alone. `creationFailed` is not needed rather than missing: `createSession` finishes or throws inside the request. `serverToolsChanged` is empty for a true reason — `serverTools` are tools the *host* contributes, and this host defines none. The four `workingDirectory*` and `activeClient*` are below |
| `terminal/*` | 5 | `cwdChanged`, `commandExecuted`, `commandFinished`, `commandDetectionAvailable` are shell integration, which needs a PTY this daemon does not have; `isPty: false` is the honest form of all four. `cleared` is client-dispatchable |
| `chat/workingDirectory*`, `session/workingDirectory*` | 5 | directories are fixed at creation here, and a session that moves is a conversation whose second half cannot see the files its first half was about |
| `session/activeClient*`, `root/activeSessionsChanged`, `root/configChanged` | 4 | presence and host-wide config. Presence is the cheapest real gap: several clients on one session is the case this daemon exists for, and none of them can see the others |

`chat/truncated` stays refused for a reason worth keeping: it means "drop the turns before this one", and when the harness compacts, every one of them is still in the transcript and still readable. What was compacted is the model's context, not the conversation.

`ahpc dispatch <uri> <type> --field k=v` sends any client-dispatchable action verbatim, so this list is a thing that can be run rather than read off the types.

**Suggestions.** (1) Take presence — `session/activeClientSet` / `Removed` and `root/activeSessionsChanged` — which is three actions and makes "somebody else is in this session" visible for the first time; several clients on one session is the case this daemon exists for and none of them can see the others. (2) Take `sessionConfigCompletions`, but only alongside a config key that actually needs looking up — serving it against five enums is a method that answers nothing. (3) Leave the rest as named decisions and stop treating the table as a backlog: annotations, OTLP and shell integration are refusals with reasons, and an entry that never shrinks is not a roadmap.

## A-01-04 — Deno

Written to the same interface as Node and Bun and never run: Deno is not installed here. Until somebody runs it, the third case in `listen.ts` is a claim rather than a fact.

**Suggestions.** (1) Install Deno and run the suite against it, then say so in the README with the version it was proved on. (2) Delete the Deno case and say the daemon runs on Node and Bun — untested code that claims support is worse than no claim. (3) Keep it, and mark it in the README as written-not-run, which is what is true today and costs nothing.

## A-01-08 — Speak 1.0.0

This host builds against `@microsoft/agent-host-protocol@0.8.0` and negotiates down to it against a VS Code that offers `1.0.0` first. That works, and it is also the reason three of VS Code's commands are not merely unserved but undeclared here: the automation channel does not exist in 0.8.0's types at all.

Version negotiation is what makes this safe to defer rather than urgent — an editor newer than this daemon connects, and gets the older protocol. It is also what makes it worth doing eventually, because everything added to AHP after 0.8.0 is invisible from here.

**Suggestions.** (1) Bump the dependency to `1.0.0`, take the type errors, and recount — the count above is the measure and it will move on its own. (2) Bump and pin, but keep negotiating down, so a client on 0.8.0 still connects — which is what the negotiation code already does in the other direction and costs nothing to keep. (3) Stay on 0.8.0 deliberately and record it, on the grounds that a host which negotiates down is compatible with every client either way — the honest position if nothing in 1.0.0 is wanted.

## A-01-06 — Automations

A session started by a trigger rather than by a person, and watchable while it runs: `runAutomation`, `fetchAutomationRuns`, `listAutomationTriggerDefinitions`, and the `automation/*` and `automationRun/*` channels beneath them.

Waits on A-01-08. None of it is in the types this host builds against, so there is nothing to implement against yet — but **VS Code's client calls all three commands**, which means an editor pointed here has an automations surface driving nothing. It is also the one unserved channel with an obvious backing: the harness already has scheduled and triggered work.

**Suggestions.** (1) After A-01-08, serve the read half first — `listAutomationTriggerDefinitions` and `fetchAutomationRuns` over what the harness already has — so a client can *show* automations before anything can start one. (2) Serve `runAutomation` as a manual trigger only, which is a session created with a named prompt and needs no scheduler at all. (3) Leave it, and record that this daemon runs the sessions somebody asks for and schedules nothing.

