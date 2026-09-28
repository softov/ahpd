---
title: piSession has no test-only parameter, and the ask tests drive the real mode
status: done
depends: [task-05-a-path-is-judged-where-pi-puts-it.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L51-L58](../../../../packages/agent-pi/src/session.ts#L51-L58) - `Asking`, a policy only a test hands in"
  - "[code://packages/agent-pi/src/session.ts#L99-L104](../../../../packages/agent-pi/src/session.ts#L99-L104) - `piSession`, whose fourth parameter is it"
  - "[code://packages/agent-pi/src/index.ts#L4-L4](../../../../packages/agent-pi/src/index.ts#L4-L4) - the export of `Asking`"
  - "[code://packages/agent-cofold/test/agent-cofold-approval.test.ts](../../../../packages/agent-cofold/test/agent-cofold-approval.test.ts) - the sibling drives its approval tests through its real policy"
---

## Objective

`piSession` and `index.ts` expose nothing that exists for a test, and every ask case reaches the question through `permissionMode`.

## Files

- `UPDATE: packages/agent-pi/src/session.ts` - `Asking` and the parameter go.
- `UPDATE: packages/agent-pi/src/index.ts` - the export goes.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the ask cases.

## Steps

1. Remove the parameter and the type; `decide` is the only policy.
2. Rewrite each ask case to set `permissionMode` (`default` with a tool that writes, `bash`, or a destructive host tool), as the mode cases already do.

## Validation

- `rg -n "Asking" packages/agent-pi` finds nothing.
- The ask cases fail when `decide` answers "run" for everything.
- `pnpm typecheck` and `node_modules/.bin/vitest run packages/agent-pi` green.

## Resume

Built.
`Asking`, the fourth parameter of `piSession` and its export from `index.ts` are gone; `open` is the only seam left.
Every ask case sets `permissionMode` and drives `tool_execution_start` followed by the real hook, through `driveCall`.

- Validation: `grep -rn "Asking" packages/agent-pi` finds nothing (`rg` is not installed here).
- With `decide` temporarily returning `undefined` for every call, `asks a person before a call runs`, `opens one row for an asked call`, `does not send a client tool to its client`, `keeps a declined call cancelled` and `answers two waiting calls independently` all failed, so each case depends on the real policy.
- `node_modules/.bin/vitest run packages/agent-pi` green, 91 tests; `pnpm typecheck` green.
