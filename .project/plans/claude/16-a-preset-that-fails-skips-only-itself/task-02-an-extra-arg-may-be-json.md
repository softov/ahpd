---
title: An extraArgs value may be written as JSON
status: todo
depends: [task-01-a-failing-preset-skips-only-itself.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/options.ts#L118-L130](../../../../packages/agent-claude/src/options.ts#L118-L130) - the `extraArgs` declaration and its `toQuery`"
  - "[code://packages/agent-claude/src/options.ts#L231-L250](../../../../packages/agent-claude/src/options.ts#L231-L250) - `variablesOf`, which drops any value that is not a string or `null`"
  - "[code://packages/agent-claude/src/options.ts#L201-L220](../../../../packages/agent-claude/src/options.ts#L201-L220) - `heldTo`, which refuses a non-string value as `is not a string`"
---

## Objective

An `extraArgs` value written as a JSON object, array, number or boolean reaches the CLI as its JSON text, so `"settings": { "permissions": { ... } }` is written as plain JSON instead of an escaped string; a string passes as written and `null` stays a flag with no value.

## Files

- `UPDATE: packages/agent-claude/src/options.ts:118-130` - `extraArgs.toQuery` turns a value that is not a string or `null` into `JSON.stringify(value)`; its schema description and comment say so.
- `UPDATE: packages/agent-claude/src/options.ts:201-220` - `heldTo` accepts any JSON value under `extraArgs`, and still refuses an object whose only key is `fromEnv` there, with `.<key> reads the daemon's environment only under env`.
- `UPDATE: packages/agent-claude/src/options.ts:231-250` - `variablesOf` keeps its string-or-null contract for `env`; `extraArgs` gets its own small reader rather than a flag on the shared one.
- `UPDATE: packages/agent-claude/test/agent-claude-presets.test.ts:241-243` - the `extraArgs.debug: { fromEnv: 'PATH' }` case expects the new message; the cases below.
- `UPDATE: packages/agent-claude/README.md:70` - the row says a value may be JSON, and the OpenRouter example writes `settings` as an object.

## Steps

1. Give `extraArgs` its own reader: string as is, `null` as is, anything else `JSON.stringify`.
2. In `heldTo`, branch on `extraArgs` before the string check: a lone `{ fromEnv }` is refused, everything else passes.
3. A session-level `extraArgs` takes the same values, since session keys and presets are made from one declaration.

## Validation

- `{ extraArgs: { settings: { permissions: { allow: ['Read'] } } } }` queries with `extraArgs.settings === '{"permissions":{"allow":["Read"]}}'`.
- `{ extraArgs: { settings: '{"a":1}', verbose: null } }` queries unchanged.
- `{ extraArgs: { debug: { fromEnv: 'PATH' } } }` skips that preset (task 01) with the new message.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.

## Resume
