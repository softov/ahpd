---
title: A turn that cannot begin once the session has opened is refused
status: todo
depends: []
layer: cofold
refs:
  - "[code://packages/agent-cofold/src/turns.ts#L520-L556](../../../../packages/agent-cofold/src/turns.ts#L520-L556) - `beginTurn`"
  - "[code://packages/agent-claude/src/session/turns.ts#L595-L607](../../../../packages/agent-claude/src/session/turns.ts#L595-L607) - Claude's refusal through `handed`"
---

## Objective

A turn a client hands a cofold session while it opens, which finds a turn running once the opening settles, is refused to that client.

## Files

- `UPDATE: packages/agent-cofold/src/turns.ts` - `beginTurn` takes the client's `handed` while the dispatch is applied, and refuses through it when the turn finds another active.
- `UPDATE: packages/agent-cofold/test/agent-cofold-store.test.ts` - two turns handed during a resume's opening: the first runs, the second is refused; a turn handed while a paused run reopens is refused.
- `UPDATE: packages/agent-cofold/README.md` - a turn sent while the session opens.

## Steps

1. Write the cases and run them on `47d14247` to see the second turn answered by nothing.
2. Refuse it.

## Validation

- The new cases fail on `47d14247` and pass after the change.
- The agent-cofold suite passes.

## Resume

Not started.
