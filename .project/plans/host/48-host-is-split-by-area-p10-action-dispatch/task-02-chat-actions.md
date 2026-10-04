---
title: A session's and a chat's actions are one file
status: todo
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
