---
title: Claude deletes its transcript
status: todo
depends: [task-01-the-host-deletes-through-the-agent.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/claude.ts#L411](../../../../packages/agent-claude/src/claude.ts#L411) - `list`, beside which `delete` goes"
  - "[code://packages/agent-claude/src/catalog.ts#L20](../../../../packages/agent-claude/src/catalog.ts#L20) - the SDK's `listSessions`, the module the delete belongs beside"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.278 - `deleteSession(sessionId, { dir })`
---

## Objective

A deleted Claude session's `<id>.jsonl` and `<id>/` folder are gone, through the SDK's `deleteSession`.

## Files

- `UPDATE: packages/agent-claude/src/catalog.ts` - `forgetSession(id, dir)` calls `deleteSession(id, { dir })` and treats the SDK's not-found as done.
- `UPDATE: packages/agent-claude/src/claude.ts` - the agent's `delete` calls it with the session's directory.
- `UPDATE: packages/agent-claude/test/` - a test beside the catalogue's.

## Steps

1. Wrap `deleteSession`; tell its not-found apart from other errors by checking the file is absent after the throw, not by its message.
2. `delete: (id, directory) => forgetSession(id, directory)` on the agent, for every variant.

## Validation

- A test against a temp `CLAUDE_CONFIG_DIR`: a written `<id>.jsonl` and `<id>/` are removed; a missing id resolves; an unreadable directory rejects.
- By hand: the reproduction in the plan's checklist.

## Resume

