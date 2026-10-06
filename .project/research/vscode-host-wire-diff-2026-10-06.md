---
title: What VS Code 1.140's own agent host puts on the wire that ahpd does not, and the reverse
date: 2026-10-06
refs:
  - file:///home/softov/.local/cache/tmp/claude-1000/-home-softov/adad4672-6999-4598-8759-0b36b45b2483/scratchpad/vscode-wire.jsonl - VS Code 1.140's window talking to its own host, captured 2026-10-05, 1132 frames; it holds GitHub tokens, so it is not copied anywhere
  - file:///home/softov/.local/cache/tmp/claude-1000/-home-softov/adad4672-6999-4598-8759-0b36b45b2483/scratchpad/wd/ahpd-wire2.jsonl - Softov's daemon at ws://127.0.0.1:37537, read-only, 2026-10-06, initialize with VS Code's params, listSessions, one session and its default chat per provider, automations and the log channel
  - git://7516b04bc94 - VS Code 1.140, the checkpoint in UPSTREAM.md Pass 5, where every VS Code path below is read
  - git://76ddfbc20d3 - VS Code main on 2026-10-06 (FETCH_HEAD), read only with `git show` for the files named in the FETCH_HEAD section
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/agentHostExtensionProtocol.ts#L24-L265 - every `vscode/*` method, its direction, its params and the initialize `_meta` flags
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/protocolServerHandler.ts#L515-L560 - `_vscodeUpgrade`, `setClientSandboxRequired` and `setClientManagedSettingsPermissions` handled before the method table
  - file:///github/externals/vscode/src/vs/sessions/contrib/providers/agentHost/browser/reconnectableAgentHostAutomationStore.ts#L70-L98 - the Sessions window calling a host without `vscode.autonomousAutomations` incompatible
  - "[code://packages/sdk/src/host/handshake.ts#L199-L262](../../packages/sdk/src/host/handshake.ts#L199-L262) - ahpd's initialize result: `serverInfo`, trigger characters, telemetry, automations and the `vscode.*` flags"
  - "[code://packages/sdk/src/host/gate.ts#L7-L94](../../packages/sdk/src/host/gate.ts#L7-L94) - every method ahpd serves, with the grant each needs"
  - "[code://packages/sdk/src/host/root.ts#L326](../../packages/sdk/src/host/root.ts#L326) - root `terminals`, sent only when one is open"
  - "[code://packages/sdk/src/host/snapshots.ts#L88-L100](../../packages/sdk/src/host/snapshots.ts#L88-L100) - the annotations channel, served though no backend offers the `addComment` tool"
  - "[code://UPSTREAM.md](../../UPSTREAM.md) - Pass 5, whose unticked boxes several rows below point at"
  - "[code://docs/AHP.md](../../docs/AHP.md) - what ahpd says it serves, method by method and action by action"
---

## Question

What does VS Code 1.140's own agent host declare or serve on the wire that ahpd does not, and what does ahpd put there that VS Code's host does not?
Each row names the plan that already covers it, so later plans pick only from what is left.

## How it was read

- VS Code: the capture above. It opens with a `reconnect` (whose result is not in the file) and then a fresh `initialize`, so the initialize result, root snapshot, three session snapshots (`copilotcli`, `codex`, an `ahp-session:` one) and one chat snapshot are all there. No `vscode/*` method crossed the wire in it, so that section is read from the source at the checkpoint.
- ahpd: a node script in the scratchpad sent `initialize` with the params VS Code sent (protocol versions, `clientInfo`, `vscode.telemetryLevel`, `vscode.clientConnectionKind`, `initialSubscriptions: ['ahp-root://']`), then only `listSessions` and `subscribe`. Nothing was created, prompted, disposed or dispatched. The token came from ahpc's config and is not written anywhere.
- Both negotiated `0.9.0`.

## initialize result

| Item | VS Code host | ahpd | Covered by | Note |
| --- | --- | --- | --- | --- |
| `protocolVersion` | `0.9.0` | `0.9.0` | [host/44 p1](../plans/host/44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md) | ahpd also speaks 1.0.0; VS Code did not offer it. |
| `serverInfo` | absent | `{ name: 'ahpd', version }` | - | ahpd only. |
| `defaultDirectory` | yes | yes | - | Same. |
| `completionTriggerCharacters` | `@`, `#`, `/` | `/`, `@` | not covered | `#` is VS Code's `#chat:<title>` reference to another chat of the session and `#` file references (`node/agentHostChatCompletionProvider.ts#L94-L106`, `node/agentHostFileCompletionProvider.ts#L111`). |
| `terminalCommandPrefix` | `!` | `!` | - | Same. |
| `telemetry` | `logs` | `logs`, `traces`, `metrics` | - | ahpd sends `otlp/exportLogs` and `otlp/exportTraces`; VS Code sent 77 `otlp/exportLogs`. |
| `automations` | `create`, `schedules`, `runCancellation`, `runHistoryLimit: 50` | `create`, `schedules` | - | ahpd leaves the two out on purpose ([`code://packages/sdk/src/host/handshake.ts#L224-L229`](../../packages/sdk/src/host/handshake.ts#L224-L229)). |
| `_meta['vscode.getAgentHostSessionStateFile.chat']` | true | true | UPSTREAM.md Pass 5 (ticked) | Same. |
| `_meta['vscode.detachedWorktrees']` | true | true | UPSTREAM.md Pass 5 (ticked) | Same. |
| `_meta['vscode.removeSessionArtifact']` | true | true | UPSTREAM.md Pass 5 (ticked) | Same. |
| `_meta['vscode.devContainers']` | true | true | [container/02](../plans/container/02-vscode-offers-our-dev-container/plan.md) | ahpd sets it only when a container can be made. |
| `_meta['vscode.autonomousAutomations']` | true | absent | not covered | Without it the Sessions window marks a host with `automations` as `incompatible` and drops its automation store (`reconnectableAgentHostAutomationStore.ts#L82-L85`), so ahpd's automations are hidden in 1.140. |
| `_meta['vscode.importSession']` | true | absent | not covered | Gates `vscode/importSession`, which adopts a provider-native session listed with `_meta['vscode.external']: true`. |
| `_meta['vscode.agentHostTiming']`, `['vscode.chatUserInteractionTiming']` | absent here (off by setting) | absent | [idea](../ideas/turn-and-model-call-diagnostics.md) only | Gate `vscode/reportAgentHostFirstResponse` and `vscode/reportChatUserInteraction`. |
| `_meta['vscode.canvases']` | absent | absent | [host/47](../plans/host/47-ahpd-serves-what-ahp-1-0-0-added/plan.md) leaves canvas out | FETCH_HEAD moves canvases into the protocol. |
| `_meta['ahpd.resourceProviders']`, `['ahpd.grants']`, `['ahpd.principal']` | absent | yes | [host/43 p4](../plans/host/43-the-wire-is-the-protocols-p4-ahpds-own-meta-keys-say-ahpd/plan.md) | ahpd only; also repeated on root `_meta`. |
| Client `_meta` read | `vscode.telemetryLevel`, connection kind, machine and device ids | ignored | - | Nothing in ahpd reads them. |

## Root state

| Item | VS Code host | ahpd | Covered by | Note |
| --- | --- | --- | --- | --- |
| `agents[].provider` | `copilotcli`, `claude`, `codex` | `claude`, `claude-openrouter`, `claude-openrouter-build`, `claude-deepseek`, `claude-deepseek-build`, `cofold`, `pi` | - | Different agents by design. |
| `agents[].capabilities` | `multipleChats { fork, sideChat }` | the same, plus `multipleWorkingDirectories { immutablePrimary, primaryReplacement }` on Claude; `cofold` and `pi` fork only | - | VS Code's own agents have multi-root behind `*MultiRootEnabled`, off. |
| `agents[].customizations` | absent | set on the Claude agents | - | A protocol field (`AgentInfo.customizations`); VS Code 1.140 carries host plugins in root config `customizations` instead. |
| `agents[].protectedResources` | `api.github.com` (required for Copilot) and `api.github.com/repos` | `api.anthropic.com`, `api.github.com/repos`, cofold's own | - | Different backends. |
| `models[].maxContextWindow`, `maxOutputTokens`, `maxPromptTokens`, `supportsVision` | on most models | absent on the live daemon | [plugin/35](../plans/plugin/35-cofold-uses-what-cofold-ships/plan.md) for cofold; pi sets the first two in source | Not on the wire for any ahpd agent in this capture; the Claude backend never sets them. |
| `models[].policyState` | `enabled` on most | absent | not covered | Copilot entitlement; nothing in ahpd maps to it. |
| `models[]._meta` pricing | `inputCost`, `cacheCost`, `cacheWriteCost`, `outputCost`, long-context costs, `priceCategory`, `category`, `modelGroupId`, `discountPercent` | absent | not covered | The model picker's price column and grouping; ahpd has prices for cofold (plugin/35) and the proxy but does not put them on the model row. |
| `models[].configSchema` | `thinkingLevel`, `contextSize`, Auto's `tier` | `thinkingLevel` on Claude's own models only | - | ahpd puts effort in session config `effortLevel` instead. |
| `activeSessions` | 0 | 9 | - | State, not shape. |
| `terminals` | the open terminals | absent | - | ahpd sends it only when a terminal is open ([`code://packages/sdk/src/host/root.ts#L326`](../../packages/sdk/src/host/root.ts#L326)). |
| `_meta.hostBuild` | `{ version, commit, date, quality }` | absent | - | VS Code reads it as "a native VS Code host" (`isNativeAgentHost`, FETCH_HEAD); ahpd should keep it absent. |
| `_meta['vscode.agentHost.resources']` | `{ platform, architecture, cpuCount, memoryBytes }` | absent | UPSTREAM.md Pass 5, unticked, no plan | `create_remote_session` filters hosts on it. |
| `_meta['vscode.remoteSessions']` | true | absent | UPSTREAM.md Pass 5, unticked, no plan | Without it the window refuses the host as a remote delegation target. |
| `_meta['vscode.agentCustomizationSettings']` | one entry for Codex: `settings` keys from root config grouped, `configurationFile` to open | absent | not covered | A per-provider settings page drawn from root config keys; a shape ahpd's plugin options could use. |

### Root config schema

VS Code's host declares 64 properties; 44 have values, plus three values with no property (`vscode.agentSdkSetup.status.claude`, `vscode.agentSdkSetup.status.codex`, `vscode.codexAccount`), which are the host's own provider state.
ahpd declares 17: `defaultShell`, `mcpServers`, `artifactToolsCompactPrompts`, `deferredTitleGeneration`, the daemon's `paths`, `port`, `host`, `http`, `updateCheck`, `advancedTools`, `wire`, and one `plugins.<path>` object per plugin.
ahpd holds 31 more values with no property, all pushed by VS Code clients, plus `activeAgentTitleGeneration`.
VS Code marks `autoApprovePolicyRestricted` and `workspaceTrust` `readOnly`, and `permissions` `sessionMutable`; ahpd marks none.

| Item | VS Code host | ahpd | Covered by | Note |
| --- | --- | --- | --- | --- |
| The 39 keys host/45 task 01 lists (`telemetryLevel`, `agentMerge.*`, `artifactTools`, `automationsEnabled`, `automationRunTimeoutMinutes`, `*MultiRootEnabled`, `terminalAutoApproveRules`, `http.proxy*`, `showExternalSessions` and the rest) | declared | value kept, no property | [host/45](../plans/host/45-root-config-declares-every-value-it-holds/plan.md) | host/45 task 01 also lists `canvasesEnabled`, `mcpToolRoutingEnabled`, `overlapProviderPreparation` and `workspaceSnapshotEnabled`, which the 1.140 host does not declare on this wire. |
| `workspaceTrust` (`readOnly`, `{ enabled, trustedUris }`) | declared, `{ enabled: true, trustedUris: [home] }` | absent | [host/45](../plans/host/45-root-config-declares-every-value-it-holds/plan.md), and a separate plan | Being planned separately: declare it, honour `trustedUris` for project hooks, settings and plugins, and send `vscode/requestWorkspaceTrust` when a chat adds a folder. |
| `mcpServers` | declared | declared by the daemon | [daemon/11](../plans/daemon/11-root-config-carries-the-daemon-and-its-plugins/plan.md) | Same key, different owner. |
| `defaultShell` | declared | declared | - | Same. |
| `permissions` (`sessionMutable`, `{ allow, deny }`) | declared at root | session config only | host/45 task 01 leaves it out | The root default the session key inherits. |
| `customizations` ("Plugins") | declared, `[]` | absent | not covered; [host/49](../plans/host/49-a-session-loads-a-clients-plugins/plan.md) is the per-session client half | Plugins configured on the host and offered to remote sessions. |
| `sandbox` | declared, `{ enabled: 'off', ... }` | absent | host/45 task 01 leaves it out | ahpd's sandbox is a Claude preset field ([`code://docs/AHP.md`](../../docs/AHP.md) "sandboxEnabled"). |
| `allowSignedOutWhenUsable`, `githubEnterpriseUri` | declared, unset | absent | not covered | Not pushed by 1.140's client. |
| Copilot SDK keys: `enableCustomTerminalTool`, `enableShellInitScript`, `copilotSdkLogLevel`, `rubberDuck`, `claudeAdvisor`, `tgrep`, `opus48Prompt`, `toolSearchEnabled`, `toolSearchDeferThreshold`, `hydraFusion`, `autoModeTierOverride`, `claudeDefaultReasoningEffort`, `modelCapabilityOverrides` | declared, unset | absent | host/45 task 01 leaves them out | Copilot runtime switches; no ahpd backend reads them. |
| `byokModelsEnabled`, `runtimePath`, `skillCharBudget` | declared | absent | host/45 task 01 leaves them out | Scope `Local`, never sent to a remote host. |
| `codex.personality`, `codex.autoReviewPolicy` | declared, provider-backed | absent | - | Codex's `config.toml`; drawn through `vscode.agentCustomizationSettings`. |
| `artifactToolsCompactPrompts`, `deferredTitleGeneration`, `activeAgentTitleGeneration` | not declared at 1.140 | first two declared, third held as a value | host/45 task 04 removes them | See the FETCH_HEAD section: main declares the two title keys again. |
| `paths`, `port`, `host`, `http`, `updateCheck`, `advancedTools`, `wire`, `plugins.*` | absent | declared | [daemon/11](../plans/daemon/11-root-config-carries-the-daemon-and-its-plugins/plan.md) | ahpd only. |

## Session state

| Item | VS Code host | ahpd | Covered by | Note |
| --- | --- | --- | --- | --- |
| State keys | `provider`, `title`, `status`, `lifecycle`, `workingDirectories`, `chats`, `defaultChat`, `config`, `customizations`, `serverTools`, `changesets`, `activeClients`, `_meta` | the same, plus `project`, `activity`, and `resource` on some backends | [host/43 p2](../plans/host/43-the-wire-is-the-protocols-p2-results-and-actions-are-the-protocols/plan.md) | `resource` is not a `SessionState` field and appears on `claude-deepseek`, `pi` and `cofold` but not `claude`. |
| `chats[]` | `resource`, `title`, `status`, `modifiedAt`, `origin`, `interactivity` | the same, plus `activity` | - | Same shape. |
| `changesets[]` | `session` kind ("Session Changes") | `session` with `capabilities.review`, and `uncommitted` | - | ahpd offers more. |
| `serverTools` comment tools: `addComment`, `listComments`, `replyToComment`, `resolveComments`, `deleteComments`, `viewUnreviewedComments` | offered | absent | not covered | The agent-feedback tools over `<session>/annotations`; ahpd serves the channel but no backend can write it ([`code://packages/sdk/src/host/snapshots.ts#L88-L100`](../../packages/sdk/src/host/snapshots.ts#L88-L100)). |
| `serverTools` session tools: `list_sessions`, `get_current_session`, `get_session_context`, `send_message`, `create_session`, `delete_session`, `rename_chat`, artifact trio | offered | offered | UPSTREAM.md Pass 4 (ticked), [host/33](../plans/host/33-a-session-tool-acts-as-the-person-it-works-for/plan.md) | Same names. |
| `customizations[].type` | `directory`, `mcpServer` | `plugin`, `directory`, `mcpServer` | - | ahpd adds the `agents-md` plugin row. |
| `_meta['vscode.external']` | false on every session | absent | not covered | Marks a provider-native session not yet adopted; pairs with `vscode/importSession`. |
| `_meta.workingDirectoryScopeIds` | one SHA-1 per folder set | absent | [host/39](../plans/host/39-what-vs-code-1140-stopped-reading/plan.md) took `githubData` only | The client reads per-folder `gitData` through it; ahpd's single-folder `_meta.git` is still read. |
| `_meta.workingDirectoryKeys` | yes | yes | host/39 | Same. |
| `_meta['vscode.promptCache']` | `{ modelId, cacheExpiresAt }` on Copilot sessions | absent | not covered | A prompt-cache expiry hint the window shows. |
| `_meta['vscode.sandboxPolicy']`, `['vscode.sandboxState']` | `{ enabled: false }` | absent | not covered | ahpd's sandbox lives in a Claude preset and is not reported per session. |
| `_meta['vscode.chatInputState']` | sent in `session/metaChanged`, `{ <chat>: { kind: 'checking' } }` | absent | not covered | Marks a chat's input read-only while the provider checks or blocks it. |
| `_meta.git`, `github`, `githubData`, `owner` | absent | yes | host/39, [host/34](../plans/host/34-work-says-who-owns-it/plan.md) | ahpd only. |

### Session config schema

| Item | VS Code host | ahpd | Covered by | Note |
| --- | --- | --- | --- | --- |
| `mode` (`sessionMutable`) | `interactive`, `plan`, `autopilot` (Copilot, `ahp-session:`); `interactive`, `plan` (Codex) | absent | [decision](../decisions/permission-modes-live-in-the-harness.md) | ahpd folds plan mode into `permissionMode`; the window's Agent Mode picker draws nothing for ahpd. |
| `autoApprove` (`sessionMutable`) | `default`, `assisted`, `autoApprove` | absent; `permissionMode` (`default`, `acceptEdits`, `plan`, `auto`, `bypassPermissions`, `dontAsk`) | [decision](../decisions/permission-modes-live-in-the-harness.md) | Both are titled "Approvals". |
| `codex.permissionsPreset` | Codex only | absent | - | Codex only. |
| `sandboxEnabled` | Copilot and `ahp-session:` | absent | UPSTREAM.md Pass 4 (ticked) | A Claude preset field instead ([`code://docs/AHP.md`](../../docs/AHP.md)). |
| `shellInitScripts` (`readOnly`, `sessionMutable`) | yes | yes on Claude | UPSTREAM.md Pass 4 (ticked) | Same. |
| `permissions` (`sessionMutable`) | yes | yes on Claude | - | Same. |
| `isolation` | `readOnly`, `folder` only | writable after the first turn, `folder` or `worktree` | [host/18](../plans/host/18-a-provisional-session-takes-any-key/plan.md) | ahpd moves a running session's folder by restarting it; `branch` is writable on a worktree session too. |
| `computer`, `branch`, `worktree*`, `effortLevel`, `projectTrust` (pi), `model`, `baseUrl`, `instructions` (cofold) | absent | yes | - | ahpd only. |

### Chat state

| Item | VS Code host | ahpd | Covered by | Note |
| --- | --- | --- | --- | --- |
| `changesets` on `ChatState` ("This Turn") | yes | absent | not covered | UPSTREAM.md Pass 5 box, which host/47 says it does not plan. |
| `draft` | yes | served when set | - | ahpd handles `chat/draftChanged`; none was set. |
| `queuedMessages`, `workingDirectories`, `activity`, `activeTurn` | absent or idle | yes | - | ahpd's chats were running. |
| `turns[].usage._meta` | `vscode.modelCall`, `turnTokenTotals`, `modelContextWindow`, `quotaSnapshots`, `copilotUsage`, `cost`, `reasoningOutputTokens`, `autoModeResolved` | `cost`, `cacheWriteTokens`, `reasoningTokens` | [idea](../ideas/turn-and-model-call-diagnostics.md) only | `vscode.modelCall` is per-call timing and tokens. |
| `turns[].message._meta` | none | `sender` | [host/38](../plans/host/38-a-client-sees-who-sent-each-turn/plan.md) | ahpd only. |
| tool call `_meta` | `toolKind`, `language` | `toolKind`, `ahpd.startedAt`, `ahpd.endedAt`, `ahpd.durationMs` | [plugin/29](../plans/plugin/29-a-tool-call-says-when-it-ran/plan.md) | One VS Code tool call in the sample. |
| `listSessions` rows | `chats`, `defaultChat` | absent; `project`, `activity` instead | [host/44 p3](../plans/host/44-ahpd-speaks-ahp-1-0-0-p3-a-sessions-row-lists-its-chats/plan.md) | Same `_meta` gaps as session state. |

## Extension methods and notifications

| Item | VS Code host | ahpd | Covered by | Note |
| --- | --- | --- | --- | --- |
| `vscode/getAgentHostSessionStateFile`, `collectAgentHostDebugLogs`, `readAgentHostDebugLogsChunk`, the five detached worktree methods, `removeSessionArtifact` | client to host | served | UPSTREAM.md Pass 5 (ticked) | Same. |
| `vscode/devContainers/isDockerAvailable`, `connect`, `disconnect`, `relaySend`; notifications `relayMessage`, `relayClose`, `closeConnection`, `output` | client to host and back | served | [container/02](../plans/container/02-vscode-offers-our-dev-container/plan.md) | Same. |
| `vscode/devContainers/stop`, `remove` | client to host | absent | [container/02 task 04](../plans/container/02-vscode-offers-our-dev-container/task-04-stop-and-remove-are-served.md) | Planned. |
| `vscode/importSession` | client to host | absent | not covered | Behind `vscode.importSession`. |
| `vscode/reportAgentHostFirstResponse`, `vscode/reportChatUserInteraction` | client to host | absent | [idea](../ideas/turn-and-model-call-diagnostics.md) only | Behind the timing flags; best-effort telemetry. |
| `vscode/requestWorkspaceTrust` | host to client | absent | being planned separately | See the root config row. |
| `vscode/requestMcpAuthentication` | host to client | absent | not covered | Asks attached clients, one at a time, to push a token through `authenticate` for an MCP server in a session nobody attends, such as an automation run; clients never prompt. |
| `vscode/canvases/v1/changed`, `vscode/canvases/v1/resolveSource` | both | absent | host/47 leaves canvas out | Gone from the extension protocol at FETCH_HEAD. |
| `getNetworkDiagnosticsInfo`, `diagnosticsFetch`, `getManagedSettingsDiagnostics`, `shutdown` | client to host | served | UPSTREAM.md Pass 5 (ticked) | VS Code called `getNetworkDiagnosticsInfo` in the capture. |
| `setClientManagedSettingsPermissions` (notification) | client to host | ignored | - | Copilot managed settings; VS Code sent `{ permissions: {} }`. |
| `setClientSandboxRequired` (notification) | client to host | ignored | - | Copilot managed sandbox policy. |
| `_vscodeUpgrade` | client to host | absent | - | A rejected-version fallback for VS Code's own builds. |
| `otlp/exportLogs` | host to client | sent | - | Same. |
| `root/sessionSummaryChanged` | host to client | sent | - | Same. |

## Action types

| Item | VS Code host | ahpd | Covered by | Note |
| --- | --- | --- | --- | --- |
| `session/metaChanged`, `session/chatUpdated`, `session/activeClientSet`, `session/customizationsChanged`, `session/customizationUpdated` | host sent | served | [`code://docs/AHP.md`](../../docs/AHP.md) | Same. |
| `changeset/contentChanged`, `changeset/statusChanged` | host sent | served | - | Same. |
| `root/terminalsChanged`, `terminal/resized`, `terminal/data`, `terminal/titleChanged` | host sent | served | - | Same. |
| `resourceWatch/changed` | host sent, 684 in the sample | served | - | Same. |
| `root/configChanged` | client sent, 8 times | served | [host/45](../plans/host/45-root-config-declares-every-value-it-holds/plan.md) | host/45 refuses an undeclared key. |
| `session/activityChanged` | not seen (VS Code's sessions were idle) | sent | - | Both serve it. |

## FETCH_HEAD, past the checkpoint

- `_meta['vscode.ahpSessionUris']` and `_meta['vscode.agentHost']` join the initialize flags (`common/meta/vscode/agentHostSessionUrisMeta.ts`); the first declares "mixed immutable session resources with a separate provider identity", which bears on [host/30](../plans/host/30-a-session-is-listed-under-its-providers-name/plan.md); the second marks a native VS Code host, which ahpd is not.
- The canvas methods leave the extension protocol, and the protocol gains a `channels-canvas` folder.
- `agentHostSchema.ts` declares `activeAgentTitleGeneration` and `deferredTitleGeneration` again, which host/45 task 04 removes; the clone is shallow and the checkpoint is not an ancestor of FETCH_HEAD, so whether main re-added them or the checkpoint's branch dropped them is unknown, and it should be checked before task 04 is built.

## Not covered by any plan

- `vscode.autonomousAutomations` in initialize `_meta`: one flag in `handshake.ts`, once it is checked that the scheduled store ([`code://packages/sdk/src/scheduled.ts`](../../packages/sdk/src/scheduled.ts)) runs a definition with no client attached and no migration handshake.
- `#` in `completionTriggerCharacters`: a `#chat:<title>` completion that attaches a `MessageChatAttachment`, and `#` file references beside `@`.
- `vscode.remoteSessions` and `vscode.agentHost.resources` on root `_meta`: two fields in `rootState`, already UPSTREAM.md Pass 5 boxes.
- Per-chat changesets (`ChatState.changesets`, `chat/changesetsChanged`): a "This Turn" changeset per chat, from the per-turn diff ahpd already computes for the session set.
- The agent-feedback comment tools: six server tools writing `<session>/annotations`, which ahpd already holds and relays.
- Model row fields: `maxContextWindow`, `maxOutputTokens` and price `_meta` (`inputCost`, `outputCost`, `cacheCost`, `priceCategory`) for Claude and pi, from the model lists and the proxy's prices.
- `vscode/requestMcpAuthentication`: a reverse request when an MCP server in an unattended session needs a token, then `authenticate` as today.
- `vscode/importSession` with `_meta['vscode.external']`: adopting a provider-native session (Claude's `~/.claude/projects`) the catalogue lists but ahpd did not start.
- Session `_meta` `vscode.promptCache`, `vscode.sandboxPolicy`, `vscode.sandboxState`, `vscode.chatInputState`: each a value the backend already knows, put on `_meta`.
- `workingDirectoryScopeIds` with per-folder `gitData` for multi-folder sessions.
- Root config `customizations` (host plugins offered to remote sessions) and root `permissions` as the default for the session key.
- `vscode.agentCustomizationSettings`: a per-provider settings page over root config keys, which could draw each plugin's options.
- `mode` (`interactive`, `plan`, `autopilot`) as its own session key, if the decision on permission modes is revisited, so VS Code's Agent Mode picker shows.

## ahpd has, VS Code does not

- `serverInfo` in the initialize result.
- `traces` and `metrics` telemetry channels, with `otlp/exportTraces`.
- `_meta['ahpd.resourceProviders']`, `['ahpd.grants']`, `['ahpd.principal']`, and the `user:`, `team:`, `project:`, `role:`, `policy:` schemes behind them.
- `multipleWorkingDirectories` agent capability, and `customizations` on the agent.
- Root config keys for the daemon (`paths`, `port`, `host`, `http`, `updateCheck`, `advancedTools`, `wire`) and one per plugin.
- Session config `computer`, `branch`, `worktree*`, `effortLevel`, `permissionMode`, `projectTrust`, and cofold's `model`, `baseUrl`, `instructions`.
- Session `project`, `activity`, an `uncommitted` changeset and a reviewable `session` changeset, and `_meta` `git`, `github`, `githubData`, `owner`.
- Chat `queuedMessages`, `workingDirectories`, `activity`.
- Server tools `ahp_resource`, `ahp_terminals`, `create_chat`, `set_workspace` (the last is VS Code's too, though its sessions did not offer it in this capture).
- Turn `message._meta.sender`, usage `cacheWriteTokens` and `reasoningTokens`, tool call timing under `ahpd.*`, and the `systemNotification` part.

## What could not be captured

- VS Code's `reconnect` result: the request is in the file, its answer is not.
- Any `vscode/*` frame from VS Code: none crossed the wire in the capture, so directions and shapes come from the source.
- VS Code's Claude agent session state: the `ahp-session:` session is the closest, and its provider is not named in the frames.
- ahpd's `terminals` root field and a chat `draft`: none existed at capture time.
