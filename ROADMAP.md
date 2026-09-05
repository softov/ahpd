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

## 2. Server notifications — 9 of 9 sent

- [x] **2.1** `otlp/exportTraces` — one span per turn, child spans per tool
  call, on `ahp-otlp://traces`, in the same OTLP/JSON shape `exportLogs` uses.
- [x] **2.2** `otlp/exportMetrics` — turn count, turn duration, token counts
  and tool-call count, on `ahp-otlp://metrics`.
- [x] **2.3** `root/progress` — a `progressToken` on the slow host-level work
  there now is: making a worktree, scanning a transcript, the boot probe.
- [x] **2.4** `auth/required` — needs 4.4 first: nothing here notices a token
  going stale until something verifies one.

## 3. State actions — 90 of 96 emitted

### Terminals (4)
- [x] **3.1** `terminal/cwdChanged`, `commandExecuted`, `commandFinished`,
  `commandDetectionAvailable`, plus `TerminalState.supportsCommandDetection`
  and `isPty: true`. Shell integration: OSC 133 sequences parsed out of the
  stream, and OSC 7 for the directory.
- [x] **3.1a** The pty binding is handed in, not imported: a
  `pty?: (command, args, options) => PtyProcess` option on `shellTerminals()`,
  so `node-pty` is the daemon's dependency and never the library's, and a host
  on Bun or Deno passes its own. Without one the port keeps spawning pipes and
  keeps saying `isPty: false`.

### Chat (6)
- [x] **3.2** `chat/toolCallDelta` — stream tool arguments as they arrive
  rather than only the completed call.
- [x] **3.3** `chat/turnResume` — emitted when a queued turn starts after the
  one before it finished.
- [x] **3.4** `chat/workingDirectorySet` / `workingDirectoryRemoved` — needs
  4.3: a chat has no directory of its own until chats can differ.
- [ ] **3.5** `chat/toolCallAuthRequired` / `toolCallAuthResolved` — mid-call
  MCP authentication. The SDK surfaces no per-call auth moment; needs a way to
  tell that a tool call is blocked on a server rather than on its own work.

### Session (4)
- [x] **3.6** `session/creationFailed` — created sessions fail inside
  `createSession` today. Emit it for a session an automation could not start,
  where there is no request to fail.
- [x] **3.7** `session/customizationRemoved` — send the removal rather than
  re-sending the whole list.
- [x] **3.8** `session/serverToolsChanged` — needs 4.5.
- [x] **3.9** `session/workingDirectoryReplaced` — needs 4.3.

### Automation runs (2)
- [x] **3.10** `automationRun/sessionSet` / `sessionRemoved` — a run that
  starts more than one session. `scheduled.ts` starts one.

## 4. Fields and capabilities

- [x] **4.2** `ChatSummary.interactivity` and `ChatState.steeringMessage`.
- [x] **4.3** `capabilities.multipleWorkingDirectories: { immutablePrimary: true }`,
  and `CreateSessionParams.workingDirectories` beyond the first passed to the
  SDK as `additionalDirectories`. Index 0 is fixed for the session's lifetime,
  which is what `immutablePrimary` means and what the SDK enforces anyway.
- [x] **4.3a** `session/workingDirectorySet` and `Removed` on a running
  session. The SDK adds a root at runtime only when it resolves under `cwd` or
  under one passed at launch; anything else is refused in the SDK's own words.
- [x] **4.3b** `chat/workingDirectorySet` / `Removed` and
  `ChatState.workingDirectories`. Each chat here is its own process, so a chat
  can hold a subset of the session's without a second mechanism.
- [x] **4.4** MCP servers that need signing in. Four parts:
  read `.mcp.json` and the user, project and enterprise settings above it;
  pass every server to the SDK as its own so `setMcpServers` can re-declare
  one; emit `McpServerAuthRequiredState` with `resource` discovered from
  `<url>/.well-known/oauth-protected-resource`; apply a token from
  `authenticate` as that server's `Authorization` header.
- [x] **4.5** `serverTools` — tools this host contributes to every session.
- [x] **4.6** `InvokeChangesetOperationResult.followUp`.

## 5. Verification

- [ ] **5.1** Run softov-18's schema validator (`ahpc`, `tools/`) over a fresh
  capture in CI, with `additionalProperties: false`, so an undeclared field or
  a missing required one fails the build rather than a later audit.
- [ ] **5.2** A capture of every command and every action, taken against a
  running daemon, kept as the conformance fixture.
