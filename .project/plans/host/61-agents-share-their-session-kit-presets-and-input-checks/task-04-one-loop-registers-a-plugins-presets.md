---
title: One loop registers a plugin's presets
status: done
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

- **Implemented** 2026-10-10 on `build/agents/167a4a60`.
- `eachPreset(host, name, entries, build, { noun, log })` is in `packages/sdk/src/plugins.ts`.
- It is exported from `@ahpd/sdk` with its `EachPresetOptions` type.
- It awaits `build(id, given)` per entry and drops a throwing one.
- A throw says `${name}: ${reason(error)}` through `host.problem`.
- `log` also logs the same line.
- Nothing resolved throws `presets names no <noun> left to register an agent for[: <ids>]`.
- acp's loop is one call over `Object.entries(bag(values.presets))` with `{ noun: 'preset', log: true }`.
- Each failure is still both logged and said, in that order.
- claude's loop is one call over `variantsOf(presets)` mapped to `[id, variant]` pairs with `{ noun: 'variant' }`.
- Its build is the schema check and the `env` read that were the loop's body.
- The "written per preset" guard stays in each `optionsOf`, with its own key list and noun.
- The task file says `bagOf`, which no package has.
- The reader acp already imports is `bag`, so `bag(values.presets)` is what the call passes.
- `packages/sdk/test/plugin-host.test.ts` has 3 new cases.
- `agent-acp-presets.test.ts`, `agent-acp-plugin.test.ts`, `agent-acp-machine.test.ts` and `agent-claude-presets.test.ts` are unchanged.
- Gates: `pnpm install`, `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck` and `pnpm boundary` all pass.
- The full suite passes 4869 of 4870 tests over 272 files.
- The one failure is `changes-refresh.test.ts`, the load flake, which passes 29 of 29 alone.
