---
title: A session's and a chat's actions are one file
status: done
depends: [task-01-actions.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L10396-L11478](../../../../packages/sdk/src/host.ts#L10396-L11478) - from the worker check to the end of the switch"
---

## Objective

`host/chatactions.ts` exports a function holding the part of `applyDispatch` from the worker check to the end of the switch, and `applyDispatch` ends by returning its call.

## Files

- `CREATE: packages/sdk/src/host/chatactions.ts` - that part, as one function taking `channel`, `action`, `type`, `origin` and `no`.
- `UPDATE: packages/sdk/src/host/actions.ts` - the part removed; `return chatAction(...)` in its place.

## Steps

1. Move the code unchanged but for indentation; every `return;` inside it returns from the new function, which `applyDispatch` returns in turn, so a return keeps its meaning.
2. A `return <promise>` inside the switch stays a `return <promise>`, and the new function's return type is `applyDispatch`'s.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass with no test changed.
- `wc -l packages/sdk/src/host/actions.ts packages/sdk/src/host/chatactions.ts` recorded.

## Resume

Built 2026-10-04. `packages/sdk/src/host/chatactions.ts` (1,129 lines) exports `chatAction(ctx, conn, params, channel, action, type, origin, no)`, holding the part of `applyDispatch` from the worker check to the closing brace of `switch (type)`, moved with every comment inside it. `applyDispatch` ends with `return chatAction(...)`, so every `return;` and every `return <promise>` in the moved part still means what it meant: it returns from `chatAction` and `applyDispatch` returns it in turn.

The signature carries one name the task did not list. The wait around `restarting.get(sessionFor(channel))` re-enters the queue with `conn.applyNow(params, origin)`, and `params` - the whole dispatch, not the `action` inside it - is what that call takes. The task's list of five parameters was written against the parts of the code that read `channel`, `action`, `type`, `origin` and `no`; `params` is read once, deeper in, and is not derivable from any of the others. Passing `action` there instead would have re-queued the inner action without its channel and been refused by the gate. So `params` is a seventh parameter, first of the two values, next to `channel` which is read off it.

Everything else moved without a word changed. `const { connection } = conn;` and `const { refuse } = ctx;` head the function, then the `ctx` destructure of the 49 names the moved code reaches for, wrapped as the other files in this family wrap theirs.

`actions.ts` kept what the remaining half still reads: 39 names, down from 74, and `HOSTS_OWN` and `channels.js` stayed because both halves of the dispatch use them. `chatactions.ts` took its own import list, so `computerNeeds`, `dispatchNeeds`, `ACTION_HOMES`, `HOME_WORDS`, `PER_CONNECTION`, `AnnotationsAction`, `Bag`, `Grant` and `claimOf` stayed in `actions.ts` where the gate and the session flags are.

Validation: `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm test` all pass, 176 files and 2,707 tests, with no test changed.

`wc -l`: `packages/sdk/src/host/actions.ts` 570, `packages/sdk/src/host/chatactions.ts` 1,129. `packages/sdk/src/host.ts` is unchanged at 1,141 lines, as this task touches neither it nor anything else in the family.
