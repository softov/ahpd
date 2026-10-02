---
title: A second Claude harness runs on another endpoint - implemented
date: 2026-10-02
refs:
  - "[code://packages/agent-claude/src/options.ts](../../../../packages/agent-claude/src/options.ts)"
  - "[code://packages/agent-claude/src/claude.ts](../../../../packages/agent-claude/src/claude.ts)"
---

agent-claude takes a `displayName`, so a second load under its own `provider` is a harness of its own, and a preset `env` value may be `{ "fromEnv": "NAME" }`, read from the daemon's environment, so an endpoint's key stays out of the configuration.

## What was built

- `displayName` in `ClaudeOptions`, the plugin's option schema and the manifest; `Claude Code` by default.
- `env` in [`code://packages/agent-claude/src/options.ts`](../../../../packages/agent-claude/src/options.ts) takes a string, `null` or `{ fromEnv }`; a `fromEnv` naming an unset variable fails the plugin load, naming both. A nested preset error no longer has a stray space.
- The README: the option, the value form, and the OpenRouter example.

## Verified

- `packages/agent-claude/test/agent-claude-presets.test.ts`: two loads register `claude` / `Claude Code` and `claude-openrouter` / `Claude Code (OpenRouter)`; a `fromEnv` value reaches the CLI's environment; an unset one fails the load; `extraArgs` does not take it.
- `pnpm exec tsc --noEmit` clean; `pnpm boundary` clean; `pnpm test` 138 files, 2070 tests passed.

## Departures from the plan

- None.
