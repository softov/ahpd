---
title: The host says the client's action
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `dispatch`, `said` and `refuse`"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - each case's checks, its say, its side effect"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts) - a backend's action said as the host's"
---

## Objective

The host says each client action itself, with the client's origin, once its own checks pass and before any side effect.
What a backend says is the host's own action, with no origin.

## Files

- `UPDATE: packages/sdk/src/host.ts` - one call for a client's action and one for the host's; the matching and the holds on an answer go.
- `UPDATE: packages/sdk/src/host/context.ts` - `owe`, `startOwed`, `answering`, `unanswered` and `ahead` go; `resumedTurns` holds a resumed turn's time.
- `UPDATE: packages/sdk/src/host/chatactions.ts`, `packages/sdk/src/host/actions.ts` - each case runs its checks, says the client's action, then calls its side effect.
- `UPDATE: packages/sdk/src/host/lifecycle.ts` - `beginOrRun` says a client's start or queued message once the turn's checks pass.
- `UPDATE: packages/sdk/src/host/spawn.ts` - `handed` and the answer road go; a backend's background work and session activity are said.
- `UPDATE: packages/sdk/src/host/catalogue.ts` - the session's activity folded into its held state.
- `UPDATE: packages/sdk/src/types/terminals.ts`, `packages/sdk/src/host/terminals.ts`, `packages/sdk/src/machines/terminals.ts` - a terminal takes a client's change, which the host says.
- `UPDATE: packages/sdk/src/sessions/nested.ts` - the proxy carries what the host said, and ends a turn the host inside refuses.
- `UPDATE: packages/sdk/src/types/agent.ts`, `packages/sdk/src/types/session.ts` - `Start.handed` and `Handed` go.
- `UPDATE: docs/sdk/AHP.md`, `docs/sdk/AGENT.md`, `docs/sdk/CHATS.md` - the rows that describe an echo a backend gives.

## Steps

1. Split `dispatch` into a client's action with its origin and the host's action with none (rows 1, 2).
2. Remove the code that matches an action to the dispatch the host applies (row 2; C-0019, C-0023).
3. Run each case's checks first, refusing with the client's origin where they fail (row 4).
4. Say the client's action, then call the backend (row 1; A-0008).
5. Keep only the rewrites the host makes of any action it says (row 3).
6. Say a client's stop with its own duration, a resumed turn's with the host's (row 32).
7. Drop a backend's start of a turn a client began, since the host said it (row 2).
8. Say a backend's background work and session activity (C-0020, C-0021).
9. Fold the session's activity into its held state (C-0021).
10. Turn the refusals after the echo into state (D-0051 to D-0053).
11. Rewrite the cases that read a backend's rebuild as the client's echo.

## Validation

- `packages/sdk/test/echo-origin.test.ts`: the host answers a start exactly as sent, first.
- Add a case per A-0008 action: the host says a draft, a read bit and a tool result first.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Resume

- **Done:** every step above, at the commit that closes this task.
- **Kept, against the plan's list:** `said`, the origins answered, since the spec has a dispatch answered once ([actions.md L20](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/actions.md#L20)).
- **Taken in here:** D-0051 to D-0053 from task 04's step 7, since a refusal after the echo cannot be one.
- **Interim, until 07 to 09:** backends still say their own copies of a client's action; the host drops only a held turn's start.
- **Interim, until 03:** a stop from another connection during a start's policy check reaches no turn.
