---
title: Each Claude preset registers its own agent
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/plugin.ts](../../../../packages/agent-claude/src/plugin.ts) - `optionsSchema`, `optionsOf`, `apply`"
  - "[code://packages/agent-claude/src/claude.ts](../../../../packages/agent-claude/src/claude.ts) - `ClaudeOptions` and the session `preset` key"
  - "[code://packages/agent-claude/src/options.ts](../../../../packages/agent-claude/src/options.ts) - `presetValues`, `presetSchema`"
  - "[code://packages/agent-claude/test/agent-claude-presets.test.ts](../../../../packages/agent-claude/test/agent-claude-presets.test.ts) - the preset tests to rewrite"
---

## Objective

One load of `@ahpd/agent-claude` registers one agent per preset: the built-in `claude` unless switched off, and each other preset with its own `name`, `models` and options.

## Files

- `UPDATE: packages/agent-claude/src/plugin.ts` - `optionsSchema` drops top-level `provider`, `displayName`, `models`, `keepCliModels`; a preset is `false` or an object that may also hold `name`, `models`, `keepCliModels`. `optionsOf` returns the variants; `apply` registers one agent each.
- `UPDATE: packages/agent-claude/src/claude.ts` - `ClaudeOptions` takes one variant (`provider`, `displayName`, `models`, `keepCliModels`, `preset` bag) instead of `presets`; the session `preset` key and its default go; `endpoints()` reads the preset's `ANTHROPIC_BASE_URL` first.
- `UPDATE: packages/agent-claude/src/options.ts` - `presetValues` goes; `presetSchema` accepts `name`, `models` and `keepCliModels` beside the declared options, with `models` checked by `modelsProblem`.
- `UPDATE: packages/agent-claude/test/agent-claude-presets.test.ts` - the cases below.

## Steps

1. In `optionsOf`, refuse a top-level `provider`, `displayName`, `models` or `keepCliModels` with a message naming `presets.<id>`.
2. Build the variants: `claude` with name `Claude Code`, unless `presets.claude === false`, with an object under `presets.claude` laid over it; then each other key in written order, `false` skipped, name defaulting to the key. No variant left fails the load.
3. Split each variant into `provider`, `displayName`, `models`, `keepCliModels` and the declared options, and pass them to `claude()` with the shared options.
4. In `claude.ts`, use the variant's declared options where `presetValues` was read, and remove the session `preset` key from the schema and from the defaults.
5. Keep `env` values `writeOnly` in `optionsSchema`, and keep `fromEnv` working as claude/12 built it.

## Validation

- Tests: no presets registers `claude` / `Claude Code`; `claude-openrouter: { name: "Claude OpenRouter", models: [...] }` registers two agents with their own names and model lists; `claude: false` registers only the variant; `claude: { thinking: "disabled" }` overrides the built-in; a top-level `models` fails naming `presets`; all presets `false` fails; the session schema has no `preset` key.
- `pnpm exec tsc --noEmit`, `pnpm test`.

## Resume
