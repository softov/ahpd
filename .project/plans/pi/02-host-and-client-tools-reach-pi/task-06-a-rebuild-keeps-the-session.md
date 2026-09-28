---
title: A rebuild keeps the model, the thinking level and the session, and a failed one fails only its turn
status: done
depends: [task-05-tools-announced-while-pi-opens-reach-it.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L588-L611](../../../../packages/agent-pi/src/session.ts#L588-L611) - `opened` and `reopen`"
  - npm://@earendil-works/pi-coding-agent@^0.87.1 - `dist/core/sdk.js`: the model and thinking level are restored only from a file with messages
---

## Objective

After a rebuild pi runs on the model and thinking level it had, on the same session id, and a rebuild that fails fails that turn and lets the next one try again.

## Files

- `UPDATE: packages/agent-pi/src/session.ts:588-611`
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the cases below.

## Steps

1. Read the model and thinking level off the backend before closing it, and apply them to the new one.
2. Unsubscribe from the old backend before closing it.
3. A rebuild of a session pi has not written yet keeps its id or builds as the first open would.
4. On a failed rebuild, clear `opening` and `live` so the next turn opens again.

## Validation

- `packages/agent-pi/test/agent-pi.test.ts`: after a rebuild the fake is asked for the same model and thinking level, and `open` receives the same id, the tools, `instructions` and `onToolCall`.
- A rebuild that throws fails that turn and the next turn opens.
- `node_modules/.bin/vitest run packages/agent-pi` green.

## Resume

Built.
`session.ts`'s `reopen` reads `previous.chosen()` before unsubscribing and closing, so the rebuilt backend is told to run on the model and thinking level the conversation was on.
It still passes the same id as `resume`, the new tools, the filtered `instructions` and `onToolCall`.
On a failed rebuild it closes whatever was built, clears `opening` and `live`, and rethrows, so the turn fails and the next turn opens again.
A session pi has not written yet builds as the first open would, through `resumeOrCreate` creating one.

- Failed first: the rebuild carried no model (0 `choose` calls) and a failed rebuild left `opening` rejected (2 opens where 3 were expected).
- `node_modules/.bin/vitest run packages/agent-pi` green, 86 tests; `pnpm typecheck` green.
