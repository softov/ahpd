---
title: A dead agent is reopened by its id
status: todo
depends: [task-01-a-child-that-fails-is-heard.md]
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L546-L555](../../../../packages/agent-acp/src/session.ts#L546-L555) - the open after a death"
  - "[code://.project/plans/acp/02-replay-lands-in-history/plan.md](../../../../.project/plans/acp/02-replay-lands-in-history/plan.md) - replay is collected before this reopen can load"
---

## Objective

The turn after a server died respawns it and loads or resumes the session's own `acpSessionId`, so the conversation continues; a server that can do neither fails the turn saying so.

## Files

- `UPDATE: packages/agent-acp/src/session.ts:546-555` - reopen by id.

## Steps

1. Keep `acpSessionId` across the death.
2. Reopen through the same choice `open` makes for a resume.
3. Never fall back to `session/new` silently: a server that cannot load says so, as a resume does today.

## Validation

- A fixture that exits after one turn and advertises `loadSession` answers the second turn in the same ACP session.
- One that does not advertise it fails the second turn with a sentence.

## Resume
