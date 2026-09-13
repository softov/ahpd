# Keeping up with the reference host

What VS Code's agent host changed since this host was last read against it, and what each change asks of this repository. One pass per review; a box is ticked by the commit that lands the work, and the pass stays here so the next one starts from a known point rather than from a clone's `HEAD`.

How a pass is made is in [REFERENCE.md](REFERENCE.md). The short of it: `git -C /github/externals/vscode fetch --depth=200 origin main && git merge --ff-only origin/main`, then `git log <last>..HEAD -- src/vs/platform/agentHost`, reading `common/state/protocol/` first because that is the wire, then `node/claude/`, `node/protocolServerHandler.ts`, and the workbench client under `src/vs/workbench/contrib/chat/browser/agentSessions/agentHost`, which is what VS Code *sends* to a host. The `.md` files were reflowed to one-line paragraphs upstream, so read them with `--word-diff`.

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

- Session server tools: `set_workspace`, `create_session.worktree`, and `send_message` queueing behind a busy chat. This host's tools are its own (`ahp_sessions`, `ahp_resource`, `ahp_terminals`). The queueing semantic is the one to borrow if a `send` tool is ever added.
- `sandboxEnabled` and `shellInitScripts` session config keys: Copilot's. The client pushes `shellInitScripts` only where the session's schema declares it, so sessions here are never sent it.
- `agent-merge` changeset kind, `pullRequestState` in `_meta.github` (the reference host's second well-known session key, beside `git`; this host does not track pull requests), host-notice turns (`vscode.chat.requestHiddenFromTranscript`, `vscode.chat.systemInitiatedLabel`), `agentSystemNotificationMeta` kinds: Agent Merge and the merged-pull-request lifecycle, which is an editor's feature.
- Request `_meta` on changeset operations VS Code sends its own host: `treeish` and `preCheckoutAction` on a `checkout`, `vscode.pullRequest` on `prepare-pull-request`. This host offers `commit`, `discard` and `revert`, so neither operation is ever invoked here; `vscode.chat.workspaceContinuation` on a message likewise rides on workspace conversion, which this host declines.
- `vscode/removeSessionArtifact`, `vscode/requestWorkspaceTrust` and the detached-worktree extension methods: VS Code-only RPCs, each behind a `vscode.*` capability flag in `initialize`'s `_meta` that this host does not set.
- `node/claude/`: `agentHostCapabilities.workspaceConversion: false`, `setWorkingDirectory` throws, a `PreToolUse` hook denying GitHub tools during Agent Merge turns, `activation: 'restore'` allowing a cold SDK download. This host already changes a session's directories by resuming it, which is the thing upstream declines to do.
- Claude Agent SDK: upstream pins 0.3.239; this host is on 0.3.261.

## Pass 1 - 2026-09-05

VS Code `3aa54039`, protocol `fd0471d`, during the 0.4.0 work. No list was kept; what came out of it is in `docs/AHP.md` and the commits of that week.
