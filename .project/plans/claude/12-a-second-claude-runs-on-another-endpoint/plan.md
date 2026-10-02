---
title: A second Claude harness runs on another endpoint, named on its own and keyed from the daemon's environment
domain: claude
status: planned
priority: medium
created: 2026-10-02
revalidated: 2026-10-02
requires:
  - plans/claude/10-a-claude-session-runs-on-a-preset/plan.md
decisions: []
refs:
  - "[code://packages/agent-claude/src/claude.ts](../../../../packages/agent-claude/src/claude.ts) - `displayName: 'Claude Code'`, fixed today"
  - "[code://packages/agent-claude/src/options.ts](../../../../packages/agent-claude/src/options.ts) - the `env` declaration and `presetSchema`"
  - "[code://packages/agent-acp/src/plugin.ts](../../../../packages/agent-acp/src/plugin.ts) - agent-acp's `displayName` option, the pattern to mirror"
---

## Goal

agent-claude loaded a second time with its own `provider` and `displayName`, and one preset whose `env` points the CLI at OpenRouter, shows as its own harness, such as "Claude Code (OpenRouter)", and its key is read from the daemon's environment rather than written in `config.json`.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| The OpenRouter Claude is a second harness, not a preset of the first | Softov, 2026-10-02, asked "How should the OpenRouter Claude show up?": "Second harness" | 01 |
| A preset `env` value may be `{ "fromEnv": "<VAR>" }`, read from the daemon's environment | Softov, 2026-10-02, asked "Where should the OpenRouter key come from?": "From the daemon's env" | 02 |
| A `fromEnv` naming a variable the daemon does not have fails the plugin load, naming both | (defaulted: running with no key would fall back to whatever key the CLI finds) | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - agent-claude takes a displayName](task-01-display-name.md) | todo | - |
| [02 - A preset env value may name a daemon variable](task-02-from-env.md) | todo | - |

## Resume state

- **Done so far:** planned 2026-10-02.
- **Next action:** [task-01-display-name.md](task-01-display-name.md).
- **Open questions:** none.

## Final verification checklist

- [ ] Two agent-claude entries load side by side under two providers and two names.
- [ ] A `fromEnv` value reaches the CLI's environment, and a missing variable fails the load.
- [ ] `plans/index.md` updated.
