---
title: The models option
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/options.ts](../../../../packages/agent-claude/src/options.ts) - where the option's shape and resolution go"
---

## Objective

`models` is a list whose entries are a model id, `{ "id", "name" }`, or `{ "fetch": "<url>", "match": "<pattern>", "key": { "fromEnv": "<VAR>" } }`; `keepCliModels: true` adds them to the CLI's list instead of replacing it.

## Files

- `CREATE: packages/agent-claude/src/models.ts` - the entry shapes, the check, the fetch (an OpenAI-shaped `data` list), and the merge.
- `UPDATE: packages/agent-claude/src/claude.ts` - the probe's list through the merge; the options passed to sessions.
- `UPDATE: packages/agent-claude/src/session.ts` - the handshake's list through the same merge.
- `UPDATE: packages/agent-claude/src/plugin.ts`, `package.json`, `README.md` - the two options.

## Validation

- `packages/agent-claude/test/agent-claude-models.test.ts`: written ids, a fetched list filtered by its pattern, a failed fetch, replace versus add, and a malformed entry failing the load.

## Resume
