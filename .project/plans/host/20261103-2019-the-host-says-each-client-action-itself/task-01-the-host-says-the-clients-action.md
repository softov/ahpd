---
title: The host says the client's action
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host.ts#L822-L928](../../../../packages/sdk/src/host.ts#L822-L928) - the echo by matching, which goes"
  - "[code://packages/sdk/src/host/context.ts#L356-L395](../../../../packages/sdk/src/host/context.ts#L356-L395) - `dispatch`, `owe`, `startOwed`, `answering`, `unanswered`"
  - "[code://packages/sdk/src/host/spawn.ts#L1184-L1360](../../../../packages/sdk/src/host/spawn.ts#L1184-L1360) - `handed`, `handedFrom` and the answer road"
---

## Objective

The host says each client action itself, with the client's origin, once its own checks pass and before any side effect.
What a backend says is the host's own action, with no origin.

## Files

- `UPDATE: packages/sdk/src/host.ts` - one call for a client's action and one for the host's; `applying`, `owed`, `answering`, `NAMING`, `originOf`, `answeredBy`, `said`, `told`, `awaited` and `ahead` go.
- `UPDATE: packages/sdk/src/host/context.ts` - `owe`, `startOwed`, `answering` and `unanswered` go; `dispatch` says the host's action.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - each case runs its checks, says the client's action, then calls its side effect.
- `UPDATE: packages/sdk/src/host/spawn.ts` - `handed` and `handedFrom` go; a backend's action is said as the host's.
- `UPDATE: packages/sdk/src/types/agent.ts`, `packages/sdk/src/types/session.ts` - `Start.handed` and `Handed` go.
- `UPDATE: docs/sdk/AHP.md` - the rows that describe an echo a backend gives.

## Steps

1. Split `dispatch` into a client's action with its origin and the host's action with none (rows 1, 2).
2. Remove the code that matches an action to the dispatch the host applies (row 2).
3. Run each case's checks first, refusing with the client's origin where they fail (row 4).
4. Say the client's action, then call the backend (row 1).
5. Keep only the rewrites the host makes of any action it says (row 3).
6. Say a client's stop with its own duration, a resumed turn's with the host's (row 32).
7. Drop a backend's start of a turn a client began, since the host said it (row 2).
8. Rewrite the cases that read a backend's rebuild as the client's echo.

## Validation

- Run `packages/sdk/test/echo-origin.test.ts`: the host answers each client action with that action as sent, first.
- Add a case for A-0008: the host says a draft, a read bit and a tool result first.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Resume

