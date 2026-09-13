# Keeping up with the reference host

What VS Code's agent host changed since this host was last read against it, and what each change asks of this repository. One pass per review; a box is ticked by the commit that lands the work, and the pass stays here so the next one starts from a known point rather than from a clone's `HEAD`.

How a pass is made is in [REFERENCE.md](REFERENCE.md). The short of it: `git -C /github/externals/vscode fetch --depth=200 origin main && git merge --ff-only origin/main`, then `git log <last>..HEAD -- src/vs/platform/agentHost`, reading `common/state/protocol/` first because that is the wire, then `node/claude/`, `node/protocolServerHandler.ts`, and the workbench client under `src/vs/workbench/contrib/chat/browser/agentSessions/agentHost`, which is what VS Code *sends* to a host. The `.md` files were reflowed to one-line paragraphs upstream, so read them with `--word-diff`.

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
- [x] **`set_workspace`.** `workspaceFolder` and `isolation` on the calling session: the same restart-into-a-directory this host already does for a client's `session/workingDirectorySet`, made reachable from the agent, with a continuation turn (`vscode.chat.requestHiddenFromTranscript` and `vscode.chat.workspaceContinuation`, the way `sessionWorkspaceConversionService.ts` marks its own) saying the workspace changed so the window draws it the way it draws its own, and still attributes the file changes made in it to that turn rather than skipping it as a host notice (`sessionState.ts` `isHostNoticeTurn`).

### git and GitHub

- [x] **`_meta.github` on the session summary.** `pullRequestUrls` (most recent first, at most 10), `pullRequestBranchName`, `pullRequestState` with `pullRequestStateUrl`, `owner` and `repo`. Found by asking GitHub for the pull request of the branch: `gh pr view` where `gh` is installed, otherwise the API with the token VS Code pushes through `authenticate` for `https://api.github.com`, which this host already stores with its expiry. Refreshed with the other git facts, and when a `prepare-pull-request` operation makes one.
- [x] **`prepare-pull-request` and `checkout` as changeset operations.** VS Code draws a button for each operation a host lists, and sends its own request `_meta` with the call: `vscode.pullRequest` with title, description and draft on `create-pr`, after `prepare-pull-request` answered the form's contents as a `data:application/json` follow-up; `treeish` and `preCheckoutAction: stash | commit` on `checkout`. Push the branch and open the pull request with the lent token or `gh`; check the tree out after stashing or committing as asked, and refuse a dirty tree with `reason: dirtyWorkingTree`.
- [x] **Session artifacts.** The `add_artifact_or_reference`, `remove_artifact_or_reference` and `list_artifacts_and_references` tools, the artifacts on the session summary they write, and `vscode/removeSessionArtifact` behind `_meta['vscode.removeSessionArtifact']` in `initialize`. A pull request made by `prepare-pull-request` is one such artifact; the pill on the session row is drawn from them.

### Worktrees the window manages

- [x] **Detached worktrees.** `vscode/createAgentHostDetachedWorktree`, `claim`, `setArchived`, `delete` and `reconcile`, behind `_meta['vscode.detachedWorktrees']` in `initialize`. The window's "new session in a worktree" flow: a tree made from a prompt before the session exists, claimed by the session that starts in it, archived and deleted with it, and reconciled against the set the window still knows about. This host already makes worktrees for `isolation: worktree`; the methods put the window in charge of the same trees.

### Session config keys the window pushes

- [x] **`shellInitScripts`.** VS Code sends it where a session's schema declares it: scripts to source before every shell command the agent runs. Declare it, and run them through a `PreToolUse` hook on the Claude backend's `Bash` tool, which is the seam this host already uses for approvals.
- [x] **`sandboxEnabled`.** Declare it and map it onto the Claude Agent SDK's sandbox setting where that backend supports it; a backend that does not gets the key refused in `resolveSessionConfig` rather than silently ignored.

### What the window asks a host about itself

The rest of `IAgentHostExtensionCommandMap`, read on this pass and not noted before. Each is a request the window makes of its own host; a host that does not serve one answers `-32601`, which the window's commands for them show as unavailable.

- [x] **`vscode/getAgentHostSessionStateFile`.** `{ session, chat? }` to `{ resource? }`: where the chat's transcript lives on disk, behind `_meta['vscode.getAgentHostSessionStateFile.chat']` in `initialize`. The window's "open session state file" command. A Claude session has a JSONL transcript under `~/.claude/projects`, which is the honest answer; a backend without one answers no resource.
- [x] **`vscode/collectAgentHostDebugLogs` and `vscode/readAgentHostDebugLogsChunk`.** `{ session?, chat?, kind: archive | directory }` to a `resource` with its `entries`, and a base64 chunk reader over it. The window's "collect logs" command for a bug report. This host's wire tap and event log are the logs it has; the session's transcript is the provider's.
- [x] **`shutdown`, `getNetworkDiagnosticsInfo`, `diagnosticsFetch` and `getManagedSettingsDiagnostics`.** `shutdown` stops the host, which `ahpd stop` also does; the two network ones report proxy and certificate settings and try a fetch, for the window's network diagnostics; managed settings are Copilot's policy layer, which this host has no counterpart to and should answer as an empty list rather than `-32601`, since the window lists them beside the others.

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

- `agent-merge` changeset kind and the `agentSystemNotificationMeta` kinds around it: Agent Merge is a Copilot service, and `create-pr` here says so when asked for it. `vscode.chat.systemInitiatedLabel` likewise, since no turn here is started by a service.
- `vscode/requestWorkspaceTrust`: a VS Code-only RPC behind `_meta['vscode.requestWorkspaceTrust']` in `initialize`, which this host does not set. Trust is the window's to grant, and a daemon serving directories it was started on has nothing to ask.
- `node/claude/`: `agentHostCapabilities.workspaceConversion: false`, `setWorkingDirectory` throws, a `PreToolUse` hook denying GitHub tools during Agent Merge turns, `activation: 'restore'` allowing a cold SDK download. This host already changes a session's directories by resuming it, which is the thing upstream declines to do.
- Claude Agent SDK: upstream pins 0.3.239; this host is on 0.3.261.

## Pass 1 - 2026-09-05

VS Code `3aa54039`, protocol `fd0471d`, during the 0.4.0 work. No list was kept; what came out of it is in `docs/AHP.md` and the commits of that week.
