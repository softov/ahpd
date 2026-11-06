---
title: Claude keeps its own tools on a setting
status: done
depends: [task-03-claude-uses-the-host-tools.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L372-L374](../../../../packages/agent-claude/src/session/query.ts#L372-L374) - the `env` Claude Code is started with, and the machine case"
  - "[code://packages/agent-claude/src/options.ts#L119-L136](../../../../packages/agent-claude/src/options.ts#L119-L136) - `env`, the variables a preset gives"
  - https://code.claude.com/docs/en/settings - `CLAUDE_CODE_ENABLE_TASKS`, the variable that turns on the Task tools
---

## Objective

When Claude keeps its own tools, ahpd starts Claude Code with `CLAUDE_CODE_ENABLE_TASKS` set, unless a second setting is off.

## Files

- `UPDATE: packages/agent-claude/src/plugin.ts:38` - declare `enableTasks`, with the default `true`.
- `UPDATE: packages/agent-claude/src/session/query.ts:372-374` - set `CLAUDE_CODE_ENABLE_TASKS` in the environment, in a machine too.
- `UPDATE: packages/agent-claude/test/agent-claude-tasks.test.ts` - the environment for each pair of settings.

## Steps

1. Declare `enableTasks` in `optionsSchema` and in a preset, with the default `true`.
2. Set `CLAUDE_CODE_ENABLE_TASKS` to `1` when Claude keeps its own tools and `enableTasks` is on.
3. Set it in the environment of a machine as well as on the host.
4. Keep a value that a preset's `env` gives, and do not write over it.

## Validation

- `packages/agent-claude/test/agent-claude-tasks.test.ts`: with own tools kept and the second setting on, the environment holds `CLAUDE_CODE_ENABLE_TASKS=1`.
- `packages/agent-claude/test/agent-claude-tasks.test.ts`: with the host tools in place, ahpd does not set the variable.
- `packages/agent-claude/test/agent-claude-tasks.test.ts`: a preset's own value stays.
- `pnpm vitest run packages/agent-claude/test` passes.

## Resume

- **Done so far:** every step. `enableTasks` is a declaration in `options.ts` with the fallback `true`, and a property of a preset in `optionsSchema`. `query.ts` reads it in `taskToolsEnv()`, which sets `CLAUDE_CODE_ENABLE_TASKS=1` when the session keeps Claude's own tools, on the host and in a machine alike. `hostHoldsTasks()` is shared by that function and `denyOption()`, so the two settings cannot disagree about whose list it is.
- **Files:** `packages/agent-claude/src/options.ts`, `packages/agent-claude/src/plugin.ts`, `packages/agent-claude/src/session/query.ts`, `packages/agent-claude/test/agent-claude-tasks.test.ts`, `packages/agent-claude/test/agent-claude-declarations.test.ts`, `packages/agent-claude/test/agent-claude-presets.test.ts`.
- **Next action:** task 05.
- **Open questions:** none.
- **Watch out for:** a preset's `env` gives the variable its value, and the session does not write over it. A machine's environment is the variant's own keys, so the variable is added there rather than to the daemon's environment. Four cases in `agent-claude-presets.test.ts` now expect the variable in a machine, because those sessions keep their own tools - no `task_add` is offered.
