---
title: Host tools load when the instruction says so, and a customization keeps its source - implemented
date: 2026-09-20
refs:
  - code://packages/sdk/src/artifacttools.ts
  - code://packages/sdk/src/types/host.ts
  - code://packages/sdk/src/types/agent.ts
  - code://packages/sdk/src/host.ts
  - code://packages/agent-claude/src/session.ts
  - code://packages/agent-claude/src/probe.ts
  - code://test/artifacttools.test.ts
  - code://test/toolpolicy.test.ts
  - code://test/customizations.test.ts
  - code://test/toolauth.test.ts
  - code://.project/research/claude-customization-attribution.md
---

The artifact tools now carry a per-tool load policy, and the add tool the first-turn instruction names is handed to the Claude SDK eager while remove and list keep the SDK's own deferred default.
A Claude session now lists a plugin the SDK reported as its own top-level container with the plugin's real root path, name and version, and a skill, prompt or agent the SDK namespaced as `<plugin>:<name>` is listed under that plugin rather than as if the person had written it under `~/.claude`.

## What was built

- `code://packages/sdk/src/types/host.ts` - `HostTool` gains an optional `deferLoading`, a host-side hint that the published `ToolDefinition` never carries.
- `code://packages/sdk/src/types/agent.ts` - `BoundTool` gains the same field, so a backend reads it off the bound tool.
- `code://packages/sdk/src/host.ts` - `boundTools()` copies a defined `deferLoading` onto the bound tool and nothing when it is undefined; `toolDefinitions()` is untouched, so it never reaches a client.
- `code://packages/sdk/src/artifacttools.ts` - the add tool carries `deferLoading: false` and remove and list carry `true`, with the reference's rule in a comment.
- `code://packages/agent-claude/src/session.ts` - `contributed()` turns a defined `deferLoading` into `_meta: { 'anthropic/alwaysLoad': !one.deferLoading }` on the raw definition handed to `createSdkMcpServer`; `customizationsOf()` gains a fifth `plugins` argument, builds one top-level `plugin` container per reported plugin with its `path`, `name` and `version`, moves a name that begins `<plugin>:` under it with the namespace stripped from the display name, and leaves everything else in the per-kind `directory` containers; `describe()` calls `reloadPlugins()` beside `reloadSkills()`.
- `code://packages/agent-claude/src/probe.ts` - the pre-create probe reads the same plugin list, so a session and a probe agree.
- `code://.project/research/claude-customization-attribution.md` - the Answer records the live probe and what it found.

## Verified

- `test/artifacttools.test.ts` - 8 tests, including the load policy on the three tools.
- `test/toolpolicy.test.ts` - 1 test, asserting the raw `ahp` server tools carry `_meta['anthropic/alwaysLoad']` true on add, false on remove and list, and no `_meta` on a tool that defined none.
- `test/customizations.test.ts` - 6 tests, covering the plugin container, its version, the three directory containers with no plugins, an attributed skill and agent and prompt, and an unattributed entry.
- `test/toolauth.test.ts` - 4 tests, its SDK mock now answering `reloadPlugins()` and one case asserting a reported plugin reaches `session/customizationsChanged`.
- `pnpm test` green: 35 files, 625 tests.
- `pnpm typecheck` and `pnpm boundary` green.

## Departures from the plan

- The live probe found the SDK attributes a plugin's children by namespacing their names as `<plugin>:<name>`, so the plan's step 3 was taken and its fallback step 2 was not; the research file's Answer records the evidence.
- `test/host.test.ts`, `test/conformance.test.ts` and `test/wire.test.ts` SDK mocks also gained `reloadPlugins`, which the task named only for `test/toolauth.test.ts`, because every session now asks the control protocol for plugins and a mock without it would fail the handshake.
- `reloadPlugins()` is called directly rather than through a `Promise.resolve().then(...)` wrapper, because the extra microtask delayed `describe()` past the snapshot two host tests read; the direct call keeps the handshake timing the control calls already had.
- `test/fixtures/wire.jsonl` is rewritten by `test/wire.test.ts` on every run; its final content matches HEAD, so no fixture change is included.

## Left for later

- Nothing; no attributable builtin source exists in this SDK or repository, so the plan's conditional builtin container was not needed.
