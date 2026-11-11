---
title: A link finds its session by id
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/tools/session.ts#L44-L54](../../../../packages/sdk/src/tools/session.ts#L44-L54) - `sessionMeant`, the one place every session tool reads a link"
  - "[code://packages/sdk/test/sessiontools.test.ts#L83-L92](../../../../packages/sdk/test/sessiontools.test.ts#L83-L92) - the case that refuses a link of another agent"
---

## Objective

`sessionMeant` finds a link's session by the id the link carries, and no longer compares the link's agent with the row's provider.

## Files

- `UPDATE: packages/sdk/src/tools/session.ts:44-54` - the row is found by its id alone; the comment says why.
- `UPDATE: packages/sdk/test/sessiontools.test.ts:83-92` - a link of another agent finds the session by its id.

## Steps

1. Match a link's row by `idOf(row.resource)` alone.
2. Keep the chat id a link carries, as now.
3. Keep a session URI matched whole, as now.
4. Write the comment: the ids are unique across agents, and a link names its agent, not its URI scheme.
5. Change the test case for another agent's link to find the session.

## Validation

- `sessiontools.test.ts`: `agent-host-session://codex/s1` finds `ahp-session:/s1`; an unknown id is still refused.
- `pnpm typecheck` passes.

## Resume

- `sessionMeant` finds a link's row by its id alone.
- The test case for another agent's link now finds `ahp-session:/s1`.
