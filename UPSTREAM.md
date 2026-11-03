# Keeping up with the reference host

What VS Code's agent host changed since this host was last read against it, and what each change asks of this repository. One pass per review; a box is ticked by the commit that lands the work, and the pass stays here so the next one starts from a known point rather than from a clone's `HEAD`.

How a pass is made is in [REFERENCE.md](REFERENCE.md). The short of it: `git -C /github/externals/vscode fetch --depth=200 origin main && git merge --ff-only origin/main`, then `git log <last>..HEAD -- src/vs/platform/agentHost`, reading `common/state/protocol/` first because that is the wire, then `node/claude/`, `node/protocolServerHandler.ts`, and the workbench client under `src/vs/workbench/contrib/chat/browser/agentSessions/agentHost`, which is what VS Code *sends* to a host. The `.md` files were reflowed to one-line paragraphs upstream, so read them with `--word-diff`.

## Pass 7 - 2026-10-22, VS Code 1.143.1

VS Code `7baac39ec3c` (the `1.141.1` tag) to the `1.143.1` tag `e646868227c` (2026-10-22; `1.142.0` is `d956e8a6ac5`, `1.143.0` is `2d0b7506a36`): 483 agentHost commits, 356 under `src/vs/sessions`, 146 in the workbench agentHost client, 777 in the union. The release branch leaves main at `341e0fa9346` and carries 35 commits after it. This pass covers 1.142 and 1.143. **The wire moved**: `.ahp-version` `6eec1b91` to `5d542f9e` (AHP PR #512), and upstream `PROTOCOL_VERSION` is `1.1.0`, which is not published; npm's `@microsoft/agent-host-protocol` is still `1.0.0`. A 1.143 window offers `1.0.0`, `0.10.0` and `0.9.0` (`common/agentHostProtocolCompatibility.ts`, `51ec2ee42fd`), so it agrees on `1.0.0` with ahpd. `REFERENCE.md` "Last read against" moves to `e646868227c`.

### Protocol 1.1.0

- [ ] **Per-chat config.** `ChatState.config`, the `chat/configChanged` action with its `replace` flag, and `chatMutable` on a session config property. Upstream marks `permissions`, `sandboxEnabled`, `autoApprove` and `mode` chat-mutable (`common/agentHostSchema.ts`). AHP `dbbd1217`, upstream `e941aa12741`. Waits for the published 1.1.0 package. `packages/sdk/src/host/actions.ts`, `packages/sdk/src/host/chatactions.ts`.
- [ ] **Steering and queued messages share `queuedMessages`**, told apart by `PendingMessage.kind`; `steeringMessage` still mirrors the latest steering for older clients. Upstream `0b4e0632b1f` (`common/agentSessionMessage.ts` `getPendingSteeringMessages`). ahpd holds one steering slot and hands it to `session.steer` (`packages/sdk/src/host/chatactions.ts`). A 1.143 window reads both shapes.
- [ ] **`SessionModelInfo.vendor`**, optional. `packages/sdk/src/host/catalogue.ts`.
- Windowed delivery (`subscribe.flowControl`, `channel/frame`, `channel/credit`, `channel/snapshot`) and the TCP channel (`createTcpConnection`, `tcp/*`) are experimental, and the window uses neither.

### Background shells

The wire is the 1.0.0 one: `ChatState.backgroundWork`, `chat/backgroundWorkSet` and `chat/backgroundWorkRemoved`, with `BackgroundShellWork.terminal` naming a terminal channel. The window draws a shell row the same for every provider (`workbench/.../agentHost/agentHostBackgroundShells.ts`): its output comes from a subscription to `terminal`, and Stop shows only when the row carries `_meta['vscode.stopBackgroundWork']: true`.

- [ ] **A shell row carries its terminal, and the terminal holds the output.** ahpd sends shell work as `shell:<task_id>` with no `terminal` (`packages/agent-claude/src/session/workers.ts` `reconcileWork`), so the window shows no output. Upstream reads a detached shell's output into an output-only terminal and marks it exited (`8cfec5873bc`, fixes `3f07e1aba32`, `4ea6157f821`, `13636b81c06`). Covers Pass 6's box for `57b4202903e`.
- [ ] **`vscode/stopBackgroundWork {chat, id}` stops one row, answering `{stopped}`**, and a row it can stop carries the `_meta` flag. Upstream `6eb5f37d1c0`, `18ab3d9ce44` (`common/agentHostExtensionProtocol.ts`, `node/protocolServerHandler.ts` `_handleStopBackgroundWorkRequest`, `IAgent.stopBackgroundWork`). `packages/sdk/src/host/vscodemethods.ts`; the Claude backend stops a task with `Query.stopTask`, as `workers.ts` `stopWorker` does.

### Large chats

The 1.143 speed-up is the window's: history is restored in 25 ms slices (`remoteChatSessionRestorer.ts`, `08b811e3ab0`, `5bed87aa911`). The window sends no `view` and no `flowControl`. Upstream's host stops loading peer chat history before a prompt (`c02f008cd15`) and skips republishing an unchanged server tool catalogue (`5ea3f3805a9`).

- [x] **A chat subscription that names no `view` gets every retained turn.** `SubscribeView` says a host MUST return all retained turns when `view` is left out. ahpd cuts a chat snapshot to the newest `PAGE` (50) turns whatever the subscribe says (`packages/sdk/src/host/snapshots.ts`, `packages/agent-claude/src/session.ts` `tail(ctx.turns)`, `packages/sdk/src/sessions/paging.ts`). Now every chat snapshot takes its turns through `windowOf`, so no view gives them all and a `view.turns` gives a window and a cursor (`packages/sdk/src/host/snapshots.ts`, `packages/sdk/src/host/sessionmethods.ts`). Built in `host/114` tasks 02 and 03; the window check in task 05 is still owed.
- [ ] **A `customizationsChanged` is sent only when the customizations changed**: each one cost the window 3 to 6 seconds to apply. `packages/sdk/src/host/tooling.ts`.

### Copilot SDK

Upstream runs Copilot in the agent host through `@github/copilot-sdk`, pinned exactly at `1.0.23-preview.5` with runtime `1.0.100-1` (`package.json`; six bumps in this range: `425e631ea34`, `cf0ccf5c6fd`, `8734ecea025`, `009603bfc85`, `be4f9ba6ec0`, `e630a740c19`). The SDK carries a native `copilot-runtime` per platform, about 165 MB on linux-x64. `node/copilot/` holds `CopilotAgent`, `CopilotAgentSession`, `CopilotSessionLauncher` and `mapSessionEvents.ts`: sessions are created, resumed, listed, deleted and forked through the SDK, approvals and input requests are its callbacks, and its events map onto turns, tools, subagents, background tasks and canvases.

- [ ] **A Copilot SDK agent plugin beside the `copilot` ACP preset.** Softov, 2026-10-22: beside, not replacing it. Its shape is `agent-claude`'s: a vendor SDK in the daemon's process, its events mapped onto turns. `packages/agent-acp/src/presets.ts` keeps the preset.

### Canvas

The canvas channel is the 1.0.0 one: `ChatState.canvases` holds `CanvasReference`s, `chat/canvasesChanged` changes the list, and an `ahp-canvas:/<id>` channel holds one `CanvasState` (`instanceId`, `extensionId`, `canvasId`, `title`, `status`, and a live `url`), replaced whole by `canvas/stateChanged`. Upstream fills it from the Copilot SDK's `session.canvas.*` events only (`e0f899884a3`), opens and closes canvases over a local bridge rather than AHP (`cba2384e944`), and the window draws canvases only for the local `copilotcli` provider (`agentHostChatContribution.ts` `supportsCanvasPresentation`).

- [x] **ahpd serves the canvas channel**, for ahpw and ahpapp. Softov, 2026-10-22, which reopens Pass 6's "left out, as in `host/47`". `packages/sdk/src/host/canvases.ts`, `packages/sdk/src/vscoderootconfig.ts` `canvasesEnabled`. Built in `host/116` tasks 01 to 04.

### compareAgents

Window-only (`sessions.chat.compareAgents.enabled`, `src/vs/sessions/SESSION_COMPARISONS.md`, `dd3b04daa8a` before this range). Each attempt is an ordinary session in its own worktree, the judge is an ordinary session with two client tools and `get_session_context`, and the scorecard reads `response.elapsedMs` and `chat/usage`. No new message, `_meta` or config key.

- [ ] **Run a comparison against ahpd in a 1.143 window**, and check the scorecard's time and tokens. `packages/sdk/src/tools/session.ts`, `packages/sdk/src/host/tooling.ts`.

### Other host changes

- [ ] **New `vscode/*` methods**: `moveSession` (initialize `_meta['vscode.sessionMove']`, session `_meta['vscode.movable']`, `389f0a7be92`), `readSavedChat` and `completeSavedChatContinuation`, `measureWorktreeDiskUsage` and `cancelWorktreeDiskUsage` for the worktree cleanup, and `cancelAgentHostDebugLogs`. `packages/sdk/src/host/vscodemethods.ts`.
- [ ] **Opaque chat URIs**, offered with initialize `_meta['vscode.ahpChatUris']` (`50559e744a1`). ahpd offers only `vscode.ahpSessionUris`. `packages/sdk/src/host/handshake.ts`.
- [x] **New sessions use the protocol's `ahp-session:` scheme** (`bd64649be19`, 2026-10-05). The provider is on `SessionSummary.provider`, not in the URI, and a session made before this keeps its `<provider>:/<id>` name. `packages/sdk/src/host/sessionmethods.ts`, `packages/sdk/src/host/catalogue.ts`, `packages/sdk/src/host/spawn.ts`, `packages/sdk/src/sessions/sessions.ts`, `packages/sdk/src/sessions/nested.ts`, `packages/sdk/src/plugins/plugins.ts`. Built in `host/126` tasks 01 to 05.
- [ ] **Named and prompted forks** (`80aa091c84c`). `packages/sdk/src/host/chatactions.ts`.
- [ ] **Multi-root is on by default** (`1044782bfd8`), which makes Pass 5's multi-folder `create_session` boxes matter more.
- [ ] **Root key `sessionCatalogEnabled` is removed** (`85e195f2594`). `packages/sdk/src/vscoderootconfig.ts`.
- MCP sampling (`ec010535075`), title review settings (`58afa23a1cb`), on-device models, the sandbox CA trust `_meta` and the per-session sandbox toggle are Copilot's or the window's.

## Pass 6 - 2026-10-14, VS Code 1.141.1

VS Code `7516b04bc94` (2026-10-02) to the `1.141.1` tag `7baac39ec3c` (2026-10-12; `1.141.0` is `2a59476c9bf`): 72 agentHost commits, 64 under `src/vs/sessions`, 22 in the workbench agentHost client, 118 in the union. The release branch leaves main at `ae1080a9ed1` and carries 44 commits after it. **The wire moved**: `.ahp-version` `9f940395` to `6eec1b91` (protocol `01292d03` and `6eec1b91`, both in the published `@microsoft/agent-host-protocol@1.0.0`; the protocol repository is at `cb6ba618`). Upstream `35787c9cb26` sets `PROTOCOL_VERSION` to `0.10.0` and registers `chat/isReadChanged` and the canvas actions as `0.10.0`, while the published 1.0.0 package registers `chat/isReadChanged` as `0.9.0` and offers only `1.0.0` and `0.9.0`. Most 1.141 release-note features landed inside Pass 5's range; this pass covers what reached the host after it and checks each feature against ahpd. `REFERENCE.md` "Last read against" moves to `7baac39ec3c`.

### Read state and nested sessions

A 1.141 window shows unread and modified time per chat in the session tree and offers Mark as Read and Mark as Unread on a chat and on a session. The window decides per host whether read state is per chat: a host that answers below `0.10.0` is treated as legacy, and the window keeps one read bit for the session.

- [ ] **Accept `0.10.0` in the handshake as an alias of the 1.0.0 contract.** A 1.141.1 window offers `0.10.0`; `negotiateProtocolVersion` in the 1.0.0 package does not know it, so ahpd answers `0.9.0` and the window drops to the legacy read path (upstream `0c9eb8e027b`, `baseAgentHostSessionsProvider.ts`). Upstream main maps `0.10.0` to the 1.0.0 contract in `agentHostProtocolCompatibility.ts` (`51ec2ee42fd`, not in 1.141.1). Upstream also adds `0.10.0` to the version list in the `-32005` refusal. The 1.0.0 package registers the canvas actions at `0.10.0`, so a version check does not keep them off the wire; ahpd sends none today. Upstream `35787c9cb26`, `0c9eb8e027b`, `51ec2ee42fd`. `packages/sdk/src/host/handshake.ts`.
- [x] **`chat/isReadChanged` changes only the addressed chat, and the host projects chat status into `SessionChatSummary.status` and publishes the catalog.** `packages/sdk/src/host/chatactions.ts` stores the chat flags, dispatches on the chat, sends `session/chatUpdated` with the status and calls `summaryMoved`; `packages/sdk/src/host/catalogue.ts` `chatSummary` ORs the chat flags into `status`. Built in `host/44` p3 task 02.
- [x] **`ChatSummary.modifiedAt` per chat**, which the tree sorts and shows. `packages/sdk/src/host/catalogue.ts` `chatSummary` (`chat.modifiedAt()`), re-sent by `packages/sdk/src/host/spawn.ts` when a chat's title, status or activity changes.
- [x] **`SessionChatSummary.status` replaces the deprecated `archived`.** `packages/sdk/src/host/catalogue.ts` `compactChats` carries `status`.
- [ ] **A chat whose turn ends is marked unread.** Upstream sets the read bit off on the chat at turn end and when a subagent chat finishes (`node/chatContributions/markUnread/markUnreadContribution.ts`, `0817aaa8245`). Nothing in ahpd clears `IsRead` at turn end, so a finished chat never shows as new. `packages/sdk/src/host/spawn.ts` turn end, through the chat flag path in `packages/sdk/src/host/chatactions.ts`.
- [ ] **Session and chat read state stay in step.** The session is read only when all its chats are read. Marking the session read marks its chat read when it has one counted chat; with more than one unread, upstream turns the action back to unread, and the 1.141 window marks each chat read first (`agentHostStateManager.ts`, `43ac7a4a236`; `chatRead/chatReadContribution.ts`). Upstream starts a new chat as read; ahpd starts it unread. In ahpd `sessionFlag()` and the chat bit handler in `packages/sdk/src/host/chatactions.ts` change one level only.
- [ ] **Archiving a chat marks it read** (`chatArchive/chatArchiveContribution.ts`). `packages/sdk/src/host/chatactions.ts`.

### Worktree cleanup

The storage suggestion, its thresholds (5 GB or 20 worktrees) and the setting `chat.agentSessions.sessionStorageCleanupSuggestion.enabled` are window-only (`sessionWorktreeCleanupService.ts`, `a58d8774308`, `116e03d9526`, `2eb200531dd`). The cleanup itself is `archiveSession`, so the work falls on the host's archive path.

- [ ] **Archiving a session removes its clean worktree, and unarchiving recreates it on the same branch.** Upstream does it in the `SessionIsArchivedChanged` side effect (`node/agentSideEffects.ts`), and first commits uncommitted changes with "Saving uncommitted changes before archiving session" (`c289a58900a`). The worktree record is in memory only (`lifecycle.ts` `worktrees`), and deleting a sleeping session skips `teardown`, so an archived session's worktree is never removed today. ahpd removes a worktree only on delete, and only when it is clean (`packages/sdk/src/host/lifecycle.ts` teardown); archive only queues `ctx.sleep` (`packages/sdk/src/host/chatactions.ts` `sessionFlag`). `packages/sdk/src/repo/worktrees.ts` for the recreate.
- [ ] **Act on `autoArchiveMergedSessionsAfterDays` and `autoDeleteArchivedMergedSessionsAfterDays`.** Upstream `b5db36cf258` (2026-09-09, inside Pass 5's range). Both are declared (`packages/sdk/src/vscoderootconfig.ts`) and nothing reads them. Depends on the box above for the disk to be freed.
- [x] **`resourceResolve` honors `followSymlinks`**, which the disk usage scan sets to `false` (`worktreeDiskUsage.ts`). `packages/sdk/src/host/resourcemethods.ts` `resourceResolve`.
- [x] **Detached worktrees are removed on archive.** `vscode/setAgentHostDetachedWorktreeArchived`, `packages/sdk/src/host/vscodemethods.ts`.

### Cross-platform sandboxing

The sandbox in 1.141 is the Copilot SDK's and the terminal tool engine's; the upstream Claude agent does not sandbox. The root config gains a `sandbox` object (`enabled`, network and path rules; `common/sandboxConfigSchema.ts`), and the session key `sandboxEnabled` stays an enum in `common/agentHostSchema.ts`. The MSRC fixes to the MCP sandbox in this range are Copilot-only.

- [x] **`sandboxEnabled` is replaced by the `sandbox` preset declaration in the Claude backend**, which maps `default`/`on`/`off` to the SDK `settings.sandbox.enabled`, and a stored `sandboxEnabled: 'on'` still applies. `packages/agent-claude/src/options.ts` (`storedSandbox`), `docs/sdk/AHP.md` (the Claude backend does not declare `sandboxEnabled`), decisions `a-stored-sandbox-on-survives-the-preset.md` and `a-preset-sandbox-off-wins-over-a-stored-on.md`.
- [ ] **Declare the root `sandbox` object.** A 1.141 window pushes it in `root/configChanged`; `packages/sdk/src/host/actions.ts` logs it as refused because `packages/sdk/src/vscoderootconfig.ts` does not declare it. Declaring it stops the noise. Mapping `enabled`, network and paths onto the Claude SDK `settings.sandbox` when the preset says `default` is Softov's call. `packages/sdk/src/vscoderootconfig.ts`, `packages/agent-claude/src/options.ts`.

### Session grid

Window-only: the two-dimensional session grid with nested splits and persisted geometry is in `src/vs/sessions/browser/parts/` (`cc8e72aa53b`, `86c80ce2ef4`) and sends nothing new to the host. ahpw already lays out its main area as tabs, tab groups, split, spatial, stack or single through scena (`/github/ahpw/src/view/layouts.ts`, `LayoutSelect.tsx`).

### Continuing external Copilot and Codex sessions

Not possible here, as Pass 4 found: discovery and adoption read the Copilot CLI and Codex stores through their SDKs. `showExternalSessions` is declared (`packages/sdk/src/vscoderootconfig.ts`). The writer-lock chat input state `_meta` (`c17dab99841`), which disables the input while another process holds the session, is reusable if ahpd adopts Claude CLI sessions that may still be running elsewhere.

### Other host changes

- [x] **Session config `sensitiveEditLocations`**: edits under the listed globs always ask, even with auto-approve on. Upstream `06687ce3dfd`, `fffc9bc6481` (`common/agentHostSchema.ts`, `node/shared/sessionPermissions.ts` `_matchesSensitiveEditLocations`). The host's own key on every session (`packages/sdk/src/host/common.ts` `HOSTS_TAKEN`), taken by `packages/sdk/src/host/chatactions.ts`, and read by the redirect check in `packages/sdk/src/access/commandautoapprover.ts` `writeAllowed`. Built in `host/20261102-1747` task 05.
- [ ] **Root config keys `activeAgentTitleGeneration` and `deferredTitleGeneration`.** Undeclared today, so they are logged as refused. `packages/sdk/src/vscoderootconfig.ts`.
- [ ] **`send_message` takes the mode and model controls of the target chat.** Upstream `d3ef8534b9a` (`node/shared/sessionServerTools.ts`). `packages/sdk/src/tools/session.ts`.
- [ ] **A subagent's failed and cancelled outcomes are reported as such** rather than as a completed result. Upstream `3f4647a7f9c`. `packages/sdk/src/host/spawn.ts`.
- [ ] **A cancelled subscription is told apart from a missing resource.** Upstream `539b7502df7`. `packages/sdk/src/host/relay.ts`.
- [ ] **Peer chats are restored after a refresh.** Upstream `2cab7c729da`. `packages/sdk/src/host/catalogue.ts`.
- [ ] **Background shell output is kept and readable after the turn.** Upstream `57b4202903e`. `packages/agent-claude/src/session.ts`.
- [ ] **Read-only config values survive a config push.** Upstream `b9573ffde95`. `packages/sdk/src/host/actions.ts`.
- [ ] **The commit action takes only uncommitted changes.** Upstream `880f8d903e7`. `packages/sdk/src/sessions/changes.ts`.
- [ ] **A nested session's Session Changes defaults to its own chat.** Upstream `88ff9e3b9f5`. `packages/sdk/src/sessions/changes.ts`.

### Not host

Block pasting, several GitHub Enterprise accounts, list density, session filters and the dev container samples are window or extension features and touch nothing on the host.

### Canvas

`chat/canvasesChanged`, `ChatState.canvases` and the `ahp-canvas:` channels are in the 1.0.0 package and stay left out, as in `host/47`. The handshake box above keeps them off the wire.

## Pass 5 - 2026-10-02, VS Code 1.140

VS Code `832cf23c5` (2026-09-19) to `7516b04bc94` (2026-10-02): 337 agentHost commits, 409 under `src/vs/sessions`, 108 in the workbench agentHost client. **The wire moved**: `.ahp-version` `fd0471d4` to `9f940395`, and the protocol repository `8549827` to `9f94039` (64 commits). `PROTOCOL_VERSION` is still `0.9.0` with no new tag, so the new actions are registered as `0.9.0` but are not in the published `@microsoft/agent-host-protocol@0.9.0`. The [release notes](https://code.visualstudio.com/updates/v1_140) name five features; each group below is one, except the last two.

### Multi-folder sessions

The working-directory actions date from 0.7/0.8 and are handled here (`host.ts`). What is new is host behaviour and the `_meta` the client reads.

- [ ] **`create_session` has two schemas, picked by `multipleWorkingDirectories`.** With it, `relationship` is optional (default `currentSession`), `workspace`/`worktree` are valid for `currentSession`, the folder joins the session and the new checkout goes only to the new chat; an omitted `worktree` reuses a checkout of that repository already in the session. Upstream `9b091281057`, `3722d65df29` (`node/shared/sessionServerTools.ts`). Claude advertises the capability (`packages/agent-claude/src/claude.ts`) but `packages/sdk/src/tools/session.ts` offers only the shared-workspace schema.
- [ ] **`create_session` `independent` without a `workspace` is a session with no folder.** Upstream `d0f50833ebf`. `packages/sdk/src/tools/session.ts` requires `workspace`.
- [x] **GitHub and git state are published per folder, and `_meta.github` on a live summary is no longer read.** The client reads `githubData` through `workingDirectoryKeys`, and `gitData` through `workingDirectoryScopeIds` (a scope id is the SHA-1 of the sorted folder keys); `_meta.git` is still read for the session folder. Upstream `18d64b8c226`, `a41ff3b2808`, `97182611fa2` (`common/state/sessionState.ts`, `sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts`). This undoes Pass 3's `_meta.github` box: the pull request pill falls back to recorded artifacts. `packages/sdk/src/host.ts` `metaOf`. Built in `host/39`.
- [ ] **Changesets and change summaries are per chat**: `ChatState.changesets`, `chat/changesetsChanged`, `changes` on `ChatState` and `SessionChatSummary`. Upstream `a8c1541df5a`, `5470377e71f`, `d17cacb01b3`; protocol `ba231a0`, `c02ad7e`. `packages/sdk/src/sessions/changes.ts`, `host.ts`; needs the next protocol package or local types.
- [ ] **`_meta.multiRoot` `{ workspaceFile }` from `createSession` config is echoed on the summary.** `host.ts` createSession.

### Remote delegation

The four tools (`list_agent_hosts`, `create_remote_session`, `get_remote_session`, `send_remote_message`) are client tools of the Agents window (`src/vs/sessions/contrib/remoteSessions/`, upstream `3bc56b58fe7`); `SESSIONS.md` says hosts do not discover or authenticate to one another. A host is picked as a target by its root `_meta`.

- [x] **Root `_meta['vscode.remoteSessions']: true`.** Without it the window refuses the host. `common/meta/vscode/agentRemoteSessionMeta.ts`. `host.ts` `rootState`.
- [x] **Root `_meta['vscode.agentHost.resources']` `{ platform, architecture, cpuCount, memoryBytes }`**, which `create_remote_session` filters on. `common/meta/vscode/agentHostResources.ts`. `host.ts` `rootState`.
- [x] **Keep `_meta['vscode.remoteSession.origin']` `{ session, chat, depth }` from `createSession`**, persisted and put back on the summary; its `depth` counts toward the spawn depth. `host.ts`, the session store, host/33 task 02.
- [x] **The `<remote_session_origin>` instruction when an active client offers `send_remote_message`.** `node/chatContributions/remoteSessionOrigin/remoteSessionOriginContribution.ts`. The turn instructions in `host.ts`.

container/05 p10 (a hub that relays a node's sessions) is host to host; VS Code made the window the hub, which its open question should cite.

### Shared worktree folders

- [x] **Session config key `worktreeSymlinkFolders`**, a `string[]` of `.gitignore` patterns, read-only, not session-mutable. On worktree creation the host symlinks matching git-ignored folders from the source checkout before copying the include files, and never fails the session over one. Upstream `b5d1894c729` (`node/worktreeSymlink.ts`, `node/agentHostGitService.ts`, `node/shared/worktreeIsolation.ts`). `packages/sdk/src/host.ts`, `packages/sdk/src/worktrees.ts`, `packages/sdk/src/types/worktrees.ts`. Built in `host/39`.
- [x] **`worktreeIncludeFiles` is an array.** The Sessions window sends `string[]`, and `host.ts` reads only a string, so `git.worktreeIncludeFiles` is dropped today. Declare an array, keep the string for older input. Built in `host/39`.

### HydraFusion

Not a host feature: a Copilot SDK synthetic model (`node/copilot/`). Its tool-call `_meta.fusionPhase` and `fusionProgress` notification shapes (`common/meta/vscode/agentToolCallMeta.ts`, `agentSystemNotificationMeta.ts`) are reusable if cofold runs several models.

### Enterprise controls

Not a host feature: policy minimum versions, the `autoTier` setting and identity telemetry are enforced in the window or the Copilot runtime. `getManagedSettingsDiagnostics: []` in `host.ts` stays correct.

### Session tools

- [ ] **Root config `agentOrchestrationLimits: 'on' | 'off'`**, default `on`, switches the spawn depth and count limits off. Upstream `bbf8dd79218` (`common/agentHostSchema.ts`). host/33 tasks 02 and 03 should use this name. `packages/sdk/src/tools/session.ts`, `host.ts`.

### The wire, beside the features

`@microsoft/agent-host-protocol@1.0.0` ships every item below; each line says where it is planned.

- [x] `moveChat` with `MoveChatParams`, `session/chatsReordered`, `chat/movableChanged` (protocol `2265e2e`, upstream `14b9d22f9a9`). Planned in `host/47` p1; VS Code itself answers `MethodNotFound`.
- [x] `ChatState.backgroundWork`, `chat/backgroundWorkSet|Removed` (protocol #482, upstream `c4db793967f`). Planned in `host/47` p2.
- [x] `chat/isArchivedChanged`, `SessionChatSummary.archived` (protocol `458cc41`, upstream `0af7cd09bb5`). Planned in `host/44` p3.
- [x] `session/mcpServerBackgroundRequested` (protocol `edef8d8`). Planned in `host/47` p3, with `McpServerStartingState.blocking`.
- [x] `ConfigPropertySchema.minItems/maxItems`; `FileEditSide`/`FileEditCollection` (types only). `minItems`/`maxItems` planned in `host/43` p3 and `host/45`; the file edit types in `host/47` p4.
- [x] `AutomationCapabilities.customizations`, `AutomationSessionTemplate.customizations` (protocol `9f94039`). Planned in `host/47` p5.
- [x] `ChangesetStatus.recomputing` and `McpServerStartingState.blocking` (1.0.0). `recomputing` planned in `host/47` p6, `blocking` in `host/47` p3.
- [ ] `chat/canvasesChanged`, `canvas/stateChanged` and the experimental `ahp-canvas:` channel, registered as `0.10.0`: if taken, sent only where `isActionKnownToVersion` says the connection's version knows them, which a 1.0.0 connection does and a 0.9.0 one does not. Left out for now: Softov, 2026-10-03, "Leave out for now".

`@microsoft/agent-host-protocol@1.0.0`, published 2026-10-03, carries every item in this list and the per-chat changesets above. `host/44` moves ahpd to it and takes `AutomationDefinition.disableConditions` with `AutomationEntry.runCount`, `SessionSummary.chats` and `defaultChat`, and `chat/isReadChanged`, and `host/43` p3 keeps `minItems`/`maxItems` on the root config schema; `host/47` plans the rest, canvas excepted. `SessionChatSummary.archived` shipped as the `status` bitset, `IsRead` and `IsArchived` beside the activity bits, and `chat/isArchivedChanged` sets that bit, so `host/44` p3 takes it too.

## Pass 4 - 2026-09-19, the first pass with the client in the clone

VS Code `8e35945b` (2026-09-12) to `832cf23c5` (2026-09-19): 72 agentHost commits and 230 files under `src/vs/sessions`. **The wire did not move** - `common/state/protocol/` is unchanged and `.ahp-version` is still `fd0471d4` - and the protocol repository moved one commit, `a21274d` to `8549827`, which adds a `CODEOWNERS` file. The full record, with every reference and the local file each item would change, is [`.project/review/2026-09-19-upstream-pass-4.md`](.project/review/2026-09-19-upstream-pass-4.md).

`src/vs/sessions` - the Sessions window, the reference client now - had been missing from the clone's sparse set, so a whole client was invisible to a pass. It is in the set now, here and in the other repository.

### The tools an agent is given

- [x] **`add_artifact_or_reference` promotes a reference to an artifact in place, keeping its id.** `packages/sdk/src/tools/artifacts.ts:180-182`. Built in `host/01`.
- [x] **Artifact tool answers are `<status>: <id>`.** `packages/sdk/src/tools/artifacts.ts:184,189,215`. Built in `host/01`.
- [x] **The pull request `create-pr` opens or reuses is recorded as a session artifact.** `packages/sdk/src/sessions/changes.ts:565,573`. This re-opens a box Pass 3 ticked: a pull request made by `prepare-pull-request` is one of these artifacts, and nothing here writes one. Built in `host/01`, for the reused pull request as well (`recordPullRequest` in `host.ts`).
- [x] **A round that ends with no text and no tool calls is announced as `responseRoundEnded`.** `packages/agent-claude/src/session.ts`. The SDK still has no round event (0.3.283), but the stream's own `message_start` to `message_stop` is one; built as `claude/03`.

### What the agent's own tools cost it

- [x] **The tools named in the first-turn instruction are always loaded.** `packages/agent-claude/src/session.ts`. Built in `claude/01`.
- [x] **Declare `artifactToolsCompactPrompts` in the root config.** `packages/sdk/src/host.ts:3358`. Built in `host/02`.

### What a client is told about a session

- [x] **A chat keeps the title it was given, across a restart.** `packages/sdk/src/host.ts:3302`. Built in `host/02`.
- [x] **`deferredTitleGeneration`, and a `rename_chat` shaped by the session's title strategy.** `packages/sdk/src/tools/session.ts:497`. Built in `host/02`.
- [x] **A subagent is its own read-only chat, opened from the call that spawned it.** `packages/sdk/src/host.ts` (`Start.subagent`, the `subagent` chat authority), `packages/agent-claude/src/session.ts` (routing by `parent_tool_use_id`, `forwardSubagentText`), `packages/agent-claude/src/transcript.ts` (restore from the CLI's `subagents/*.meta.json`). Built in `claude/04`. The spawning call also carries VS Code's `_meta.subagentDescription`, `subagentAgentName` and `subagentChatUri`; any `task_started` marks a worker background, as `claudeSubagentSignals.ts` does, and a call with `run_in_background` false or absent also ends on its result.

### What the Claude backend reports as a customization

- [x] **Plugins as top-level containers, their contributions out of the per-scope lists, and builtins in a container with real URIs.** `packages/agent-claude/src/session.ts`. Plugins built in `claude/01`; builtins were not needed, since neither the SDK nor this repository has an attributable builtin source.

### Approvals

- [x] **Confirmation options, and the one picked reaching the agent.** VS Code's host offers one set for every agent and keeps "Allow in this Session" itself (`sessionPermissions.ts`); here each backend offers its own agent's choices as `options` on `chat/toolCallReady`, and the `selectedOptionId` a client sends reaches `Session.confirm` as `optionId`. Claude offers "always allow" from the SDK's suggestions, an ACP server its own options, cofold "allow for this session"; pi offers none. Built in `host/24`.

### Read and not taken, triaged 2026-09-26

- [x] **Dev Containers as an extension surface.** Built in `container/01`, except its ahpapp half.
- [ ] **The terminal auto-approval rule engine.** An idea: [`terminal-commands-approved-by-rule`](.project/ideas/terminal-commands-approved-by-rule.md), with the two questions a plan has to settle first.
- [ ] **The turn tracker and its telemetry, and `vscode.modelCall`.** An idea: [`turn-and-model-call-diagnostics`](.project/ideas/turn-and-model-call-diagnostics.md).
- **Not possible from this host, as a fact:** `setAgentMergeEnabled` and the `vscode.pullRequest` Agent Merge turn (Agent Merge is a Copilot service; `packages/sdk/src/sessions/changes.ts` says so when asked), and the Copilot and Codex SDK surfaces (a different SDK with no AHP surface).
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
- [x] **`authenticate.expiresIn` is honoured.** Seconds of life left, a positive integer, omitted when unknown. Keep an `expiresAt` beside the token; do not spend an expired one on a new session; send `auth/required` with `reason: 'expired'` when one runs out, to the connections that gave it. The `auth/required` row in `docs/sdk/AHP.md` says expiry is never reported because the host cannot know - it can now. Upstream `b4e90b1a`, protocol `fd0471d`.
- [x] **`ahp-automations://catalog` is accepted as the automations channel.** VS Code spelt it that way between `a0bc67f8` and `fd0471d4`, and `isAhpAutomationCatalogChannel` there now takes any URI on the `ahp-automations` scheme. Insiders builds from that window subscribe under the old spelling and were refused `-32001` about a session nobody named. Normalise on the way in, the way chat URIs already are.

### What the reference client reads out of `_meta`

- [x] **`activity: null` clears the activity in `root/sessionSummaryChanged`.** The reference host sends `null` (`agentHostStateManager.ts:205`, upstream `a9864c02`) and its client treats an absent field as unchanged (`agentHostSessionListStore.ts`), which it always did by object spread. This host left the field off when a session went idle, so the row in the agents window kept saying what the last tool was doing. Off-schema: `SessionSummary.activity` is typed `string`, and the row in `docs/sdk/AHP.md` should say why the wire carries `null` anyway.
- [x] **`_meta.toolKind` on tool calls.** `terminal`, `read`, `search`, `subagent` - the hint that routes a call to the terminal renderer, the subagent UI, or the search renderer. Upstream now derives it from Copilot's `permissionRequest` payload when a host does not stamp it, "for remote hosts", and this host is one. Bash is `terminal`; Read is `read`; Grep, Glob, WebSearch and WebFetch are `search`; Task and Agent are `subagent`. The Copilot fallback shape is not emitted.
- [x] **`_meta.progressMessage` on a running tool call.** The latest line of progress from a tool, transient, meaningful only while `running`. The SDK reports tool progress; this host dropped it. Upstream `dd12d29d`.
- [x] **`_meta.isSkill: true` on a completion item that is a skill.** The Automations editor keeps a runtime skill completion only when the flag says so. Upstream `6b606c6c`.

### Documentation

- [x] **`REFERENCE.md` records the checkpoint.** The revisions this repository was last read against, both repositories, with the date - so a pass starts from a line in the repository rather than from whatever the clone was left at. And the `--word-diff` note.
- [x] **`docs/sdk/AHP.md` says why `8e27ac16` does not apply here.** VS Code's `initialize` registers a state channel before its snapshot exists, so a client reconnecting across a host restart could replay deltas onto pre-restart state and draw a finished turn as running; upstream fixed it with a per-client "baseline debt". This host puts a channel on the watch list only after `snapshotOf` returned, which is why the bug has no purchase - a sentence in the `initialize` row, so nobody ports the fix.

### Read and not taken

Kept here so the next pass does not re-read them.

- `agent-merge` changeset kind and the `agentSystemNotificationMeta` kinds around it: Agent Merge is a Copilot service, and `create-pr` here says so when asked for it. `vscode.chat.systemInitiatedLabel` is on the one system-initiated turn this host starts (`set_workspace`, above); the window draws the label only on a system-initiated request that is not hidden, and this host has none of those.
- `vscode/requestWorkspaceTrust`: a VS Code-only RPC behind `_meta['vscode.requestWorkspaceTrust']` in `initialize`, which this host does not set. Trust is the window's to grant, and a daemon serving directories it was started on has nothing to ask.
- `node/claude/`: `agentHostCapabilities.workspaceConversion: false`, `setWorkingDirectory` throws, a `PreToolUse` hook denying GitHub tools during Agent Merge turns, `activation: 'restore'` allowing a cold SDK download. This host already changes a session's directories by resuming it, which is the thing upstream declines to do.
- Claude Agent SDK: upstream pins 0.3.239; this host is on 0.3.261.

## Pass 1 - 2026-09-05

VS Code `3aa54039`, protocol `fd0471d`, during the 0.4.0 work. No list was kept; what came out of it is in `docs/sdk/AHP.md` and the commits of that week.
