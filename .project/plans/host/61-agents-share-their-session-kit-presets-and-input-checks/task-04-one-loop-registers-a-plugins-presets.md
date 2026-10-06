---
title: One loop registers a plugin's presets
status: todo
depends: [task-03-a-presets-secrets-and-environment-references-are-read-by-the-sdk.md]
layer: "sdk, agent-acp, agent-claude"
refs:
  - "[code://packages/agent-acp/src/plugin.ts#L267-L292](../../../../packages/agent-acp/src/plugin.ts#L267-L292) - acp's loop: log and problem per failure, `preset`"
  - "[code://packages/agent-claude/src/plugin.ts#L158-L189](../../../../packages/agent-claude/src/plugin.ts#L158-L189) - claude's loop: problem per failure, `variant`"
  - "[code://packages/sdk/src/plugins.ts](../../../../packages/sdk/src/plugins.ts) - where `eachPreset` goes"
---

## Objective

`eachPreset(host, name, entries, build, { noun, log })` is exported from `@ahpd/sdk`, and acp's and claude's `optionsOf` hand it their presets; what each says for a dropped preset and for none left is unchanged.

## Files

- `UPDATE: packages/sdk/src/plugins.ts` - `eachPreset`: for each `[id, given]`, `await build(id, given)`; a throw says `${name}: ${reason(error)}` through `host.problem` (and `host.log` when `log` is set) and drops the id; none left throws `presets names no <noun> left to register an agent for[: <dropped>]`.
- `UPDATE: packages/sdk/src/index.ts:27` - exported.
- `UPDATE: packages/sdk/test/plugin-host.test.ts` - the helper's cases.
- `UPDATE: packages/agent-acp/src/plugin.ts:267-292` - `eachPreset(host, name, Object.entries(bagOf(values.presets)), presetOf..., { noun: 'preset', log: true })`.
- `UPDATE: packages/agent-claude/src/plugin.ts:158-189` - the same over `variantsOf(presets)`, `{ noun: 'variant' }`.

## Steps

1. The "written per preset" guard at the top of each `optionsOf` stays in each plugin; its key lists and nouns differ.

## Validation

- `plugin-host.test.ts`, a new helper's cases: two presets with one failing register one and say one problem; all failing throw with both ids; `log: true` also logs.
- A pure refactor in the plugins: `agent-acp-presets.test.ts`, `agent-acp-plugin.test.ts`, `agent-claude-presets.test.ts` stay green unchanged, every sentence included.
- `pnpm exec tsc --noEmit`, `pnpm test`.

## Resume
