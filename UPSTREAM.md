# Keeping up with the reference host

What VS Code's agent host changed since this host was last read against it, and what each change asks of this repository. One pass per review; a box is ticked by the commit that lands the work, and the pass stays here so the next one starts from a known point rather than from a clone's `HEAD`.

How a pass is made is in [REFERENCE.md](REFERENCE.md). The short of it: `git -C /github/externals/vscode fetch --depth=200 origin main && git merge --ff-only origin/main`, then `git log <last>..HEAD -- src/vs/platform/agentHost`, reading `common/state/protocol/` first because that is the wire, then `node/claude/`, `node/protocolServerHandler.ts`, and the workbench client under `src/vs/workbench/contrib/chat/browser/agentSessions/agentHost`, which is what VS Code *sends* to a host. The `.md` files were reflowed to one-line paragraphs upstream, so read them with `--word-diff`.

## Pass 8 - 2026-11-10, VS Code 1.145.2

VS Code main `341e0fa9346` (where 1.143 left main) to the `1.145.2` tag `c4453f8ea430` (2026-11-05; `1.144.0` leaves main at `ff05b50d4ef`, `1.145.0` at `67710841ad0`, and the 1.145 branch carries 18 commits after it): 445 agentHost commits, 760 under `src/vs/sessions`, 143 in the workbench agentHost client, 1118 in the union. **The wire moved**: `.ahp-version` `5d542f9e` to `d7a5579b`. Upstream `PROTOCOL_VERSION` is still `1.1.0` and npm's `@microsoft/agent-host-protocol` is still `1.0.0`, which ahpd is on. The protocol repository is still at `cb6ba618`. The ahpd code cites VS Code main `6b68d3fe7dd` (2026-11-03) in 2,274 places: MayCXC's audit read past the 1.145 fork, so most of this range was checked against the code already. This pass re-checked every open box above against main `d558e2f06` and ticked 25 of them. `REFERENCE.md` "Last read against" moves to `c4453f8ea430`.

### Protocol 1.1.0, continued

Each item waits for a published 1.1.0 package or for local types, as per-chat config was built.

- [ ] **Chats with their own agent.** `InitializeResult.multipleChatProviders`, `CreateChatParams.provider`, and `provider` on `ChatState`, `ChatSummary` and `SessionChatSummary`; a chat whose provider differs from its session's has its own `ChatConfigState.schema`. Upstream `8c18263e1c08`. ahpd refuses `provider` in VS Code's words and does not advertise the capability (`packages/sdk/src/host/sessionmethods.ts` `createChat`).
- [ ] **`chat/moved {session, provider?, schema?}`** after a cross-session `moveChat`, on the moved chat's channel. A moved chat keeps its agent and its `config.values`. `packages/sdk/src/host/sessionmethods.ts` `moveChat`.
- **A chat's config does not inherit from its session**, in the 1.1.0 text at `d7a5579b`: the host sets a chat's initial `values` when it creates the chat, after that they change only through `chat/configChanged`, and a key missing after a `replace` takes its property's `default`. ahpd differs on purpose: a session's value reaches the chats that set none (`20e812035`, `7f7a74ffe`). Softov, 2026-11-10.
- [ ] **Reasoning timing**: `startedAt` and `duration` on a reasoning part and on `chat/reasoning`, where an empty `content` updates only the timing. Upstream `2780fc5eac21`, `f4823ef3c687`. `packages/agent-claude/src/session/stream.ts`.
- [ ] **Changeset file `nonce` and `isEditing`**, and `nonce` on a changeset operation target: a mismatch fails with `Conflict`. `packages/sdk/src/sessions/changes.ts`.
- [ ] **`ToolCallCompletedState.resultMetadata`**, the MCP `CallToolResult._meta`. Upstream keeps it for restored MCP App cards (`8078df0ea8d8`). `packages/sdk/src/host/spawn.ts`.
- [x] **`authenticate.target`** sends a token to one MCP server only. Built in `host/20261030-1608`.

### Session tools

- [ ] **`send_message` sends, replaces or cancels**: `operation: send | replace | cancel`, `delivery: queue | steer`, and `messageId` with `expectedRevision` for a pending message; `get_session_context` returns the caller's pending messages, `assistantTruncated` and `responseTurnId` for a shortened reply, pages of a reply by `responseTurnId` and `responseOffset`, and a chat's `harness`. `host/20261110-0813-the-session-tools-follow-vscode` task 01 and `host/20261111-0609-the-session-context-tells-each-call` task 01.
- [ ] **`move_session`** (`519383afb54e`, `741752a9eb8a`). The same plan, task 04.
- [ ] **A chat's move of itself waits for its turn to end.** VS Code's `move_session` calls `scheduleChatMove` and answers "This chat will be … when this turn ends" (`node/shared/sessionMoveTools.ts` at `171e90619`, L256-L264 and L423). ahpd's task 04 refuses it, because the calling chat has an active turn, so a call without `session` is always refused, although the copied description says "make it your final tool call". The `set_workspace` move already waits for `chat/turnComplete` in `packages/sdk/src/host/spawn.ts`. VS Code's `maxMovedSessions: 50` and `topLevelChatOnly` are not enforced either.
- [ ] **`isolate_session`**, on upstream before this range. `host/20261110-0813-an-agent-isolates-its-chat`.
- [ ] **`archive_chat`** (`5be653c66d6b`). No plan. `packages/sdk/src/tools/session.ts`.
- [ ] **`send_message` and session creation are limited per session, not per process** (`a339c3c55590`). `packages/sdk/src/host/limits.ts`.
- [ ] **Session tools carry `deferLoading: true`**, so a backend with tool search loads them on demand. `packages/sdk/src/tools/session.ts`.
- [ ] **A delegated `create_session` inherits the calling client's customizations and tool snapshot** when it keeps the same provider (`71b040015306`): the client that started the source turn is chosen, several untracked clients fail closed, and client-executed tools wait until the new session is attached. A cross-provider session stays isolated. `packages/sdk/src/tools/session.ts`.
- [x] **Agent Merge and comment tools.** Built in `host/20261110-0813-agent-merge-repairs-a-pull-request` (#279) and `host/20261110-0813-an-agent-reads-and-writes-comments` (#278); the merge itself is `host/20261110-0813-agent-merge-merges-a-pull-request` (#280). All three were read against VS Code main `171e90619` (2026-10-27); what Agent Merge changed after it is in *Agent Merge*.

### Agent Merge

`3db55542a238` and `72d200ac14e8` land on main right after `171e90619`, so #279 and #280 do not have them. `packages/sdk/src/host/agentmerge.ts` `classifyChecks` counts only the checks GitHub marks required, and the merge gate accepts `UNSTABLE`.

- [ ] **When the base branch requires nothing, every check counts** (`3db55542a238`). On a repository with no required checks, ahpd's gate finds nothing failed and nothing pending, so with `mergePullRequest` at `always` or `ifUnchanged` it merges over failing checks. Fix this first.
- [ ] **The jobs behind an unfinished required check count** (`3db55542a238`). The required checks come from the base branch's protection and rulesets, and from the `needs:` graph of the workflows that report them, so a failed job counts before its aggregate gate check exists. `packages/sdk/src/repo/github.ts`.
- [ ] **Unread check suites keep the checks pending** (`72d200ac14e8`). When every check counts and GitHub refuses to list the head's check suites, Agent Merge does not merge or mark ready, and still repairs the known failures. The required-contexts cache keeps the base branch's case.
- [ ] **Reruns and polling** (`3db55542a238`). A deferred rerun is kept when the gate that waits for the deferred jobs reports its failure. The watch polls sooner while a required check has not reported, and reads again which checks count after a rerun changes them.
- [ ] **Single sign-on blocks** (`3db55542a238`). The page GitHub names in `X-GitHub-SSO` on a refused request is kept. Agent Merge posts a notice that links it when SSO blocks finding or reading its pull request, with a new link once the old one expires. It also says when no pull request turns up for its branch. `packages/sdk/src/repo/github.ts` reads no SSO header.
- `autoMarkReadyIgnoredChecks` now applies to Agent Merge's ready-for-review readiness (`3db55542a238`). ahpd's Agent Merge marks no draft ready, so this waits for *Artifact integrations*.

### Artifact integrations

New, behind root key `artifactIntegrations` (`aede08ac8b1b`). A recorded pull request artifact gets status, actions and an automation: the GitHub integration reads checks and mergeability, and can mark ready or repair (`1147fc07f4ba`, `558dec624d07`, `d844c7f5589c`). The window draws pills and a details view from it.

- [ ] **The four tools** `get_artifact_status`, `run_artifact_action`, `set_artifact_automation`, `disable_artifact_automation` (`9b84104e1a56` gives the last two normal tool approval).
- [ ] **The methods** `vscode/artifactIntegrations` with its `vscode/artifactIntegrations/update` notification, and `vscode/clientArtifactIntegrations`, `.../register`, `.../update`, by which a client contributes its own.
- [ ] **Root keys `artifactIntegrations` and `githubArtifactMarkReadyIgnoredChecks`.** `packages/sdk/src/vscoderootconfig.ts`.

These overlap the Agent Merge watch built today (`packages/sdk/src/host/agentmerge.ts`): both read checks and threads of one pull request. Decide which carries the other before planning.

### Other `vscode/*` methods

ahpd serves 22 of the 42 `vscode/*` methods in `common/agentHostExtensionProtocol.ts`. Not served, besides the artifact ones above:

- [ ] **`vscode/moveSession`**, with initialize `_meta['vscode.sessionMove']` (Pass 7).
- [ ] **`vscode/setChatWorkspace`**, with `agentHostCreateChatWorkspaceMeta.ts`. Possibly `host/20261110-0813-the-session-tools-follow-vscode` task 02; check before planning.
- [ ] **`vscode/measureWorktreeDiskUsage` and `vscode/cancelWorktreeDiskUsage`**: the window's worktree cleanup now asks the host for sizes (`c993b4fb10ca`, `e188aa3a9391`).
- [ ] **`vscode/readSavedChat` and `vscode/completeSavedChatContinuation`** (Pass 7).
- [ ] **`vscode/importSession`**, turn-by-turn import of a conversation into a remote session (`e847f29361b4`, `agentHostCreateSessionImportMeta.ts`).
- [ ] **`vscode/deleteAutomation` and `vscode/acknowledgeAutomationDeletion`** (`2b9338004dc6`). `packages/sdk/src/host/automations.ts`.
- [ ] **`vscode/requestMcpAuthentication`**. `packages/sdk/src/host/tooling.ts`.
- [ ] **`vscode/devContainers/sandboxSupport`**. ahpd has the answer in `packages/sdk/src/host/sandbox.ts` but not the method.
- [ ] **`vscode/reportAgentHostFirstResponse` and `vscode/reportChatUserInteraction`**: telemetry the window sends. Answering them with nothing stops a `-32601`.
- `vscode/listAgentExtensions` and `vscode/setAgentExtensionEnabled` list the Copilot SDK's canvas extensions (`8b4875c83f9c`). They come with the Copilot SDK plugin box in Pass 7.

### Changesets

- [ ] **A Working Set changeset, `working-set`, with `accept-changes` and `discard-changes`**, for the window's Keep and Undo (`3ea41c41c1bf`, `74481a315e40`, `6b27fdc47eb5`). ahpd's operation ids are `commit`, `discard`, `stage`, `unstage`, `revert`, `prepare-pull-request`, `create-pr` and `checkout` (`packages/sdk/src/sessions/changes.ts`); upstream's are `merge`, `checkout`, `commit`, `sync`, `discard-changes` and `accept-changes`. Map the names where the act is the same.

### Root config

`platformRootSchema` adds `artifactIntegrations`, `computerUseEnabled`, `githubArtifactMarkReadyIgnoredChecks` and `terminalIgnoreDefaultAutoApproveRules`, and drops `sessionSyncEnabled` and `terminalAutoApproveRules`.

- [ ] **Drop the keys upstream no longer declares**: `sessionSyncEnabled`, `terminalAutoApproveRules`, `sessionCatalogEnabled` and `claudeMultiRootEnabled` are still in `packages/sdk/src/vscoderootconfig.ts`. A pushed value is still kept, as any key is.
- [ ] **Declare `terminalIgnoreDefaultAutoApproveRules`**: when on, the default terminal rules stop applying and explicit permissions stay. `packages/sdk/src/vscoderootconfig.ts`, `packages/sdk/src/access/commandautoapprover.ts`.
- [ ] **Title generation keys.** 1.145.2 declares `titleGeneration` (`utility`, `activeAgent`, `agentReview`, or `deferred`) and still declares `activeAgentTitleGeneration` and `deferredTitleGeneration` as legacy keys. `packages/sdk/test/root-config.test.ts` says VS Code 1.140 dropped the last two, which is not true at 1.145.2 or at `6b68d3fe7dd`. No fix for now (Softov, 2026-11-10); the facts are in [the brief](.project/briefs/the-root-config-declares-title-generation.md).
- Not declared, and Copilot's or the window's: `byokModelsEnabled`, `byokUtilityModelDefault`, `utilitySmallModel`, `computerUseEnabled`, `mcpSamplingAllowedServers`, `prewarmSessions`, `ahpJsonlLoggingEnabled`. The session schema is unchanged.

### The window

- [ ] **Canvases show for a remote host** (`e24589266f28`, `e72c4765ae7d`). Pass 7 said the window drew canvases only for the local `copilotcli` provider; a 1.145 window can draw the canvases `host/116` serves. Check it in a 1.145 window.
- [ ] **Move Chats is on by default in Insiders** (`9bab865080f1`), with drag and drop in the session list (`442794f9c716`). The window refuses to move a chat that has sent no message (`13832cc44877`) or whose folder is missing (`395c3350086b`). Check `moveChat` against a 1.145 window.
- Window-only: editor windows connect to remote hosts named in workspace settings (`ed3d9c11647c`), sessions open in an editor (`f2389a3eabc7`), the Remotes view and its errors, and editor comment cards.

### Approvals

- [x] **Scoped grants and host-level Always Allow** (`ae873278f7e5`, and `d2dc0c25662a` on the 1.145 branch): a Claude Code style rule per grant, protected writes asked before broad grants, and host grants kept across sessions and restarts. Built in `packages/sdk/src/host/permissions.ts` (`7e16a8a05`).

### Claude

- [ ] **Claude Agent SDK 0.3.304.** Upstream pins it exactly (`3fa345dbdaf8`); ahpd asks for `^0.3.301` (`packages/agent-claude/package.json`). Read the SDK changelog from 0.3.301 to 0.3.304.
- Upstream's Claude agent moved its client tools and prompt queue onto its callback rule (`1b3420fbbb83`, `ae2b7b27e4c0`, `3b216a5d6126`) and updates client tools without restarting a session (`7d57b0daeff1`). Compare the last one with how `packages/agent-claude/src/session/servers.ts` takes a changed client tool list.

### Copilot only

Kerberos and client proxy forwarding, client certificates, Computer Use, Copilot Fusion and HydraFusion, Mission Control, the Codex SDK at 0.163.0, the Copilot SDK at `1.0.27-unstable`, legacy Copilot CLI migration, cloud sandboxes and the TCP auth gate are the Copilot runtime's or the window's. They come with the Copilot SDK plugin box in Pass 7, or not at all.

### Not checked this pass

These open boxes above need a closer read than a search: named and prompted forks (Pass 7), peer chats restored after a refresh, the commit action's scope and a nested session's default Session Changes (Pass 6), and per-chat changesets (Pass 5).

## Pass 7 - 2026-10-22, VS Code 1.143.1

VS Code `7baac39ec3c` (the `1.141.1` tag) to the `1.143.1` tag `e646868227c` (2026-10-22; `1.142.0` is `d956e8a6ac5`, `1.143.0` is `2d0b7506a36`): 483 agentHost commits, 356 under `src/vs/sessions`, 146 in the workbench agentHost client, 777 in the union. The release branch leaves main at `341e0fa9346` and carries 35 commits after it. This pass covers 1.142 and 1.143. **The wire moved**: `.ahp-version` `6eec1b91` to `5d542f9e` (AHP PR #512), and upstream `PROTOCOL_VERSION` is `1.1.0`, which is not published; npm's `@microsoft/agent-host-protocol` is still `1.0.0`. A 1.143 window offers `1.0.0`, `0.10.0` and `0.9.0` (`common/agentHostProtocolCompatibility.ts`, `51ec2ee42fd`), so it agrees on `1.0.0` with ahpd. `REFERENCE.md` "Last read against" moves to `e646868227c`.

### Protocol 1.1.0

- [x] **Per-chat config.** `ChatState.config`, the `chat/configChanged` action with its `replace` flag, and `chatMutable` on a session config property. Upstream marks `permissions`, `sandboxEnabled`, `autoApprove` and `mode` chat-mutable (`common/agentHostSchema.ts`). AHP `dbbd1217`, upstream `e941aa12741`. Waits for the published 1.1.0 package. `packages/sdk/src/host/actions.ts`, `packages/sdk/src/host/chatactions.ts`. Built on the 1.0.0 package with local shapes: a property says `chatMutable`, a client's `chat/configChanged` sets that chat's own values, and a session's value reaches the chats that set none (`7f7a74ffe`, `20e812035`). That last half is Softov's choice, see Pass 8.
- [ ] **Steering and queued messages share `queuedMessages`**, told apart by `PendingMessage.kind`; `steeringMessage` still mirrors the latest steering for older clients. Upstream `0b4e0632b1f` (`common/agentSessionMessage.ts` `getPendingSteeringMessages`). ahpd holds one steering slot and hands it to `session.steer` (`packages/sdk/src/host/chatactions.ts`). A 1.143 window reads both shapes.
- [ ] **`SessionModelInfo.vendor`**, optional. `packages/sdk/src/host/catalogue.ts`.
- Windowed delivery (`subscribe.flowControl`, `channel/frame`, `channel/credit`, `channel/snapshot`) and the TCP channel (`createTcpConnection`, `tcp/*`) are experimental, and the window uses neither.

### Background shells

The wire is the 1.0.0 one: `ChatState.backgroundWork`, `chat/backgroundWorkSet` and `chat/backgroundWorkRemoved`, with `BackgroundShellWork.terminal` naming a terminal channel. The window draws a shell row the same for every provider (`workbench/.../agentHost/agentHostBackgroundShells.ts`): its output comes from a subscription to `terminal`, and Stop shows only when the row carries `_meta['vscode.stopBackgroundWork']: true`.

- [x] **A shell row carries its terminal, and the terminal holds the output.** ahpd sends shell work as `shell:<task_id>` with no `terminal` (`packages/agent-claude/src/session/workers.ts` `reconcileWork`), so the window shows no output. Upstream reads a detached shell's output into an output-only terminal and marks it exited (`8cfec5873bc`, fixes `3f07e1aba32`, `4ea6157f821`, `13636b81c06`). Covers Pass 6's box for `57b4202903e`. Done: a shell task gets an output terminal on first sight and the row names it (`packages/agent-claude/src/session/workers.ts` `outputs`, `packages/sdk/src/host/background.ts`).
- [x] **`vscode/stopBackgroundWork {chat, id}` stops one row, answering `{stopped}`**, and a row it can stop carries the `_meta` flag. Upstream `6eb5f37d1c0`, `18ab3d9ce44` (`common/agentHostExtensionProtocol.ts`, `node/protocolServerHandler.ts` `_handleStopBackgroundWorkRequest`, `IAgent.stopBackgroundWork`). `packages/sdk/src/host/vscodemethods.ts`; the Claude backend stops a task with `Query.stopTask`, as `workers.ts` `stopWorker` does. Done: `packages/sdk/src/host/vscodemethods.ts`, `packages/sdk/src/host/background.ts`, gated as `chat:cancel` in `packages/sdk/src/host/gate.ts`.

### Large chats

The 1.143 speed-up is the window's: history is restored in 25 ms slices (`remoteChatSessionRestorer.ts`, `08b811e3ab0`, `5bed87aa911`). The window sends no `view` and no `flowControl`. Upstream's host stops loading peer chat history before a prompt (`c02f008cd15`) and skips republishing an unchanged server tool catalogue (`5ea3f3805a9`).

- [x] **A chat subscription that names no `view` gets every retained turn.** `SubscribeView` says a host MUST return all retained turns when `view` is left out. ahpd cuts a chat snapshot to the newest `PAGE` (50) turns whatever the subscribe says (`packages/sdk/src/host/snapshots.ts`, `packages/agent-claude/src/session.ts` `tail(ctx.turns)`, `packages/sdk/src/sessions/paging.ts`). Now every chat snapshot takes its turns through `windowOf`, so no view gives them all and a `view.turns` gives a window and a cursor (`packages/sdk/src/host/snapshots.ts`, `packages/sdk/src/host/sessionmethods.ts`). Built in `host/114` tasks 02 and 03; the window check in task 05 is still owed.
- [x] **A `customizationsChanged` is sent only when the customizations changed**: each one cost the window 3 to 6 seconds to apply. `packages/sdk/src/host/tooling.ts`. Done: `packages/sdk/src/host.ts` drops a backend's unchanged list and `packages/sdk/src/host/tooling.ts` `publishSessionCustomizations` drops an unchanged one of its own.

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

- [ ] **New `vscode/*` methods**: `moveSession` (initialize `_meta['vscode.sessionMove']`, session `_meta['vscode.movable']`, `389f0a7be92`), `readSavedChat` and `completeSavedChatContinuation`, `measureWorktreeDiskUsage` and `cancelWorktreeDiskUsage` for the worktree cleanup, and `cancelAgentHostDebugLogs`. `packages/sdk/src/host/vscodemethods.ts`. `cancelAgentHostDebugLogs` is served (`packages/sdk/src/host/gate.ts`). `moveSession`, `readSavedChat`, `completeSavedChatContinuation`, `measureWorktreeDiskUsage` and `cancelWorktreeDiskUsage` are still not served; Pass 8 carries them.
- [x] **Opaque chat URIs**, offered with initialize `_meta['vscode.ahpChatUris']` (`50559e744a1`). ahpd offers only `vscode.ahpSessionUris`. `packages/sdk/src/host/handshake.ts`. Done: the handshake declares `vscode.ahpChatUris` and a new default chat is minted as VS Code mints one (`packages/sdk/src/host/handshake.ts`, `1ac3a7806`).
- [x] **New sessions use the protocol's `ahp-session:` scheme** (`bd64649be19`, 2026-10-05). The provider is on `SessionSummary.provider`, not in the URI, and a session made before this keeps its `<provider>:/<id>` name. `packages/sdk/src/host/sessionmethods.ts`, `packages/sdk/src/host/catalogue.ts`, `packages/sdk/src/host/spawn.ts`, `packages/sdk/src/sessions/sessions.ts`, `packages/sdk/src/sessions/nested.ts`, `packages/sdk/src/plugins/plugins.ts`. Built in `host/126` tasks 01 to 05.
- [ ] **Named and prompted forks** (`80aa091c84c`). `packages/sdk/src/host/chatactions.ts`.
- [ ] **Multi-root is on by default** (`1044782bfd8`), which makes Pass 5's multi-folder `create_session` boxes matter more.
- [ ] **Root key `sessionCatalogEnabled` is removed** (`85e195f2594`). `packages/sdk/src/vscoderootconfig.ts`. Still declared at `packages/sdk/src/vscoderootconfig.ts`; Pass 8 carries it with the other stale keys.
- MCP sampling (`ec010535075`), title review settings (`58afa23a1cb`), on-device models, the sandbox CA trust `_meta` and the per-session sandbox toggle are Copilot's or the window's.

## Pass 6 - 2026-10-14, VS Code 1.141.1

VS Code `7516b04bc94` (2026-10-02) to the `1.141.1` tag `7baac39ec3c` (2026-10-12; `1.141.0` is `2a59476c9bf`): 72 agentHost commits, 64 under `src/vs/sessions`, 22 in the workbench agentHost client, 118 in the union. The release branch leaves main at `ae1080a9ed1` and carries 44 commits after it. **The wire moved**: `.ahp-version` `9f940395` to `6eec1b91` (protocol `01292d03` and `6eec1b91`, both in the published `@microsoft/agent-host-protocol@1.0.0`; the protocol repository is at `cb6ba618`). Upstream `35787c9cb26` sets `PROTOCOL_VERSION` to `0.10.0` and registers `chat/isReadChanged` and the canvas actions as `0.10.0`, while the published 1.0.0 package registers `chat/isReadChanged` as `0.9.0` and offers only `1.0.0` and `0.9.0`. Most 1.141 release-note features landed inside Pass 5's range; this pass covers what reached the host after it and checks each feature against ahpd. `REFERENCE.md` "Last read against" moves to `7baac39ec3c`.

### Read state and nested sessions

A 1.141 window shows unread and modified time per chat in the session tree and offers Mark as Read and Mark as Unread on a chat and on a session. The window decides per host whether read state is per chat: a host that answers below `0.10.0` is treated as legacy, and the window keeps one read bit for the session.

- [x] **Accept `0.10.0` in the handshake as an alias of the 1.0.0 contract.** A 1.141.1 window offers `0.10.0`; `negotiateProtocolVersion` in the 1.0.0 package does not know it, so ahpd answers `0.9.0` and the window drops to the legacy read path (upstream `0c9eb8e027b`, `baseAgentHostSessionsProvider.ts`). Upstream main maps `0.10.0` to the 1.0.0 contract in `agentHostProtocolCompatibility.ts` (`51ec2ee42fd`, not in 1.141.1). Upstream also adds `0.10.0` to the version list in the `-32005` refusal. The 1.0.0 package registers the canvas actions at `0.10.0`, so a version check does not keep them off the wire; ahpd sends none today. Upstream `35787c9cb26`, `0c9eb8e027b`, `51ec2ee42fd`. `packages/sdk/src/host/handshake.ts`. Done: `packages/sdk/src/host/handshake.ts` `LEGACY_COMPATIBLE_VERSION`.
- [x] **`chat/isReadChanged` changes only the addressed chat, and the host projects chat status into `SessionChatSummary.status` and publishes the catalog.** `packages/sdk/src/host/chatactions.ts` stores the chat flags, dispatches on the chat, sends `session/chatUpdated` with the status and calls `summaryMoved`; `packages/sdk/src/host/catalogue.ts` `chatSummary` ORs the chat flags into `status`. Built in `host/44` p3 task 02.
- [x] **`ChatSummary.modifiedAt` per chat**, which the tree sorts and shows. `packages/sdk/src/host/catalogue.ts` `chatSummary` (`chat.modifiedAt()`), re-sent by `packages/sdk/src/host/spawn.ts` when a chat's title, status or activity changes.
- [x] **`SessionChatSummary.status` replaces the deprecated `archived`.** `packages/sdk/src/host/catalogue.ts` `compactChats` carries `status`.
- [x] **A chat whose turn ends is marked unread.** Upstream sets the read bit off on the chat at turn end and when a subagent chat finishes (`node/chatContributions/markUnread/markUnreadContribution.ts`, `0817aaa8245`). Nothing in ahpd clears `IsRead` at turn end, so a finished chat never shows as new. `packages/sdk/src/host/spawn.ts` turn end, through the chat flag path in `packages/sdk/src/host/chatactions.ts`. Done: `packages/sdk/src/host/spawn.ts` clears `IsRead` at turn end, as `markUnreadContribution.ts` does.
- [x] **Session and chat read state stay in step.** The session is read only when all its chats are read. Marking the session read marks its chat read when it has one counted chat; with more than one unread, upstream turns the action back to unread, and the 1.141 window marks each chat read first (`agentHostStateManager.ts`, `43ac7a4a236`; `chatRead/chatReadContribution.ts`). Upstream starts a new chat as read; ahpd starts it unread. In ahpd `sessionFlag()` and the chat bit handler in `packages/sdk/src/host/chatactions.ts` change one level only. Built in `host/89` and `host/20261102-1050`.
- [x] **Archiving a chat marks it read** (`chatArchive/chatArchiveContribution.ts`). `packages/sdk/src/host/chatactions.ts`. Done: the archive says the read action with it (`1ba443ecc`).

### Worktree cleanup

The storage suggestion, its thresholds (5 GB or 20 worktrees) and the setting `chat.agentSessions.sessionStorageCleanupSuggestion.enabled` are window-only (`sessionWorktreeCleanupService.ts`, `a58d8774308`, `116e03d9526`, `2eb200531dd`). The cleanup itself is `archiveSession`, so the work falls on the host's archive path.

- [x] **Archiving a session removes its clean worktree, and unarchiving recreates it on the same branch.** Upstream does it in the `SessionIsArchivedChanged` side effect (`node/agentSideEffects.ts`), and first commits uncommitted changes with "Saving uncommitted changes before archiving session" (`c289a58900a`). The worktree record is in memory only (`lifecycle.ts` `worktrees`), and deleting a sleeping session skips `teardown`, so an archived session's worktree is never removed today. ahpd removes a worktree only on delete, and only when it is clean (`packages/sdk/src/host/lifecycle.ts` teardown); archive only queues `ctx.sleep` (`packages/sdk/src/host/chatactions.ts` `sessionFlag`). `packages/sdk/src/repo/worktrees.ts` for the recreate. Done: `packages/sdk/src/host/lifecycle.ts` `requestSessionWorktreeRemoval` and `restoreSessionWorktree`.
- [x] **Act on `autoArchiveMergedSessionsAfterDays` and `autoDeleteArchivedMergedSessionsAfterDays`.** Upstream `b5db36cf258` (2026-09-09, inside Pass 5's range). Both are declared (`packages/sdk/src/vscoderootconfig.ts`) and nothing reads them. Depends on the box above for the disk to be freed. Done: `packages/sdk/src/host/sessionlifecycle.ts`, with `canAutomaticallyDeleteArchivedSession` in `packages/sdk/src/host/lifecycle.ts`.
- [x] **`resourceResolve` honors `followSymlinks`**, which the disk usage scan sets to `false` (`worktreeDiskUsage.ts`). `packages/sdk/src/host/resourcemethods.ts` `resourceResolve`.
- [x] **Detached worktrees are removed on archive.** `vscode/setAgentHostDetachedWorktreeArchived`, `packages/sdk/src/host/vscodemethods.ts`.

### Cross-platform sandboxing

The sandbox in 1.141 is the Copilot SDK's and the terminal tool engine's; the upstream Claude agent does not sandbox. The root config gains a `sandbox` object (`enabled`, network and path rules; `common/sandboxConfigSchema.ts`), and the session key `sandboxEnabled` stays an enum in `common/agentHostSchema.ts`. The MSRC fixes to the MCP sandbox in this range are Copilot-only.

- [x] **`sandboxEnabled` is replaced by the `sandbox` preset declaration in the Claude backend**, which maps `default`/`on`/`off` to the SDK `settings.sandbox.enabled`, and a stored `sandboxEnabled: 'on'` still applies. `packages/agent-claude/src/options.ts` (`storedSandbox`), `docs/sdk/AHP.md` (the Claude backend does not declare `sandboxEnabled`), decisions `a-stored-sandbox-on-survives-the-preset.md` and `a-preset-sandbox-off-wins-over-a-stored-on.md`.
- [x] **Declare the root `sandbox` object.** A 1.141 window pushes it in `root/configChanged`; `packages/sdk/src/host/actions.ts` logs it as refused because `packages/sdk/src/vscoderootconfig.ts` does not declare it. Declaring it stops the noise. Mapping `enabled`, network and paths onto the Claude SDK `settings.sandbox` when the preset says `default` is Softov's call. `packages/sdk/src/vscoderootconfig.ts`, `packages/agent-claude/src/options.ts`. Done: the computer plugin declares it and a chat's sandbox is resolved from it as VS Code's `getSessionSandboxConfig` (`66e427f11`).

### Session grid

Window-only: the two-dimensional session grid with nested splits and persisted geometry is in `src/vs/sessions/browser/parts/` (`cc8e72aa53b`, `86c80ce2ef4`) and sends nothing new to the host. ahpw already lays out its main area as tabs, tab groups, split, spatial, stack or single through scena (`/github/ahpw/src/view/layouts.ts`, `LayoutSelect.tsx`).

### Continuing external Copilot and Codex sessions

Not possible here, as Pass 4 found: discovery and adoption read the Copilot CLI and Codex stores through their SDKs. `showExternalSessions` is declared (`packages/sdk/src/vscoderootconfig.ts`). The writer-lock chat input state `_meta` (`c17dab99841`), which disables the input while another process holds the session, is reusable if ahpd adopts Claude CLI sessions that may still be running elsewhere.

### Other host changes

- [x] **Session config `sensitiveEditLocations`**: edits under the listed globs always ask, even with auto-approve on. Upstream `06687ce3dfd`, `fffc9bc6481` (`common/agentHostSchema.ts`, `node/shared/sessionPermissions.ts` `_matchesSensitiveEditLocations`). The host's own key on every session (`packages/sdk/src/host/common.ts` `HOSTS_TAKEN`), taken by `packages/sdk/src/host/chatactions.ts`, and read by the redirect check in `packages/sdk/src/access/commandautoapprover.ts` `writeAllowed`. Built in `host/20261102-1747` task 05.
- [ ] **Root config keys `activeAgentTitleGeneration` and `deferredTitleGeneration`.** Undeclared today, so they are logged as refused. `packages/sdk/src/vscoderootconfig.ts`. Still undeclared, on purpose: `packages/sdk/test/root-config.test.ts` says VS Code 1.140 dropped them. That is wrong at 1.145.2, see Pass 8.
- [ ] **`send_message` takes the mode and model controls of the target chat.** Upstream `d3ef8534b9a` (`node/shared/sessionServerTools.ts`). `packages/sdk/src/tools/session.ts`. Overtaken by the 1.145 `send_message` (`operation`, `delivery`), which `host/20261110-0813-the-session-tools-follow-vscode` task 01 builds.
- [x] **A subagent's failed and cancelled outcomes are reported as such** rather than as a completed result. Upstream `3f4647a7f9c`. `packages/sdk/src/host/spawn.ts`. Done: `packages/sdk/src/host/spawn.ts` ends a worker chat with `chat/turnCancelled` or a `subagentFailed` error.
- [x] **A cancelled subscription is told apart from a missing resource.** Upstream `539b7502df7`. `packages/sdk/src/host/relay.ts`. Done: `packages/sdk/src/host/sessionmethods.ts` answers `Subscription cancelled`.
- [ ] **Peer chats are restored after a refresh.** Upstream `2cab7c729da`. `packages/sdk/src/host/catalogue.ts`.
- [x] **Background shell output is kept and readable after the turn.** Upstream `57b4202903e`. `packages/agent-claude/src/session.ts`. Done: the output terminal outlives its row (`packages/agent-claude/src/session/workers.ts` `outputs`).
- [x] **Read-only config values survive a config push.** Upstream `b9573ffde95`. `packages/sdk/src/host/actions.ts`. Done: a push that changes a read-only property is refused (`packages/sdk/src/host/actions.ts`).
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
- [ ] **`create_session` `independent` without a `workspace` is a session with no folder.** Upstream `d0f50833ebf`. `packages/sdk/src/tools/session.ts` requires `workspace`. Still required. `host/20261110-0813-the-session-tools-follow-vscode` task 03 covers the no-git half only.
- [x] **GitHub and git state are published per folder, and `_meta.github` on a live summary is no longer read.** The client reads `githubData` through `workingDirectoryKeys`, and `gitData` through `workingDirectoryScopeIds` (a scope id is the SHA-1 of the sorted folder keys); `_meta.git` is still read for the session folder. Upstream `18d64b8c226`, `a41ff3b2808`, `97182611fa2` (`common/state/sessionState.ts`, `sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts`). This undoes Pass 3's `_meta.github` box: the pull request pill falls back to recorded artifacts. `packages/sdk/src/host.ts` `metaOf`. Built in `host/39`.
- [ ] **Changesets and change summaries are per chat**: `ChatState.changesets`, `chat/changesetsChanged`, `changes` on `ChatState` and `SessionChatSummary`. Upstream `a8c1541df5a`, `5470377e71f`, `d17cacb01b3`; protocol `ba231a0`, `c02ad7e`. `packages/sdk/src/sessions/changes.ts`, `host.ts`; needs the next protocol package or local types.
- [x] **`_meta.multiRoot` `{ workspaceFile }` from `createSession` config is echoed on the summary.** `host.ts` createSession. Done: kept in the session record and put back on the summary (`packages/sdk/src/sessions/sessions.ts` `multiRoot`).

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

- [x] **Root config `agentOrchestrationLimits: 'on' | 'off'`**, default `on`, switches the spawn depth and count limits off. Upstream `bbf8dd79218` (`common/agentHostSchema.ts`). host/33 tasks 02 and 03 should use this name. `packages/sdk/src/tools/session.ts`, `host.ts`. Done: `packages/server/src/rootconfig.ts`.

### The wire, beside the features

`@microsoft/agent-host-protocol@1.0.0` ships every item below; each line says where it is planned.

- [x] `moveChat` with `MoveChatParams`, `session/chatsReordered`, `chat/movableChanged` (protocol `2265e2e`, upstream `14b9d22f9a9`). Planned in `host/47` p1; VS Code itself answers `MethodNotFound`.
- [x] `ChatState.backgroundWork`, `chat/backgroundWorkSet|Removed` (protocol #482, upstream `c4db793967f`). Planned in `host/47` p2.
- [x] `chat/isArchivedChanged`, `SessionChatSummary.archived` (protocol `458cc41`, upstream `0af7cd09bb5`). Planned in `host/44` p3.
- [x] `session/mcpServerBackgroundRequested` (protocol `edef8d8`). Planned in `host/47` p3, with `McpServerStartingState.blocking`.
- [x] `ConfigPropertySchema.minItems/maxItems`; `FileEditSide`/`FileEditCollection` (types only). `minItems`/`maxItems` planned in `host/43` p3 and `host/45`; the file edit types in `host/47` p4.
- [x] `AutomationCapabilities.customizations`, `AutomationSessionTemplate.customizations` (protocol `9f94039`). Planned in `host/47` p5.
- [x] `ChangesetStatus.recomputing` and `McpServerStartingState.blocking` (1.0.0). `recomputing` planned in `host/47` p6, `blocking` in `host/47` p3.
- [x] `chat/canvasesChanged`, `canvas/stateChanged` and the experimental `ahp-canvas:` channel, registered as `0.10.0`: if taken, sent only where `isActionKnownToVersion` says the connection's version knows them, which a 1.0.0 connection does and a 0.9.0 one does not. Left out for now: Softov, 2026-10-03, "Leave out for now". Taken in `host/116` (Pass 7).

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
- [x] **The terminal auto-approval rule engine.** An idea: [`terminal-commands-approved-by-rule`](.project/ideas/terminal-commands-approved-by-rule.md), with the two questions a plan has to settle first. Built in `host/100` p1 to p6 and `host/101`.
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
