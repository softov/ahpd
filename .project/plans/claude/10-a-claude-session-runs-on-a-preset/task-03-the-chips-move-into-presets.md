---
title: The ahpd-only chips move into presets
status: todo
depends: [task-02-presets-and-the-preset-key.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/claude.ts#L221-L263](../../../../packages/agent-claude/src/claude.ts#L221-L263) - the three keys"
  - "[code://packages/agent-claude/src/session.ts#L2962-L3026](../../../../packages/agent-claude/src/session.ts#L2962-L3026) - their live `setConfig` paths"
  - "[code://packages/sdk/test/fixtures/wire.jsonl](../../../../packages/sdk/test/fixtures/wire.jsonl) - the recorded schema"
---

## Objective

`outputStyle`, `thinking` and `sandboxEnabled` are no longer session keys; their values come only from the preset, and `permissionMode` keeps its six values.

## Files

- `UPDATE: packages/agent-claude/src/claude.ts` - the three keys leave `schema()` and `defaults()`.
- `UPDATE: packages/agent-claude/src/session.ts` - their live `setConfig` branches go.
- `UPDATE:` the tests that assert the schema, and `packages/sdk/test/fixtures/wire.jsonl`.

## Steps

1. Tests first: the schema has none of the three keys and still has `permissionMode` with `dontAsk`; a preset's `thinking: "disabled"` reaches `query()`.
2. Remove the keys and their branches.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- By hand in ahpapp: the composer shows no Output style, Thinking or Sandbox chip.

## Resume
