---
title: The compact artifact wording and the title keys go, and deferred titles are the default, as upstream
status: todo
depends: [task-01-the-root-config-declares-the-keys-vscode-pushes.md, task-02-a-pushed-key-nobody-declares-is-refused.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/tooling.ts#L92-L103](../../../../packages/sdk/src/host/tooling.ts#L92-L103) - `compactPrompts()`, `strategies` and `strategyOf`, which read `artifactToolsCompactPrompts` and `deferredTitleGeneration` off `rootConfig`"
  - "[code://packages/sdk/src/host/tooling.ts#L111-L118](../../../../packages/sdk/src/host/tooling.ts#L111-L118) - `shapedDefinition`, which merges the compact wording before the strategy's"
  - "[code://packages/sdk/src/host/tooling.ts#L403-L407](../../../../packages/sdk/src/host/tooling.ts#L403-L407) - `instructions`, which picks the compact instruction"
  - "[code://packages/sdk/src/host/root.ts#L114-L142](../../../../packages/sdk/src/host/root.ts#L114-L142) - `ROOT_CONFIG_SCHEMA` and the comment above it, which declare both keys as a promise of behaviour"
  - "[code://packages/sdk/src/host/lifecycle.ts#L744-L747](../../../../packages/sdk/src/host/lifecycle.ts#L744-L747) - the strategy snapshot taken before `spawn`"
  - "[code://packages/sdk/src/host/actions.ts#L285-L290](../../../../packages/sdk/src/host/actions.ts#L285-L290) - the re-dispatch of every session's tools when the compact key moves"
  - "[code://packages/sdk/src/tools/artifacts.ts#L186-L200](../../../../packages/sdk/src/tools/artifacts.ts#L186-L200) - the long instruction, `COMPACT_ARTIFACT_TOOLS_INSTRUCTION` and `COMPACT_ADD_DESCRIPTION`"
  - "[code://packages/sdk/src/tools/artifacts.ts#L217-L221](../../../../packages/sdk/src/tools/artifacts.ts#L217-L221) - the ADD tool's `compact` member"
  - "[code://packages/sdk/src/types/host.ts#L412-L417](../../../../packages/sdk/src/types/host.ts#L412-L417) - `TitleStrategy`, which keeps its three values"
  - "[code://packages/sdk/src/types/host.ts#L462-L469](../../../../packages/sdk/src/types/host.ts#L462-L469) - `HostTool.compact`"
  - "[code://packages/sdk/src/validate.ts#L99-L104](../../../../packages/sdk/src/validate.ts#L99-L104) - `TOOL_OPTIONAL`, which accepts `compact` from a plugin"
  - "[code://packages/sdk/src/tools/session.ts#L515-L546](../../../../packages/sdk/src/tools/session.ts#L515-L546) - `rename_chat` and its `forSession`"
  - "[code://packages/sdk/test/host-tools.test.ts#L239-L262](../../../../packages/sdk/test/host-tools.test.ts#L239-L262) - the deferred case, which pushes `deferredTitleGeneration`, in `tools the host contributes`"
  - "[code://packages/sdk/test/host-github.test.ts#L266-L276](../../../../packages/sdk/test/host-github.test.ts#L266-L276) - the artifact cases, whose `withTools(compact)` pushes `artifactToolsCompactPrompts`, in `what a session recorded`"
  - "[code://packages/sdk/test/users-gate.test.ts#L315](../../../../packages/sdk/test/users-gate.test.ts#L315) - one of the gate tests that use `artifactToolsCompactPrompts` as the host-wide key (also :584, :651-681, :712-728)"
  - "[code://packages/sdk/test/root-config.test.ts#L129-L133](../../../../packages/sdk/test/root-config.test.ts#L129-L133) - the schema key lists"
  - "[code://packages/sdk/test/conformance.test.ts#L466-L471](../../../../packages/sdk/test/conformance.test.ts#L466-L471) - asserts both keys are declared"
  - "git://45dd7fa1f8b - VS Code `agentHost: remove compact artifact prompt experiment`: the key and setting go, `ARTIFACT_TOOLS_INSTRUCTION` is the long wording only, and the ADD tool has one definition (`src/vs/platform/agentHost/node/shared/artifactServerTools.ts`)"
  - "git://3b2b948b52d - VS Code `Make deferred title generation the default`: `activeAgentTitleGeneration` and `deferredTitleGeneration` go from `platformRootSchema` and the settings; `getAutomaticTitleGenerationStrategy` answers `'deferred'` for a new session (`node/agentHostSessionTitleController.ts#L919` at `7516b04bc94`); a restored session with no persisted strategy is `'utility'`; `rename_chat` gains `deferLoading: true` (`node/shared/sessionServerTools.ts`)"
---

## Objective

`artifactToolsCompactPrompts`, `deferredTitleGeneration` and `activeAgentTitleGeneration` are not declared and nothing reads them, the artifact tools always use the long wording, and every session runs under the deferred title strategy, as VS Code's agent host does at `7516b04bc94`.
A client older than 1.140 that still pushes any of the three has that key refused by task 02, key by key, and the rest of its push applied.

## Files

- `UPDATE: packages/sdk/src/host/root.ts:114-142` - `ROOT_CONFIG_SCHEMA` declares `defaultShell` and task 01's properties only; the comment above it no longer names the two keys.
- `UPDATE: packages/sdk/src/host/tooling.ts:92-118` - `compactPrompts()` goes; `shapedDefinition` applies only `forSession`; `strategies` goes and `strategyOf` answers `'deferred'`.
- `UPDATE: packages/sdk/src/host/tooling.ts:403-407` - `instructions` takes `one.instruction` only.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:744-747` - the snapshot and its comment go, since nothing can move the strategy.
- `UPDATE: packages/sdk/src/host/actions.ts:285-290` - the compact re-dispatch and its comment go.
- `UPDATE: packages/sdk/src/tools/artifacts.ts:189-200, 217-221` - `COMPACT_ARTIFACT_TOOLS_INSTRUCTION`, `COMPACT_ADD_DESCRIPTION` and the ADD tool's `compact` go; the long instruction and description stay as they are.
- `UPDATE: packages/sdk/src/types/host.ts:462-469` - `HostTool.compact` goes; `TitleStrategy` keeps `activeAgent`, `utility` and `deferred`, and `forSession` stays.
- `UPDATE: packages/sdk/src/validate.ts:101` - `compact` leaves `TOOL_OPTIONAL`; `checkTool` does not look at a member the table does not list, so a plugin tool still carrying `compact` registers and the member is ignored.
- `UPDATE: packages/sdk/src/tools/session.ts:515-546` - `rename_chat` gains `deferLoading: true`.
- `UPDATE: packages/sdk/test/host-tools.test.ts`, `packages/sdk/test/host-github.test.ts`, `packages/sdk/test/artifacttools.test.ts`, `packages/sdk/test/users-gate.test.ts`, `packages/sdk/test/root-config.test.ts`, `packages/sdk/test/conformance.test.ts`, `packages/sdk/test/sessiontools.test.ts`, `packages/sdk/test/plugin-validate.test.ts` - the cases below.
- `UPDATE: docs/AHP.md` - task 01's root config paragraph says ahpd acts on `defaultShell` and the daemon's keys; a sentence says the compact wording and the two title keys were removed with VS Code 1.140 and a push of them is refused; the artifact and session tool rows, where they mention either key, say the long wording and deferred titles are the only ones.

## Steps

1. Take the two keys out of `ROOT_CONFIG_SCHEMA`; `activeAgentTitleGeneration` was never declared and stays out.
2. Remove the compact path end to end: `compactPrompts()`, the merge in `shapedDefinition`, the choice in `instructions`, the re-dispatch in the `root/configChanged` handler, the `compact` member on the ADD tool, the two constants, `HostTool.compact` and its `validate.ts` entry.
3. Make `strategyOf(uri)` answer `'deferred'` for every session, and remove `strategies` and the snapshot at `lifecycle.ts:747`. A resumed or browsed session is `'deferred'` too: ahpd never recorded a strategy, so it has no legacy session to tell apart, which is why upstream's `'utility'` fallback for a session with no persisted strategy is not copied.
4. Give `rename_chat` `deferLoading: true`, as upstream does in the same commit.
5. Move the tests that used the removed keys: the users-gate tests push `telemetryLevel` (a host-wide key task 01 declares) in place of `artifactToolsCompactPrompts`; the root-config key lists drop the two keys; the conformance case checks `defaultShell` and one of task 01's keys; the host artifact cases lose the compact variant; the artifacttools compact case is deleted; the host deferred case stops pushing `deferredTitleGeneration`.

## Validation

- `packages/sdk/test/host-tools.test.ts` and `packages/sdk/test/host-github.test.ts`: a session created with nothing pushed reports `rename_chat` in `serverTools` without `automatic`, with the deferred description and `deferLoading: true`, and an explicit `rename_chat` still answers `Renamed chat to "<title>".`; the artifact instruction a session is given is the long one whatever was pushed.
- `packages/sdk/test/root-config.test.ts`: `{ artifactToolsCompactPrompts: true, telemetryLevel: 'off' }` echoes `{ telemetryLevel: 'off' }`; `{ deferredTitleGeneration: true }` and `{ activeAgentTitleGeneration: true }` are each rejected naming the key; neither key is in `config.schema.properties`.
- `packages/sdk/test/sessiontools.test.ts`: `rename_chat` has `deferLoading: true`; `forSession` still answers for all three strategies.
- `packages/sdk/test/plugin-validate.test.ts`: a tool carrying `compact: 1` registers.
- `rg -n "artifactToolsCompactPrompts|deferredTitleGeneration|activeAgentTitleGeneration|compactPrompts" packages/*/src` finds nothing.
- `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm test` pass.

## Resume
