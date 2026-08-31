# What is next, and why

Ordered by what unblocks a client, not by what is interesting to build. Each entry says what it costs a person today, because a roadmap that only lists features cannot be argued with, and each ends with the two or three ways it could go — so a decision is a choice between named options rather than an open question.

Each entry carries a **reference code** so a conversation, a commit or an issue can name one without quoting it. `A-01-xx` is something missing; `A-02-xx` is something wrong. A code belongs to its entry for as long as the entry exists and is not reused after it is removed — a number that came back meaning something else would make every older reference to it silently wrong, which is why the numbering has gaps.

What has shipped is not listed. This file is what is left; `git log` is what was done, in the words the change was made in.

Counted against the protocol's own `types/` on 2026-08-31: **49 of 96 actions** are named in this source, leaving 24 server-origin and 23 client-dispatchable. [REFERENCE.md](REFERENCE.md) says where the specification and the other implementation of it are.

---

## A-01-01 — Operations on a changeset

Review is served. What is left is `operations` and `invokeChangesetOperation` — commit, revert, discard — and the question is not *how* but *whether*.

*How* is settled by the protocol, and its gate is finer than any flag: `ChangesetState.operations` is a list the **server** advertises, and `invokeChangesetOperation` takes an `operationId` that must match one from it, so a client can only invoke what this host has already offered. Advertising none is conformant — the field is optional, "omit when no operations are available" — which is what it does today. Two rules to copy from the reference when it is served: an operation is `Disabled` while a turn is active, so the working tree cannot be mutated mid-request, and anything destructive carries `confirmation`, which a client MUST display before invoking.

*Whether* is the open part. Committing and reverting are writes to somebody's repository from a daemon that may be reached from another machine, which is the same question the write half of `resource*` is waiting on.

**Suggestions.** (1) Serve nothing and say so permanently — this host computes changesets and never acts on one, which is already true and already conformant; retire the entry. (2) Serve the safe half only: `revert` on a single file, which is undoing the agent's own work rather than touching history, with `confirmation` set. (3) Serve everything including `commit`, gated by `resourceRequest` — see A-01-03b — so a client asks for write access and is granted or refused per resource rather than by a flag that opens the whole tree.

## A-01-03 — What is left of the protocol

The protocol defines **32 commands** and **96 state actions**. This host serves 19 commands and names 49 actions.

**The thirteen commands not served.**

- **A-01-03a — The write half of `resource*`**: `resourceWrite`, `resourceDelete`, `resourceMkdir`, `resourceMove`, `resourceCopy`. Deliberate: a host that lets any connected client write anywhere is a different proposition from one that lets it read the project it is working on, and this daemon is meant to be reachable from another machine.
- **A-01-03b — `resourceRequest`**: the access handshake, `Client ↔ Server`, by which a peer asks for read or write on a resource and is answered `-32009` or granted. It is the negotiated form of the refusal above, and the honest way to open the write half later: granted per resource rather than by serving the commands to everyone. It is also what A-01-01 would hang from.
- **A-01-03c — `authenticate`**: the client fetches a token and pushes it. The SDK has nowhere to put one, so this host serves the *gesture* — switching on an MCP server that is not ready reconnects it, which is how somebody signs in — and not the token.
- **A-01-03d — `sessionConfigCompletions`**: config values that need looking up. Every key this host offers is an enum.
- **A-01-03e — `invokeChangesetOperation`**: A-01-01.
- **A-01-03f — `runAutomation`, `fetchAutomationRuns`, `listAutomationTriggerDefinitions`**: A-01-06.
- **A-01-03g — `createResourceWatch`**: A-01-07.
- **A-01-03h — Annotations** (`annotations/*`, five client-dispatchable actions and no commands) and **OTLP** (`otlp/exportLogs`, `exportMetrics`, `exportTraces`): an editor's furniture and a telemetry pipe. Neither has a caller here, and neither is on the path a client takes to hold a conversation.

**The 24 server-origin actions never emitted**, by channel:

| channel | n | why |
| --- | ---: | --- |
| `changeset/*` | 7 | `fileSet`, `fileRemoved`, `contentChanged`, `cleared`, `statusChanged` are the incremental form of a changeset — this host recomputes and re-snapshots instead, which is correct but coarse. `operationsChanged` and `operationStatusChanged` are A-01-01. |
| `automation` + `automationRun` | 5 | A-01-06 |
| `terminal/*` | 4 | `cwdChanged`, `commandExecuted`, `commandFinished`, `commandDetectionAvailable` are shell integration, which needs a PTY this daemon does not have. `isPty: false` is the honest form of all four. |
| `chat/*` | 3 | `toolCallDelta` is deliberate and said in the code: a tool call's arguments stream as JSON, and a row redrawn per keystroke of a JSON blob says nothing until it is complete. `toolCallAuthRequired` / `AuthResolved` are mid-call MCP authentication, a moment the SDK does not surface. |
| `session/*` | 3 | `customizationRemoved` — the list goes out whole and nothing removes one alone. `creationFailed` is not needed rather than missing: `createSession` finishes or throws inside the request, so a client never holds a session in `creating`. `serverToolsChanged` is the correct field and empty for a true reason — `serverTools` are tools the *host* contributes, and this host defines none. |
| `resourceWatch/changed` | 1 | A-01-07 |
| `root/activeSessionsChanged` | 1 | presence, with `session/activeClient*` below |

**The 23 client-dispatchable actions not handled** — each a control a client may offer that this host would ignore: `session/workingDirectorySet` / `Removed` / `Replaced` and `chat/workingDirectorySet` / `Removed` (directories are fixed at creation here, and a session that moves is a conversation whose second half cannot see the files its first half was about); `session/activeClientSet` / `Removed`; `chat/turnResume`, `chat/inputAnswerChanged`, `chat/toolCallResultConfirmed`, `chat/toolCallContentChanged`, `chat/truncated`; `terminal/cleared`; `root/configChanged`; and the whole `annotations/*` set (5) and `automation*` set (4). `ahpc dispatch <uri> <type> --field k=v` sends any of them verbatim, so this list is a thing that can be run rather than read off the types.

`chat/truncated` stays refused for a reason worth keeping: it means "drop the turns before this one", and when the harness compacts, every one of them is still in the transcript and still readable. What was compacted is the model's context, not the conversation.

**Suggestions.** (1) Leave the whole list as named decisions and close the entry — most of it is honest refusal, and an entry that never shrinks is not a roadmap. (2) Take the three that are cheap and visible: `session/activeClientSet` / `Removed` and `root/activeSessionsChanged` are presence, which several clients on one session is exactly the case this daemon exists for. (3) Take `changeset/fileSet` and its siblings, so a changeset updates incrementally rather than re-snapshotting — worth it only once a changeset is big enough that re-sending it is felt.

## A-01-04 — Deno

Written to the same interface as Node and Bun and never run: Deno is not installed here. Until somebody runs it, the third case in `listen.ts` is a claim rather than a fact.

**Suggestions.** (1) Install Deno and run the suite against it, then say so in the README with the version it was proved on. (2) Delete the Deno case and say the daemon runs on Node and Bun — untested code that claims support is worse than no claim. (3) Keep it, and mark it in the README as written-not-run, which is what is true today and costs nothing.

## A-01-06 — Automations

A whole channel: `runAutomation`, `fetchAutomationRuns`, `listAutomationTriggerDefinitions`, the `automation/*` actions and the `automationRun/*` channel beneath them — a session started by a trigger rather than by a person, and watchable while it runs.

It is the one unserved channel with an obvious backing here, which is why it is worth naming rather than dismissing: the harness already has scheduled and triggered work. Nothing calls it today, and a client that offered the screen would drive nothing.

**Suggestions.** (1) Serve the read half first — `listAutomationTriggerDefinitions` and `fetchAutomationRuns` over what the harness already has — so a client can *show* automations before anything can start one. (2) Serve `runAutomation` as a manual trigger only, which is a session created with a named prompt and needs no scheduler at all. (3) Leave it, and record that this daemon runs the sessions somebody asks for and schedules nothing.

## A-01-07 — Resource watches

`createResourceWatch` and `resourceWatch/changed`: a client subscribes to a path and is told when it changes, rather than polling `resourceRead`. The read half of `resource*` is served, so this is the notification the served half implies and does not provide.

**Suggestions.** (1) Serve it with `node:fs.watch` behind a port, the way every other outside thing here arrives — a host given no watcher advertises none. (2) Fold it into the `changes` port, which already has a reason to know when files move and would otherwise grow a second, separate watcher. (3) Leave it: a client that re-reads on `session/changesetsChanged` learns about the files that matter without watching anything.
