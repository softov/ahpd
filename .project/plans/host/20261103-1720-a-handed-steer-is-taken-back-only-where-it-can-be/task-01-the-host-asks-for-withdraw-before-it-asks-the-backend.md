---
title: The host asks for withdraw before it asks the backend
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - the removal's case"
  - "[code://packages/sdk/src/types/session.ts](../../../../packages/sdk/src/types/session.ts) - `unqueue` and `withdraw`"
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts) - the proxy's `withdraw`"
---

## Objective

A removal of the steering message while a turn runs is refused before the backend hears of it, unless the backend has `withdraw`.
A backend with `withdraw` takes the steer back, and the host answers the client if it said nothing.
A removal while no turn runs still goes to `unqueue`.

## Files

- `UPDATE: packages/sdk/src/types/session.ts` - `withdraw`, and what `unqueue` reaches.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - the check before the backend is asked.
- `UPDATE: packages/sdk/src/sessions/nested.ts` - the proxy's `withdraw`.
- `UPDATE: packages/agent-claude/src/session/turns.ts`, `packages/agent-cofold/src/turns.ts`, `packages/agent-cofold/src/context.ts` - their comments on what reaches `unqueue`.
- `UPDATE: docs/sdk/AHP.md`, `docs/sdk/CHATS.md` - the removal's rows.
- `UPDATE:` the host steering cases, cofold's held-steer case and the nested removal case.

## Steps

1. Add an optional `withdraw` to `Session`.
2. Check the running turn and `withdraw` in the removal's case before the backend hears of it.
3. Refuse the removal in the reference's words when the backend has no `withdraw`.
4. Carry a removal inside from the proxy's `withdraw`.
5. Say in Claude's and cofold's comments that their `unqueue` reaches a handed steer only after its turn.
6. Add host cases for a backend with and without `withdraw`.
7. Check in cofold's case that the chat holds no steer once the run read it.
8. Give the nested case's inner backend a `withdraw`.

## Validation

- The new and changed cases fail on `3945964a`'s sources and pass after.
- The three test files pass, one file at a time.
- `pnpm run typecheck` and `pnpm run boundary` are clean.
