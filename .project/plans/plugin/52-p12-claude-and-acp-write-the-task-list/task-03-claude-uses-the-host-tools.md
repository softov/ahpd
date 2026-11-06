---
title: Claude uses the host tools
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L404-L405](../../../../packages/agent-claude/src/session/query.ts#L404-L405) - `disallowedTools` on the query"
  - "[code://packages/agent-claude/src/plugin.ts#L38](../../../../packages/agent-claude/src/plugin.ts#L38) - `optionsSchema` of the Claude plugin"
  - "[code://packages/agent-claude/src/session/asking.ts#L174-L177](../../../../packages/agent-claude/src/session/asking.ts#L174-L177) - `settled`, which reads the deny list on every call"
  - npm://@anthropic-ai/claude-agent-sdk@^0.3.301 - `disallowedTools` on a query
---

## Objective

A Claude session leaves its own task tools by default and uses the host task tools in their place.

## Files

- `UPDATE: packages/agent-claude/src/plugin.ts:38` - declare `hostTasks`, with the default `true`.
- `UPDATE: packages/agent-claude/src/options.ts` - read the setting for each preset.
- `UPDATE: packages/agent-claude/src/session/query.ts:404-405` - add Claude's task tools to `disallowedTools` when the setting is on.
- `CREATE: packages/agent-claude/test/agent-claude-tasks.test.ts` - the deny list with the setting on and off.

## Steps

1. Declare `hostTasks` in `optionsSchema` and in a preset, with the default `true`.
2. Add `TodoWrite`, `TaskCreate`, `TaskUpdate`, `TaskList` and `TaskGet` to `disallowedTools` when `hostTasks` is on.
3. Add them only when the host offers the `task_add` tool of the tasks plugin.
4. Keep the deny list of a person, and merge the task tools into it.

## Validation

- `packages/agent-claude/test/agent-claude-tasks.test.ts`: with no options, the query denies `TodoWrite` and the Task tools.
- `packages/agent-claude/test/agent-claude-tasks.test.ts`: with the setting off, the query denies none of them.
- `packages/agent-claude/test/agent-claude-tasks.test.ts`: a person's own deny list stays in the query.
- `pnpm vitest run packages/agent-claude/test` passes.

## Resume

- **Done so far:** every step. `hostTasks` is a declaration in `options.ts` with the fallback `true`, and a property of a preset in `optionsSchema`. `OWN_TASK_TOOLS` names the five tools once. `query.ts` builds `disallowedTools` from the person's deny list and adds the five only when `hostTasks` is not false and `ctx.offering` holds `task_add`.
- **Files:** `packages/agent-claude/src/options.ts`, `packages/agent-claude/src/plugin.ts`, `packages/agent-claude/src/session/query.ts`, `packages/agent-claude/test/agent-claude-tasks.test.ts`, `packages/agent-claude/test/agent-claude-declarations.test.ts`.
- **Next action:** task 04.
- **Open questions:** none.
- **Watch out for:** the setting is read where the query is built, because the deny list is also the person's. It is not a query option of its own. A name a person already denied is not repeated. A host with no `task_add` offers nothing in the tools' place, so the harness keeps them even with the setting on. `optionDefaults()` now holds two values, and the declarations test says so.
