---
title: A kind with no icons sends its plugin's icons
status: done
depends:
  - task-01-the-agent-kinds-channel.md
layer: "sdk, server, docs"
refs:
  - "[code://packages/sdk/src/agents/kinds.ts#L52-L62](../../../../packages/sdk/src/agents/kinds.ts#L52-L62) - `rowOf`, which sends only the kind's own icons"
  - "[code://packages/server/src/commands/run.ts#L789](../../../../packages/server/src/commands/run.ts#L789) - where the daemon makes the kinds channel"
  - "[code://packages/sdk/src/types/plugin.ts#L1459-L1476](../../../../packages/sdk/src/types/plugin.ts#L1459-L1476) - `Loaded`, whose `manifest.icons` the host already resolved to `data:` URIs"
---

## Objective

A kind row on `x-ahpd-agent-kinds` carries icons when the kind or its plugin has them.
No agent plugin sets icons on its kind, but agent-claude, agent-acp, agent-cofold and agent-pi each have icons in their manifest.

## Files

- `UPDATE: packages/sdk/src/agents/kinds.ts:24-62` - add `pluginIcons(name)` to the options, and use it in `rowOf` when the kind has no icons.
- `UPDATE: packages/server/src/commands/run.ts:789` - give `pluginIcons` the manifest icons of the loaded plugin with that name.
- `UPDATE: packages/sdk/test/agent-kinds-channel.test.ts` - the tests for the fallback.
- `UPDATE: docs/plugins/PLUGINS.md` - the `x-ahpd-agent-kinds` section says where a row's icons come from.

## Steps

1. Add `pluginIcons?(name: string): Icon[] | undefined` to `AgentKindsChannelOptions`.
2. In `rowOf`, send the kind's own icons when it has at least one.
3. Otherwise, send the icons that `pluginIcons(kind.by)` returns, when there is at least one.
4. Otherwise, send no `icons` key.
5. In run.ts, read the icons from `manifest.icons` of the entry in `loaded` whose `name` is the plugin's name.
6. Write the tests, then the docs line.

## Validation

- A test shows that a kind with its own icons sends them, and not the plugin's.
- A test shows that a kind with no icons sends its plugin's icons.
- A test shows that a kind with no icons from a plugin with no icons sends no `icons` key.
- `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test` passes.
- On a daemon from this tree, each row on `x-ahpd-agent-kinds://` for `claude`, `acp`, `cofold` and `pi` has a `data:` icon.
