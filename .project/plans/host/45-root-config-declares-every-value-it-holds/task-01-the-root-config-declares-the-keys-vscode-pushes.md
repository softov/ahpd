---
title: The root config declares the keys VS Code pushes
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/root.ts#L121-L142](../../../../packages/sdk/src/host/root.ts#L121-L142) - `ROOT_CONFIG_SCHEMA`, which spreads the new properties"
  - "[code://packages/sdk/test/root-config.test.ts](../../../../packages/sdk/test/root-config.test.ts) - where the schema cases go"
  - git://7516b04bc94 - VS Code, read from the clone at `/github/externals/vscode` (`git -C /github/externals/vscode show 7516b04bc94:<path>`), never from the network
---

## Objective

Root state's `config.schema.properties` holds the 43 keys below beside the host's three and the daemon's, each with the property VS Code's agent host declares for it at `7516b04bc94`.
`workspaceTrust`, one of the 43, moved to host/66 p1 task 01 and is declared there.

## Files

- `CREATE: packages/sdk/src/vscoderootconfig.ts` - `vscodeRootProperties`, one entry per key below, each with a comment naming its upstream file and line.
- `UPDATE: packages/sdk/src/host/root.ts:121-142` - `ROOT_CONFIG_SCHEMA.properties` spreads `vscodeRootProperties` before the host's own keys, so the host's own win a clash (there is none today); task 04 takes `artifactToolsCompactPrompts` and `deferredTitleGeneration` out.
- `UPDATE: packages/sdk/test/root-config.test.ts` - the schema cases.
- `UPDATE: docs/AHP.md` - one paragraph: the root config declares what VS Code pushes, ahpd acts on `defaultShell` and the daemon's keys, and the rest are declared so a client can draw them.

## Steps

1. For each key below, copy the property from the upstream line: `type`, `title`, `description`, `default`, `enum`, `enumDescriptions`, `readOnly`, `items`, `properties`, `required`. Take the English string out of each `localize(...)`. Resolve constants to literals: `TelemetryConfiguration.*` to `'all'`, `'error'`, `'crash'`, `'off'`; `ChatExternalSessionsMode.*` and `DEFAULT_EDIT_AUTO_APPROVE_PATTERNS` from `src/vs/platform/chat/common/chatSettings.ts`. The clone does not check out every folder, so read a file outside `src/vs/platform/agentHost` with `git show 7516b04bc94:<path>`.
2. Leave out anything `ConfigPropertySchema` (1.0.0) does not have; there should be nothing, since upstream builds these as `SessionConfigPropertySchema`.
3. Seed no values.

| Key | Upstream at `7516b04bc94` |
| --- | --- |
| `http.proxy`, `http.proxyKerberosServicePrincipal`, `http.noProxy` | `src/vs/platform/agentHost/common/agentHostSchema.ts#L537`, `#L542`, `#L547` |
| `disableRepoInfoTelemetry` | `agentHostSchema.ts#L809` |
| `telemetryLevel` | `agentHostSchema.ts#L815` |
| `editTelemetryEnabled` | `agentHostSchema.ts#L822` |
| `sessionSyncEnabled` | `agentHostSchema.ts#L828` |
| `codexAgentEnabled` | `agentHostSchema.ts#L840` |
| `terminalAutoApproveEnabled` | `agentHostSchema.ts#L846` |
| `globalAutoApproveEnabled` | `agentHostSchema.ts#L852` |
| `autoApprovePolicyRestricted` | `agentHostSchema.ts#L858` (no description upstream) |
| `workspaceTrust` | moved to [host/66 p1 task 01](../66-a-session-honours-the-folders-vscode-trusts-p1-the-host-declares-keeps-and-asks/task-01-workspacetrust-is-declared-as-vscode-declares-it.md), which declares it first; this task leaves it as host/66 wrote it |
| `autoReplyEnabled` | `agentHostSchema.ts#L878` |
| `systemProxyEnabled` | `agentHostSchema.ts#L884` |
| `githubMcpServerEnabled` | `agentHostSchema.ts#L890` |
| `mcpToolRoutingEnabled` | `agentHostSchema.ts#L896` |
| `mcpConnectorsEnabled` | `agentHostSchema.ts#L902` |
| `markdownPlanRichLinksEnabled` | `agentHostSchema.ts#L908` |
| `workspaceSnapshotEnabled` | `agentHostSchema.ts#L914` |
| `agentOrchestrationLimits` | `agentHostSchema.ts#L920` |
| `artifactTools` | `agentHostSchema.ts#L931` |
| `canvasesEnabled` | `agentHostSchema.ts#L937` |
| `autoAttachPullRequests` | `agentHostSchema.ts#L943` |
| `overlapProviderPreparation` | `agentHostSchema.ts#L949` |
| `migrateLegacyCopilotCliEnabled` | `agentHostSchema.ts#L955` |
| `sessionCatalogEnabled` | `agentHostSchema.ts#L961` |
| `showExternalSessions` | `agentHostSchema.ts#L967` |
| `autoArchiveMergedSessionsAfterDays` | `agentHostSchema.ts#L981` |
| `autoDeleteArchivedMergedSessionsAfterDays` | `agentHostSchema.ts#L987` |
| `copilotMultiRootEnabled`, `claudeMultiRootEnabled`, `codexMultiRootEnabled` | `agentHostSchema.ts#L993`, `#L999`, `#L1005` |
| `editAutoApprovePatterns` | `agentHostSchema.ts#L1011` |
| `terminalAutoApproveRules` | `agentHostSchema.ts#L1017` |
| `agentMerge.enabled`, `.addressReviews`, `.fixCI`, `.resolveConflicts`, `.mergePullRequest`, `.mergeMethod`, `.replyAttribution` | `src/vs/platform/agentHost/common/agentMerge.ts#L160-L197` |
| `automationsEnabled`, `automationRunTimeoutMinutes` | `src/vs/platform/agentHost/common/automationConfig.ts#L15`, `#L21` |

Not declared: `byokModelsEnabled`, `runtimePath`, `skillCharBudget` (scope `Local`, never sent to a remote host), `permissions` and the sandbox and Copilot CLI keys (not pushed by the client), `activeAgentTitleGeneration`, `artifactToolsCompactPrompts`, `deferredTitleGeneration` and `vscode.automationMigration` (no longer declared upstream; task 04 removes ahpd's two).

## Validation

- `packages/sdk/test/root-config.test.ts`, new case "declares every key VS Code pushes": the root snapshot's `config.schema.properties` has all 43 keys; `telemetryLevel` is `{ type: 'string', title: 'Telemetry Level', enum: ['all', 'error', 'crash', 'off'], default: 'all' }` as upstream; `agentMerge.mergeMethod` has upstream's enum and `default: 'auto'`; `workspaceTrust` is host/66's case.
- The same file: `config.values` is `{}` on a fresh host.
- `pnpm exec vitest run packages/sdk/test/root-config.test.ts packages/sdk/test/conformance.test.ts` passes; `pnpm exec tsc --noEmit` passes.

## Resume

- **Implemented** 2026-10-09 on `build/agents/db49ec10`; not committed. Both suites above pass, and `npx tsc -p packages/sdk --noEmit` is clean.
- `vscoderootconfig.ts` holds 42 entries, not 43. `workspaceTrust` is host/66 p1's, which this task's table says. Each entry carries a comment naming the upstream symbol and line at `7516b04bc94`. The two entries whose default is a constant of `src/vs/platform/chat/common/chatSettings.ts` name that file by URL, which is what step 1 asks for.
- The `agentHostSchema.ts` line numbers written into the comments are the checkpoint's, as this task's table gives them. They were confirmed against the clone's `51ac693b` working tree. That tree differs from the checkpoint by a 22-line block above `disableRepoInfoTelemetry`, and by the 24-line `activeAgentTitleGeneration`/`deferredTitleGeneration`/`titleGeneration` block the checkpoint does not have. Every property between them is at the offset the table's numbers imply.
- `root.ts`: `ROOT_CONFIG_SCHEMA.properties` spreads `vscodeRootProperties` first, then `defaultShell` and `workspaceTrust`. The hand-written `globalAutoApproveEnabled` that host/70 task 05 added is removed. This task's table gives that key an upstream line, and the plan's decision copies each property from the checkpoint as written. Upstream's property is therefore the one that goes out, and the host's comment about `trust.ts` reading it moved beside the module's entry. This is the move host/66 p1 made for `workspaceTrust`. It makes the parenthetical in the Files line ("the host's own win a clash (there is none today)") true again.
- The `artifactTools` description keeps upstream's two em dashes. It is a copied literal that says for a client what VS Code's own host says for the same key, not prose written for Softov.
- `root-config.test.ts`: a new case, "declares every key VS Code pushes, as VS Code declares it", lists all 43 keys. It reads `telemetryLevel`, `agentMerge.mergeMethod`, `showExternalSessions` and the resolved 20-pattern default. It builds its host with `served(false)`, so no daemon port is there and `config.values` is `{}`. The three key-list assertions now read `PUSHED_BY_VSCODE`, `HOST_OWN` and `DAEMON_OWN`, which makes task 04's removal a one-line change there. The `globalAutoApproveEnabled` case expects upstream's property.
- `docs/AHP.md`: the paragraph under the `root/*` table. The `root/configChanged` row above it still says everything pushed is kept, which task 02 makes untrue and moves.
- `docs/HOST.md` is not in this task's Files and was stale at this point. Its Root config section said the host's own schema is five keys and listed the two keys task 04 removes. Task 04 corrected it, and says so there.
