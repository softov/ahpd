---
title: A client plugin lists its parts
status: done
depends: [task-01-a-copied-plugins-parts-are-read.md]
layer: sdk
refs:
  - npm://@microsoft/agent-host-protocol@1.0.0 - `ContainerCustomizationBase.children`; `ChildCustomizationBase.enabled`; `McpServerCustomization.enablement`
---

## Objective

Once host/49 loads a client plugin, its entry in the session's customizations carries `children` from task 01, with each server's enablement from `childEnablement`.

## Files

- `UPDATE: packages/sdk/src/host/tooling.ts` - `entryOf` adds `children` to a loaded client plugin.
- `UPDATE: packages/sdk/test/client-plugins-session.test.ts` - a loaded plugin lists its parts, and a loading one has no `children`.

## Steps

1. Call `partsOf` on the plugin's copied folder when its load ends.
2. Leave `children` absent while the plugin loads.
3. Set an MCP server's `enablement` from `childEnablement`, keyed by the server's name.

## Validation

- `client-plugins-session.test.ts` covers a loaded plugin's parts and a server switched off in `childEnablement`.
- The gates pass.

## Resume

- **Status:** done.
- **Done:** [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) reads a copy's parts once, when the copy settles. `entryOf` publishes them as `children`, and only once they were read. A plugin still being copied carries no such field, and neither does one in a format this host does not read. The absent field is what the protocol reads as a container nobody has parsed.
- **Enablement:** `partsWith` lays `childEnablement` over the parts, keyed by a part's name. Only an MCP server takes a decision: a skill, an agent, a rule and a hook load with the plugin they arrived in. The decisions are sorted Session before Workspace before Global, which is the order the protocol asks a producer for. A server the client said nothing about keeps no `enablement` at all.
- **Files:** the test file is [`code://packages/sdk/test/client-plugins-session.test.ts`](../../../../packages/sdk/test/client-plugins-session.test.ts), not the `clientplugins.test.ts` the task named. That name is of a file this repository does not have. The harness this task needs is already there: a session, a client handing over a tree of files, and a watcher reading what was published. Softov settled the correction on 2026-10-09.
- **Tests:** three cases were added to that file. One covers a plugin holding an agent and two servers, each part named by the file this host read it from in its own copy. One covers a plugin in a format this host does not read, which loads and publishes no `children`. One covers a client's `childEnablement` arriving as a server's `enablement`, most specific first. The file's nine cases pass.
- **Gates:** pass. `pnpm install`, `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck` and `pnpm boundary` are clean, and the full `vitest` run reports 264 files and 4630 tests passed.
