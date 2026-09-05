# What is left to implement

Every part of the Agent Host Protocol this host does not yet serve, and how each
one gets served. Nothing here is a decision or a justification: what was decided
is in `git log`, and what is served is in [docs/AHP.md](docs/AHP.md). When every
box below is ticked this file is deleted.

Counted against `@microsoft/agent-host-protocol` **0.9.0**.

---

## 1. Reverse commands — 0 of 10 routed

`ServerCommandMap` declares ten methods a host may call *on* a client:
`resourceRead`, `resourceWrite`, `resourceList`, `resourceCopy`,
`resourceDelete`, `resourceMove`, `resourceResolve`, `resourceMkdir`,
`resourceRequest`, `createResourceWatch`. The transport exists — `Peer.request`
correlates a question with its answer — and nothing is routed through it.

- [ ] **1.1** A `Clients` port: `read`, `list`, `resolve`, `write`, `delete`,
  `move`, `copy`, `mkdir`, `watch`, `request`, each taking a client id and a URI
  and calling `connection.peer.request`.
- [ ] **1.2** Route by the connection a URI arrived on. A client-served URI is
  tagged at intake with the id of the connection that sent it, the way the
  reference host encodes it as `<scheme>://<clientId>/…`.
- [ ] **1.3** A `client:` scheme in `resources.ts` so an agent reading one of
  these paths reaches the client that owns it.
- [ ] **1.4** `ahpc` grows a `--serve <dir>` flag so there is a client that
  publishes a resource to read.

## 2. Server notifications — 5 of 9 sent

- [ ] **2.1** `otlp/exportTraces` — one span per turn, child spans per tool
  call, on `ahp-otlp://traces`, in the same OTLP/JSON shape `exportLogs` uses.
- [ ] **2.2** `otlp/exportMetrics` — turn count, turn duration, token counts
  and tool-call count, on `ahp-otlp://metrics`.
- [ ] **2.3** `root/progress` — a `progressToken` on the slow host-level work
  there now is: making a worktree, scanning a transcript, the boot probe.
- [ ] **2.4** `auth/required` — needs 4.4 first: nothing here notices a token
  going stale until something verifies one.

## 3. State actions — 75 of 96 emitted

### Terminals (4) — needs a PTY
- [ ] **3.1** `terminal/cwdChanged`, `commandExecuted`, `commandFinished`,
  `commandDetectionAvailable`. All four are shell integration and need a real
  PTY with OSC 133 sequence parsing; `terminals.ts` spawns pipes today and
  reports `isPty: false`. **Question 1.**

### Chat (6)
- [ ] **3.2** `chat/toolCallDelta` — stream tool arguments as they arrive
  rather than only the completed call.
- [ ] **3.3** `chat/turnResume` — emitted when a queued turn starts after the
  one before it finished.
- [ ] **3.4** `chat/workingDirectorySet` / `workingDirectoryRemoved` — needs
  4.3: a chat has no directory of its own until chats can differ.
- [ ] **3.5** `chat/toolCallAuthRequired` / `toolCallAuthResolved` — mid-call
  MCP authentication. Needs 4.4.

### Session (4)
- [ ] **3.6** `session/creationFailed` — created sessions fail inside
  `createSession` today. Emit it for a session an automation could not start,
  where there is no request to fail.
- [ ] **3.7** `session/customizationRemoved` — send the removal rather than
  re-sending the whole list.
- [ ] **3.8** `session/serverToolsChanged` — needs 4.5.
- [ ] **3.9** `session/workingDirectoryReplaced` — needs 4.3.

### Automation runs (2)
- [ ] **3.10** `automationRun/sessionSet` / `sessionRemoved` — a run that
  starts more than one session. `scheduled.ts` starts one.

## 4. Fields and capabilities

- [ ] **4.1** `SessionModelInfo.maxContextWindow`, `maxOutputTokens`,
  `maxPromptTokens`, `supportsVision`, `policyState`. The SDK's `ModelInfo`
  reports none of them. **Question 2.**
- [ ] **4.2** `ChatSummary.interactivity` and `ChatState.steeringMessage`.
- [ ] **4.3** `capabilities.multipleWorkingDirectories`, per-session and
  per-chat directory sets. The SDK takes additional directories at startup;
  what a *chat* can hold is the open half. **Question 3.**
- [ ] **4.4** MCP servers that need signing in: `McpServerAuthRequiredState`
  with a discovered `resource`, and a token from `authenticate` applied to the
  server. `setMcpServers` re-declares only servers the SDK itself declared, so
  this host has to own MCP configuration to apply one. **Question 4.**
- [ ] **4.5** `serverTools` — tools this host contributes to every session.
- [ ] **4.6** `InvokeChangesetOperationResult.followUp`.

## 5. Verification

- [ ] **5.1** Run softov-18's schema validator (`ahpc`, `tools/`) over a fresh
  capture in CI, with `additionalProperties: false`, so an undeclared field or
  a missing required one fails the build rather than a later audit.
- [ ] **5.2** A capture of every command and every action, taken against a
  running daemon, kept as the conformance fixture.

---

## Questions

**Question 1 — a PTY.** Shell integration (3.1) needs one, and a PTY means a
native dependency (`node-pty`) that has to build on every platform this daemon
runs on. Take the dependency, or leave those four actions unserved and say so in
`docs/AHP.md`?

**Question 2 — where model limits come from.** The Claude SDK does not report a
context window, an output cap or vision support. VS Code fills them from
Copilot's model catalogue over HTTP. Options: query the Anthropic models API at
boot, ship a static table keyed by model id, or leave the five fields absent.

**Question 3 — how far multiple working directories go.** The session half is
straightforward. The chat half means chats in one session running on different
directory subsets, which is a second agent process per subset. Do chats need
their own directories, or is per-session enough?

**Question 4 — MCP ownership.** Applying a client's token to an MCP server means
this host reading `.mcp.json` and the user, project and enterprise settings that
sit above it, and passing every server to the SDK itself. That is re-implementing
the CLI's own discovery. Do it, or serve `authRequired` without the token half so
a client at least sees why a server is unreachable?
