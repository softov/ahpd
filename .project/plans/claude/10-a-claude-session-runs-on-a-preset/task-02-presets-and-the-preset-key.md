---
title: Presets, and the `preset` key
status: todo
depends: [task-01-each-option-is-one-declaration.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/plugin.ts#L34-L59](../../../../packages/agent-claude/src/plugin.ts#L34-L59) - `optionsSchema` and `optionsOf`"
  - "[code://packages/agent-claude/src/claude.ts#L513-L550](../../../../packages/agent-claude/src/claude.ts#L513-L550) - `create`, where `settings` reach a session"
---

## Objective

`optionsSchema` has `presets`, an object of named presets checked by `presetSchema`; with two or more, `schema()` has `preset`, an enum of their names defaulting to the first, fixed at creation; a session runs with its preset's values, and one whose preset is gone runs on the default.

## Files

- `UPDATE: packages/agent-claude/src/plugin.ts` - `presets` in `optionsSchema`, `package.json`'s `ahpd.options` and `ClaudeOptions`.
- `UPDATE: packages/agent-claude/src/claude.ts` - the `preset` key and the values it resolves to, passed to `createSession`.
- `CREATE: packages/agent-claude/test/agent-claude-presets.test.ts` - the cases below.

## Steps

1. Tests first: no presets gives no key and today's `query()` options; one preset gives no key and its values; two give the key, default the first, and each session gets its own preset's values; a stored name that no longer exists resumes on the first (with host/31); a preset with an unknown field fails the plugin's load with the key named.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
