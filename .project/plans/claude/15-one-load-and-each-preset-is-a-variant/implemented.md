---
title: A Claude plugin is loaded once, and each preset is a variant - implemented
date: 2026-10-02
refs:
  - "[code://packages/agent-claude/src/plugin.ts](../../../../packages/agent-claude/src/plugin.ts)"
  - "[code://packages/agent-claude/src/claude.ts](../../../../packages/agent-claude/src/claude.ts)"
  - "[code://packages/server/src/plugins.ts](../../../../packages/server/src/plugins.ts)"
---

One `@ahpd/agent-claude` entry registers the built-in `claude` ("Claude Code") unless `presets.claude` is `false`, and one agent per other preset, each with its own `name`, `models`, `keepCliModels` and declared options; a plugin named twice in `plugins` fails the start.

## What was built

- [`code://packages/agent-claude/src/plugin.ts`](../../../../packages/agent-claude/src/plugin.ts) - `variantsOf`, `optionsOf` returning one `ClaudeOptions` per variant, `apply` registering each; top-level `provider`, `displayName`, `models`, `keepCliModels` refused naming `presets.<id>`.
- [`code://packages/agent-claude/src/options.ts`](../../../../packages/agent-claude/src/options.ts) - a preset may hold `name`, `models` (checked by `modelsProblem`) and `keepCliModels`; `presetValues` removed.
- [`code://packages/agent-claude/src/claude.ts`](../../../../packages/agent-claude/src/claude.ts) - one variant per agent; the session `preset` key removed; the probe reads the preset's `ANTHROPIC_BASE_URL`, a `fromEnv` one included.
- [`code://packages/server/src/plugins.ts`](../../../../packages/server/src/plugins.ts) and `commands/config.ts` - a repeated name refused; every key `plugins.<name>`.
- README and DAEMON.md show one entry with the built-in and a variant.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm boundary` clean, `pnpm test` 164 files and 2426 tests, twice; one earlier run failed `computer-disposable.test.ts` once and it passes alone.
- Read against the plan: variants, `false`, names, models and the refusal follow the locked rows.

## Departures from the plan

- agent-acp's and agent-cofold's two-backend tests were rewritten onto the refusal.
- Review resolved a `fromEnv` base URL for the probe, trimmed a history comment and removed the unused `plugin-provider` fixture.

## Left for later

- See [deferred.md](deferred.md).
