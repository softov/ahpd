# Keeping up with the reference host

What VS Code's agent host changed since this host was last read against it, and what each change asks of this repository. One pass per review; a box is ticked by the commit that lands the work, and the pass stays here so the next one starts from a known point rather than from a clone's `HEAD`.

How a pass is made is in [REFERENCE.md](REFERENCE.md). The short of it: `git -C /github/externals/vscode fetch --depth=200 origin main && git merge --ff-only origin/main`, then `git log <last>..HEAD -- src/vs/platform/agentHost`, reading `common/state/protocol/` first because that is the wire, then `node/claude/`, `node/protocolServerHandler.ts`, and the workbench client under `src/vs/workbench/contrib/chat/browser/agentSessions/agentHost`, which is what VS Code *sends* to a host. The `.md` files were reflowed to one-line paragraphs upstream, so read them with `--word-diff`.

## Pass 4 - 2026-09-19, the first pass with the client in the clone

VS Code `8e35945b` (2026-09-12) to `832cf23c5` (2026-09-19): 72 agentHost commits and 230 files under `src/vs/sessions`. **The wire did not move** - `common/state/protocol/` is unchanged and `.ahp-version` is still `fd0471d4` - and the protocol repository moved one commit, `a21274d` to `8549827`, which adds a `CODEOWNERS` file. The full record, with every reference and the local file each item would change, is [`.project/review/2026-09-19-upstream-pass-4.md`](.project/review/2026-09-19-upstream-pass-4.md).

`src/vs/sessions` - the Sessions window, the reference client now - had been missing from the clone's sparse set, so a whole client was invisible to a pass. It is in the set now, here and in the other repository.

### The tools an agent is given

- [x] **`add_artifact_or_reference` promotes a reference to an artifact in place, keeping its id.** `packages/sdk/src/artifacttools.ts:180-182`. Built in `host/01`.
- [x] **Artifact tool answers are `<status>: <id>`.** `packages/sdk/src/artifacttools.ts:184,189,215`. Built in `host/01`.
- [x] **The pull request `create-pr` opens or reuses is recorded as a session artifact.** `packages/sdk/src/changes.ts:565,573`. This re-opens a box Pass 3 ticked: a pull request made by `prepare-pull-request` is one of these artifacts, and nothing here writes one. Built in `host/01`, for the reused pull request as well (`recordPullRequest` in `host.ts`).
- [x] **A round that ends with no text and no tool calls is announced as `responseRoundEnded`.** `packages/agent-claude/src/session.ts`. The SDK still has no round event (0.3.283), but the stream's own `message_start` to `message_stop` is one; built as `claude/03`.

### What the agent's own tools cost it

- [x] **The tools named in the first-turn instruction are always loaded.** `packages/agent-claude/src/session.ts`. Built in `claude/01`.
- [x] **Declare `artifactToolsCompactPrompts` in the root config.** `packages/sdk/src/host.ts:3358`. Built in `host/02`.

### What a client is told about a session

- [x] **A chat keeps the title it was given, across a restart.** `packages/sdk/src/host.ts:3302`. Built in `host/02`.
- [x] **`deferredTitleGeneration`, and a `rename_chat` shaped by the session's title strategy.** `packages/sdk/src/sessiontools.ts:497`. Built in `host/02`.

### What the Claude backend reports as a customization

- [x] **Plugins as top-level containers, their contributions out of the per-scope lists, and builtins in a container with real URIs.** `packages/agent-claude/src/session.ts`. Plugins built in `claude/01`; builtins were not needed, since neither the SDK nor this repository has an attributable builtin source.

### Read and not taken, triaged 2026-09-26

- [x] **Dev Containers as an extension surface.** Built in `container/01`, except its ahpapp half.
- [ ] **The terminal auto-approval rule engine.** An idea: [`terminal-commands-approved-by-rule`](.project/ideas/terminal-commands-approved-by-rule.md), with the two questions a plan has to settle first.
- [ ] **The turn tracker and its telemetry, and `vscode.modelCall`.** An idea: [`turn-and-model-call-diagnostics`](.project/ideas/turn-and-model-call-diagnostics.md).
- **Not possible from this host, as a fact:** `setAgentMergeEnabled` and the `vscode.pullRequest` Agent Merge turn (Agent Merge is a Copilot service; `packages/sdk/src/changes.ts` says so when asked), and the Copilot and Codex SDK surfaces (a different SDK with no AHP surface).
- **Not a host feature:** the central session catalog (VS Code's own cache, no wire surface), the transport's client side (VS Code dials out; this daemon is dialed to), and the window's own UI.

### Left open, answered 2026-09-26

- Dev Container sessions: yes, `container/01`.
- The token in the announced URL: it lives in the `0600` daemon record and never on stdout, `daemon/02`.
- The artifact answer shape: `<status>: <id>`, as the reference, `host/01`.
- The reused pull request records an artifact: yes, `host/01`.
- The session-owned pull request baseline: sent, `host/03`.
- The empty round: `claude/03`.
- Whether the window forwards root keys the schema does not declare: it does not; `agentHostRootConfigForwarder.ts` pushes only keys the host's schema lists, one per action. Both keys are declared, `host/02`.
- The pre-existing drift: fixed in `documentation/01`.

## Pass 3 - 2026-09-13, the "not taken" list re-evaluated

Same revisions as Pass 2. The list below was Pass 2's "Read and not taken", re-read with a different question: not "does the protocol require it" but "does VS Code's agent window draw or offer it from a host". Softov works in that window with this host behind it, so what the window can do from a host is what this host should provide, under the names VS Code uses, so that prompts and skills written for the reference host work here unchanged. The order is the order of work: the tap first, because every item after it is checked against a capture from a real window rather than against source read by eye.

### Seeing the wire

- [x] **`--wire <file>` writes every frame, both directions, as JSONL.** One line per frame: `{ "at": <ISO time>, "from": "client" | "host", "peer": <connection number>, "frame": <the JSON-RPC message, parsed> }`, the fields `scripts/tee.mjs` already wrote, so `tools/validate.mjs` reads either without change. Tapped on the socket in `listen.ts`, under the JSON-RPC layer, on all three runtimes, so what is written is what crossed the wire and not what either side meant. `ahpc --wire` and advisor's tap write the same lines.

### The tools an agent gets from its host

VS Code's host gives the agent inside a session tools for acting on the host (`serverToolNames.ts`, `node/shared/sessionServerTools.ts`). This host had three of its own, all read-only. The VS Code set is taken whole, with its names and input schemas, so a skill that calls `send_message` works on either host. `ahp_sessions` is retired into `list_sessions`; `ahp_resource` and `ahp_terminals` stay, since VS Code has no equivalent and they are not in the way.

- [x] **`list_sessions`, `get_current_session`, `get_session_context`.** The read side. `list_sessions` with VS Code's filters (`session`, `status`, `workspace`, `withChanges`, `unread`, `withPullRequest`, `includeArchived`, `createdAfter`, `createdBefore`) and its row shape (`session` for identity, `openLink` as an `agent-host-session://` link, status, activity, working directory, project, changes, git and GitHub facts, timestamps). `get_session_context` with `detail: summary | digest | full` and `transcriptLimit`, read from the chat's turns.
- [x] **`send_message`.** A turn on another session or chat, started at once when that chat is idle and queued behind the running turn when it is not (`chat/pendingMessageSet`, the queue a client already sees and can reorder). Asynchronous: the tool answers that it was delivered or queued and does not wait for the reply.
- [x] **`create_session`.** `relationship: currentSession` makes a peer chat in the calling session, sharing its directory and lifecycle; `independent` makes a session with its own `workspace`, `worktree` deciding isolation the way the config's `isolation` does, and `model` choosing the provider. `prompt` is sent as the first turn. Answers with the new session's URI and its `openLink`.
- [x] **`rename_chat` and `delete_session`.** The title, on the calling chat or a named one; a session gone for good, refusing the calling one.
- [x] **`set_workspace`.** `workspaceFolder` and `isolation` on the calling session: the same restart-into-a-directory this host already does for a client's `session/workingDirectorySet`, made reachable from the agent, with a continuation turn marked the way `sessionWorkspaceConversionService.ts` marks its own, key for key: `vscode.chat.requestHiddenFromTranscript` so the window draws the answer and not the prompt, `vscode.chat.systemInitiatedLabel` ("Continue in Requested Workspace", upstream's own string) so anything that lists the turn - history, the operation log, `chatListRenderer.ts` when a system-initiated request is shown - shows a label and not the prompt written for the model, and `vscode.chat.workspaceContinuation` so the file changes made in it are still attributed to that turn rather than skipped as a host notice (`sessionState.ts` `isHostNoticeTurn`).

### git and GitHub

- [x] **`_meta.github` on the session summary.** `pullRequestUrls` (most recent first, at most 10), `pullRequestBranchName`, `pullRequestState` with `pullRequestStateUrl`, `owner` and `repo`. Found by asking GitHub for the pull request of the branch: `gh pr view` where `gh` is installed, otherwise the API with the token VS Code pushes through `authenticate` for `https://api.github.com`, which this host already stores with its expiry. Refreshed with the other git facts, and when a `prepare-pull-request` operation makes one.
- [x] **`prepare-pull-request` and `checkout` as changeset operations.** VS Code draws a button for each operation a host lists, and sends its own request `_meta` with the call: `vscode.pullRequest` with title, description and draft on `create-pr`, after `prepare-pull-request` answered the form's contents as a `data:application/json` follow-up; `treeish` and `preCheckoutAction: stash | commit` on `checkout`. Push the branch and open the pull request with the lent token or `gh`; check the tree out after stashing or committing as asked, and refuse a dirty tree with `reason: dirtyWorkingTree`.
- [x] **Session artifacts.** The `add_artifact_or_reference`, `remove_artifact_or_reference` and `list_artifacts_and_references` tools, the artifacts on the session summary they write, and `vscode/removeSessionArtifact` behind `_meta['vscode.removeSessionArtifact']` in `initialize`. A pull request made by `prepare-pull-request` is one such artifact; the pill on the session row is drawn from them.

### Worktrees the window manages

- [x] **Detached worktrees.** `vscode/createAgentHostDetachedWorktree`, `claim`, `setArchived`, `delete` and `reconcile`, behind `_meta['vscode.detachedWorktrees']` in `initialize`. The window's "new session in a worktree" flow: a tree made from a prompt before the session exists, claimed by the session that starts in it, archived and deleted with it, and reconciled against the set the window still knows about. This host already makes worktrees for `isolation: worktree`; the methods put the window in charge of the same trees.

### Session config keys the window pushes

- [x] **`shellInitScripts`.** VS Code sends it where a session's schema declares it: scripts to source before every shell command the agent runs. Declare it, and run them through a `PreToolUse` hook on the Claude backend's `Bash` tool, which is the seam this host already uses for approvals.
- [x] **`sandboxEnabled`.** Declare it and map it onto the Claude Agent SDK's sandbox setting where that backend supports it; a backend that does not gets the key refused in `resolveSessionConfig` rather than silently ignored.
- [x] **A created session carries the whole host config.** `agentService.ts createSession` runs `_resolveCreatedSessionConfig` whenever a config or a directory was given, so the session's schema has `isolation`, `branch` and the `worktree*` keys with their values resolved, whatever the client sent. The window relies on it: its provisional session is created with `{ isolation: 'folder' }` from an ordinary window and nothing from the sessions window, and the chips are drawn from the session's schema. This host echoed back only the keys it was sent, so a session created with nothing drew no isolation and no branch chip; now the offer's defaults sit under the client's answers.

### What the window asks a host about itself

The rest of `IAgentHostExtensionCommandMap`, read on this pass and not noted before. Each is a request the window makes of its own host; a host that does not serve one answers `-32601`, which the window's commands for them show as unavailable.

- [x] **`vscode/getAgentHostSessionStateFile`.** `{ session, chat? }` to `{ resource? }`: where the chat's transcript lives on disk, behind `_meta['vscode.getAgentHostSessionStateFile.chat']` in `initialize`. The window's "open session state file" command. A Claude session has a JSONL transcript under `~/.claude/projects`, which is the honest answer; a backend without one answers no resource.
- [x] **`vscode/collectAgentHostDebugLogs` and `vscode/readAgentHostDebugLogsChunk`.** `{ session?, chat?, kind: archive | directory }` to a `resource` with its `entries`, and a base64 chunk reader over it. The window's "collect logs" command for a bug report. This host's wire tap and event log are the logs it has; the session's transcript is the provider's.
- [x] **`shutdown`, `getNetworkDiagnosticsInfo`, `diagnosticsFetch` and `getManagedSettingsDiagnostics`.** `shutdown` stops the host, which `ahpd stop` also does; the two network ones report proxy and certificate settings and try a fetch, for the window's network diagnostics; managed settings are Copilot's policy layer, which this host has no counterpart to and should answer as an empty list rather than `-32601`, since the window lists them beside the others.

### The filesystem the window browses

The window's folder dialog is `agentHostFileSystemProvider.ts` over `resourceList` and `resourceResolve`: it lists `..` from wherever it is, and stats whatever is typed before accepting it. `agentService.ts resourceList` is `fileService.resolve` on any directory, and `resourceRequest` grants everything, because the connection token has already decided who may ask.

- [x] **`--path` is the catalogue, not a fence.** This host refused every `resource*`, `createTerminal`, `createSession` and worktree outside the directories it was started on, which the reference host never did - so the window's "Select Folder" could pick nothing outside `--path` and a worktree of a served project was refused for landing beside it. The `ResourceStore` no longer takes `roots`, `within` is gone, and the backend takes any absolute directory. `--path` keeps its two meanings: where past sessions are listed, and where a session goes when nobody says.

## Pass 2 - 2026-09-13

VS Code `3aa54039` (2026-08-29) to `8e35945b` (2026-09-12), 206 agentHost commits. Protocol repository `fd0471d` to `a21274d`, dependabot only: `@microsoft/agent-host-protocol@0.9.0` is still current. VS Code's vendored snapshot moved `a0bc67f8` to `fd0471d4`, which is where the three protocol changes below come from.

### Protocol

- [x] **`authenticate` with an empty `token` is a revocation.** The protocol now says so beside `expiresIn`, and the reference host deletes the stored token on it (`agentHostAuthenticationService.ts`). This host answered `-32602`. Forget the token for that connection and answer `{}`. Nothing running is told: a token is spent at start, into the harness's environment, and cannot be taken back out.
- [x] **`authenticate.expiresIn` is honoured.** Seconds of life left, a positive integer, omitted when unknown. Keep an `expiresAt` beside the token; do not spend an expired one on a new session; send `auth/required` with `reason: 'expired'` when one runs out, to the connections that gave it. The `auth/required` row in `docs/AHP.md` says expiry is never reported because the host cannot know - it can now. Upstream `b4e90b1a`, protocol `fd0471d`.
- [x] **`ahp-automations://catalog` is accepted as the automations channel.** VS Code spelt it that way between `a0bc67f8` and `fd0471d4`, and `isAhpAutomationCatalogChannel` there now takes any URI on the `ahp-automations` scheme. Insiders builds from that window subscribe under the old spelling and were refused `-32001` about a session nobody named. Normalise on the way in, the way chat URIs already are.

### What the reference client reads out of `_meta`

- [x] **`activity: null` clears the activity in `root/sessionSummaryChanged`.** The reference host sends `null` (`agentHostStateManager.ts:205`, upstream `a9864c02`) and its client treats an absent field as unchanged (`agentHostSessionListStore.ts`), which it always did by object spread. This host left the field off when a session went idle, so the row in the agents window kept saying what the last tool was doing. Off-schema: `SessionSummary.activity` is typed `string`, and the row in `docs/AHP.md` should say why the wire carries `null` anyway.
- [x] **`_meta.toolKind` on tool calls.** `terminal`, `read`, `search`, `subagent` - the hint that routes a call to the terminal renderer, the subagent UI, or the search renderer. Upstream now derives it from Copilot's `permissionRequest` payload when a host does not stamp it, "for remote hosts", and this host is one. Bash is `terminal`; Read is `read`; Grep, Glob, WebSearch and WebFetch are `search`; Task and Agent are `subagent`. The Copilot fallback shape is not emitted.
- [x] **`_meta.progressMessage` on a running tool call.** The latest line of progress from a tool, transient, meaningful only while `running`. The SDK reports tool progress; this host dropped it. Upstream `dd12d29d`.
- [x] **`_meta.isSkill: true` on a completion item that is a skill.** The Automations editor keeps a runtime skill completion only when the flag says so. Upstream `6b606c6c`.

### Documentation

- [x] **`REFERENCE.md` records the checkpoint.** The revisions this repository was last read against, both repositories, with the date - so a pass starts from a line in the repository rather than from whatever the clone was left at. And the `--word-diff` note.
- [x] **`docs/AHP.md` says why `8e27ac16` does not apply here.** VS Code's `initialize` registers a state channel before its snapshot exists, so a client reconnecting across a host restart could replay deltas onto pre-restart state and draw a finished turn as running; upstream fixed it with a per-client "baseline debt". This host puts a channel on the watch list only after `snapshotOf` returned, which is why the bug has no purchase - a sentence in the `initialize` row, so nobody ports the fix.

### Read and not taken

Kept here so the next pass does not re-read them.

- `agent-merge` changeset kind and the `agentSystemNotificationMeta` kinds around it: Agent Merge is a Copilot service, and `create-pr` here says so when asked for it. `vscode.chat.systemInitiatedLabel` is on the one system-initiated turn this host starts (`set_workspace`, above); the window draws the label only on a system-initiated request that is not hidden, and this host has none of those.
- `vscode/requestWorkspaceTrust`: a VS Code-only RPC behind `_meta['vscode.requestWorkspaceTrust']` in `initialize`, which this host does not set. Trust is the window's to grant, and a daemon serving directories it was started on has nothing to ask.
- `node/claude/`: `agentHostCapabilities.workspaceConversion: false`, `setWorkingDirectory` throws, a `PreToolUse` hook denying GitHub tools during Agent Merge turns, `activation: 'restore'` allowing a cold SDK download. This host already changes a session's directories by resuming it, which is the thing upstream declines to do.
- Claude Agent SDK: upstream pins 0.3.239; this host is on 0.3.261.

## Pass 1 - 2026-09-05

VS Code `3aa54039`, protocol `fd0471d`, during the 0.4.0 work. No list was kept; what came out of it is in `docs/AHP.md` and the commits of that week.
