---
title: The root config declares every value it holds, as VS Code's agent host declares it
domain: host
status: planned
priority: medium
created: 2026-10-03
revalidated: 2026-10-03
requires:
  - plans/host/44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md
  - plans/host/43-the-wire-is-the-protocols-p1-the-wire-test-checks-every-frame/plan.md
  - plans/host/43-the-wire-is-the-protocols-p3-the-root-config-schema-conforms/plan.md
decisions:
  - decisions/root-config-declares-what-vscode-pushes-and-refuses-the-rest.md
refs:
  - "[code://packages/sdk/src/host.ts#L6087-L6116](../../../../packages/sdk/src/host.ts#L6087-L6116) - `rootConfig`, kept for every pushed key, and `ROOT_CONFIG_SCHEMA`, three keys"
  - "[code://packages/sdk/src/host.ts#L6229-L6235](../../../../packages/sdk/src/host.ts#L6229-L6235) - `rootState`'s `config`: the host's schema with the daemon's beside it, and every value in `rootConfig`"
  - "[code://packages/sdk/src/host.ts#L9852-L9990](../../../../packages/sdk/src/host.ts#L9852-L9990) - the `root/configChanged` handler: `apply`, the daemon half through the port, the echo"
  - "[code://packages/sdk/src/host.ts#L1950-L1985](../../../../packages/sdk/src/host.ts#L1950-L1985) - `seenBy`, the per-connection echo the refusal must pass through unchanged"
  - "[code://packages/sdk/src/host.ts#L307-L345](../../../../packages/sdk/src/host.ts#L307-L345) - `dispatchNeeds`, `PER_CONNECTION` and `seesConfig`"
  - "[code://packages/sdk/test/root-config.test.ts](../../../../packages/sdk/test/root-config.test.ts) - the root config tests with a daemon port"
  - "[code://packages/sdk/test/conformance.test.ts#L486-L501](../../../../packages/sdk/test/conformance.test.ts#L486-L501) - 'takes a key back, and replaces the lot', which pushes the undeclared keys `a` and `b`"
  - "[code://UPSTREAM.md](../../../../UPSTREAM.md) - Pass 5 names the checkpoint, VS Code `7516b04bc94`, and the clone at `/github/externals/vscode`"
  - "git://7516b04bc94 - VS Code: `src/vs/platform/agentHost/common/agentHostSchema.ts#L806-L1030` (`platformRootSchema`, with `agentHostProxyConfigDefinition` at L536-L554), `common/agentMerge.ts#L159-L197`, `common/automationConfig.ts#L14-L26`"
  - "git://7516b04bc94 - VS Code: `common/agentHostConfigurationSync.ts#L170-L190` and `browser/agentHostProtocolClient.ts#L2479-L2512`, what a client pushes to a remote host, declared or not"
  - "git://7516b04bc94 - VS Code: `common/state/protocol/channels-root/reducer.ts#L28-L38` and `node/agentHostStateManager.ts#L1839-L1862`, the reference merging every pushed key; `node/agentConfigurationService.ts#L490-L540`, restoring only declared keys at start"
  - git://45dd7fa1f8b - VS Code removed `artifactToolsCompactPrompts` (2026-09-23)
  - "git://3b2b948b52d - VS Code removed `deferredTitleGeneration` and `activeAgentTitleGeneration`, deferred titles becoming the default (2026-09-25): a new session is `deferred`, a restored one with no persisted strategy `utility`, and `rename_chat` gains `deferLoading: true`"
  - "[code://packages/sdk/src/host.ts#L5906-L5918](../../../../packages/sdk/src/host.ts#L5906-L5918) - `compactPrompts()` and `strategyOf`, the two readers of the removed keys"
  - npm://@microsoft/agent-host-protocol@1.0.0 - `ConfigPropertySchema` (`src/types/common/state.ts:159-198`), with `minItems`, `maxItems` and `additionalProperties`
---

## Goal

Every value in the root config has a property in its schema.
The settings VS Code pushes into root config are declared with the property VS Code's own agent host gives them, so a client can draw each one, and a key nobody declares is refused instead of being kept and broadcast with nothing to describe it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- Live, 2026-10-03, `ahpc --wire` against Softov's daemon: root `config.schema.properties` holds `artifactToolsCompactPrompts`, `defaultShell`, `deferredTitleGeneration`; `config.values` holds about forty more keys.
- `grep "root config: " ~/.config/ahpd/daemon.log`, key names only: `activeAgentTitleGeneration`, `agentMerge.{addressReviews,enabled,fixCI,mergeMethod,mergePullRequest,replyAttribution,resolveConflicts}`, `artifactTools`, `artifactToolsCompactPrompts`, `autoApprovePolicyRestricted`, `autoArchiveMergedSessionsAfterDays`, `autoAttachPullRequests`, `autoDeleteArchivedMergedSessionsAfterDays`, `autoReplyEnabled`, `automationRunTimeoutMinutes`, `automationsEnabled`, `claudeMultiRootEnabled`, `codexAgentEnabled`, `codexMultiRootEnabled`, `copilotMultiRootEnabled`, `deferredTitleGeneration`, `disableRepoInfoTelemetry`, `editAutoApprovePatterns`, `editTelemetryEnabled`, `githubMcpServerEnabled`, `globalAutoApproveEnabled`, `http.noProxy`, `http.proxy`, `http.proxyKerberosServicePrincipal`, `markdownPlanRichLinksEnabled`, `migrateLegacyCopilotCliEnabled`, `sessionCatalogEnabled`, `sessionSyncEnabled`, `showExternalSessions`, `systemProxyEnabled`, `telemetryLevel`, `terminalAutoApproveEnabled`, `terminalAutoApproveRules`, `vscode.automationMigration`, `workspaceTrust`.
- `grep -rn "agentHost: {"` in the VS Code clone at the checkpoint - the settings mirrored to a host; those with `scope: Local` (`byokModelsEnabled`, `runtimePath`, `skillCharBudget`) are not sent to a remote host such as ahpd.
- `git grep` at `832cf23c5` and `7516b04bc94` - `activeAgentTitleGeneration`, `artifactToolsCompactPrompts`, `deferredTitleGeneration` and `vscode.automationMigration` were declared at Pass 4 and are gone at the checkpoint.
- `grep -n "rootConfig" packages/sdk/src/host.ts packages/server/src/*.ts` - `rootConfig` lives in memory only; nothing writes it to disk.

### Runtime path

```
VS Code connect -> dispatchAction root/configChanged { ~43 keys } -> applyDispatch gate (dispatchNeeds)
  -> handler: daemon keys to the port, the rest into rootConfig -> echo through seenBy
  -> rootState: config.schema (3 host keys + daemon keys) and config.values (every key kept)
```

### Gaps

- About forty values in `config.values` have no property in `config.schema`.
- Nothing refuses a key: a typo or a key from another VS Code version is kept and broadcast until restart.
- `Not found: a list of what VS Code pushes kept in ahpd - searched "telemetryLevel|agentMerge" in packages/.`

### Context, not this plan's work

The connection that signs in with the deployment token is nobody, so it holds no `config:read` and reads none of the daemon's keys while the daemon has no users directory.
That is decision `root-config-shows-daemon-keys-to-config-read-and-never-a-write-only-value` working as written; it was seen on the same live check and is said here so the two are not confused.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [The root config declares every key VS Code pushes, as the reference declares it, and refuses a key nobody declares](../../../decisions/root-config-declares-what-vscode-pushes-and-refuses-the-rest.md) | Softov, 2026-10-03, "Declare them, as upstream" |

| What | Source | Task |
| --- | --- | --- |
| The keys declared are the 43 the checkpoint's client pushes to a remote host and the checkpoint's root schemas declare, listed in task 01 | Softov, 2026-10-03, asked "what happens to the ~40 settings VS Code pushes into root config ... that ahpd stores and broadcasts but declares no schema for?": "Declare them, as upstream" | 01 |
| Each property is copied from the checkpoint as written: `type`, `title`, `description`, `default`, `enum`, `enumDescriptions`, `readOnly`, `items`, `properties`, `required`, constants resolved to their literal values | Softov, 2026-10-03, "Declare them, as upstream" | 01 |
| The properties live in their own module, which `ROOT_CONFIG_SCHEMA` spreads, each entry with the upstream file and line it came from | (defaulted: forty entries would bury the three ahpd acts on, and the next UPSTREAM.md pass diffs one file) | 01 |
| No value is seeded from a declared `default`; `values` holds what was pushed | (defaulted: ahpd acts on none of these keys, and a client draws the default from the schema) | 01 |
| `mcpServers` stays the daemon's key and `defaultShell` the host's; neither is declared twice | (defaulted: daemon/11 and the host already declare them) | 01 |
| A pushed key is refused key by key: the keys neither the host's schema nor the daemon's declares are taken out of the action before it is applied and echoed, and the rest go through | [code://packages/sdk/src/host.ts#L9852-L9990](../../../../packages/sdk/src/host.ts#L9852-L9990), and the reference treating keys one by one (`agentConfigurationService.ts#L490-L540` at `7516b04bc94`); a whole-action refusal would lose VS Code's whole connect patch over one key a newer client added | 02 |
| An action left with no declared key is rejected with a `rejectionReason` naming the keys | (defaulted: a client whose whole change was refused is told, as a refused daemon write is told today) | 02 |
| `replace: true` keeps only declared keys too | (defaulted: the same rule for both forms of the action) | 02 |
| A declared key's value is not checked against its type on the way in | (defaulted: the reference does not check at dispatch either, and refusing a value is a separate question from refusing a key) | 02 |
| Undeclared values already held need no migration: `rootConfig` is in memory, and the restart that brings this version in empties it | [code://packages/sdk/src/host.ts#L6087](../../../../packages/sdk/src/host.ts#L6087) | 02 |
| The wire test pushes the checkpoint client's connect patch and fails on any value in root `config.values` with no property in `config.schema.properties` | the request, 2026-10-03 | 03 |
| `artifactToolsCompactPrompts`, `deferredTitleGeneration` and `activeAgentTitleGeneration` are not declared and nothing reads them: the artifact tools keep only the long wording, every session runs under the deferred title strategy with no key to change it, and `rename_chat` is `deferLoading: true`; a push of any of the three from an older client is refused key by key under task 02 | Softov, 2026-10-03, asked "VS Code dropped both keys before the checkpoint: the compact-prompt experiment was removed (git://45dd7fa1f8b, 2026-09-23), and deferred titles became the default with no setting (git://3b2b948b52d, 2026-09-25). What should ahpd do?": "Follow upstream" | 04 |
| A session resumed or browsed after a restart is `deferred` too, not upstream's `utility` fallback for a session with no persisted strategy | Softov, 2026-10-03, asked "Sessions that existed before the title change: what title mode do they get?": "Deferred, like new ones" | 04 |
| Conforming each property to `ConfigPropertySchema` is host/43 p3's, which this plan does not repeat; these properties are taken from a host that already declares them as `ConfigPropertySchema` | [host/43 p3](../43-the-wire-is-the-protocols-p3-the-root-config-schema-conforms/plan.md) | 03 |

## Proposed architecture

- **Data flow** - `vscodeRootProperties` (new module) and `defaultShell` -> `ROOT_CONFIG_SCHEMA.properties` -> `rootState` `config.schema`; a pushed key is looked up in the host's properties and `daemonProperties()` before `apply`.
- **Event flow** - one `root/configChanged` echo as today, carrying only declared keys; a rejection envelope when none remain.
- **State flow** - `rootConfig` holds only declared host keys.
- **Layer responsibilities** - sdk: the properties, the refusal, the removal of the compact wording and the title keys, and the tests · server: unchanged; its daemon keys are declared by its own port.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), `packages/sdk/src/vscoderootconfig.ts` (created in task 01)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The root config declares the keys VS Code pushes](task-01-the-root-config-declares-the-keys-vscode-pushes.md) | todo | - |
| [02 - A pushed key nobody declares is refused](task-02-a-pushed-key-nobody-declares-is-refused.md) | todo | 01 |
| [03 - The wire test finds no value without a property](task-03-the-wire-test-finds-no-value-without-a-property.md) | todo | 01, 02, 04, host/43 p1 task 03 |
| [04 - The compact wording and the title keys go, and deferred titles are the default, as upstream](task-04-the-compact-wording-and-the-title-keys-go-as-upstream.md) | todo | 01, 02 |

## Risks and tradeoffs

- A declared key ahpd does not act on reads as a setting that works: `automationsEnabled` defaults to `false` and ahpd runs automations anyway. The description stays upstream's; what ahpd honours is said in `docs/AHP.md`.
- A VS Code release that adds a pushed key has it refused until the next UPSTREAM.md pass adds it; the log line names the key, so the pass finds it.
- Softov's daemon keeps the about forty values it holds until it restarts; nothing reads them, so nothing changes before then.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-root-config-declares-the-keys-vscode-pushes.md](task-01-the-root-config-declares-the-keys-vscode-pushes.md).
- **Open questions:** none.
- **Watch out for:** the conformance test 'takes a key back' pushes `a` and `b`, which this plan refuses; move it to declared keys rather than declaring test keys. `seenBy` filters the echo per connection; the refusal happens before `dispatch`, so `seenBy` is not changed.

## Final verification checklist

- [ ] Every key in task 01's table is in root `config.schema.properties` with upstream's title, type and default.
- [ ] A `root/configChanged` with `{ telemetryLevel: 'off', nonsense: 1 }` echoes `{ telemetryLevel: 'off' }`; one with `{ nonsense: 1 }` is rejected naming `nonsense`.
- [ ] Root `config.schema.properties` has no `artifactToolsCompactPrompts`, `deferredTitleGeneration` or `activeAgentTitleGeneration`, and a session created with nothing pushed offers `rename_chat` without `automatic`.
- [ ] `pnpm exec tsc --noEmit` and `pnpm test` pass.
- [ ] `plans/index.md` updated.
