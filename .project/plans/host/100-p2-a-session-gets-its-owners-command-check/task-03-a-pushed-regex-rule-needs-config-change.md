---
title: A pushed regex rule needs config:change
status: done
depends: [task-01-the-check-reads-the-owners-connection.md]
layer: sdk
refs:
  - "[code://packages/sdk/src/host/gate.ts#L291-L299](../../../../packages/sdk/src/host/gate.ts#L291-L299) - `dispatchNeeds`, the grant a root push needs"
  - "[code://packages/sdk/src/access/commandautoapprover.ts#L450-L474](../../../../packages/sdk/src/access/commandautoapprover.ts#L450-L474) - `ruleRegexOf`, how a `/.../` key is read"
  - "[code://packages/sdk/src/access/commandautoapprover.ts#L817-L942](../../../../packages/sdk/src/access/commandautoapprover.ts#L817-L942) - `DEFAULT_TERMINAL_AUTO_APPROVE_RULES`, VS Code's default keys"
  - "[code://packages/sdk/test/users-gate-dispatch.test.ts](../../../../packages/sdk/test/users-gate-dispatch.test.ts) - the tests of `dispatchNeeds`"
  - https://github.com/microsoft/vscode/blob/a959ba62444/src/vs/platform/agentHost/common/agentHostSchema.ts#L707-L727 - VS Code pushes the effective rules, with its default keys
---

## Objective

A member who pushes `terminalAutoApproveRules` with a slow regular expression can stop the daemon for every person.
A pushed `/.../` key that is not one of VS Code's default keys now needs `config:change`.
A plain key and a default `/.../` key need no grant, as now.
VS Code pushes its default keys on every connect, so a push of only those keys and plain keys still goes through.

## Files

- `UPDATE: packages/sdk/src/host/gate.ts:291-299` - `dispatchNeeds` returns `config:change` for a pushed `/.../` key that is not a default key.
- `UPDATE: packages/sdk/src/access/commandautoapprover.ts:450-474` - export the test that says a key is written `/.../`, so the gate and `ruleRegexOf` read a key the same way.
- `UPDATE: packages/sdk/test/users-gate-dispatch.test.ts` - the cases of this task.
- `UPDATE: docs/server/CONFIGURE.md` - the Terminal rules section says which pushed keys need `config:change`.
- `UPDATE: docs/sdk/AHP.md` - the `root/configChanged` row says the same.

## Steps

1. Export a function from `commandautoapprover.ts` that tests for the `/.../` form of a key, and use it in `ruleRegexOf`.
2. In `dispatchNeeds`, read `terminalAutoApproveRules` from a push that sets only `PER_CONNECTION` keys.
3. Return `config:change` when that object has a `/.../` key that `DEFAULT_TERMINAL_AUTO_APPROVE_RULES` does not have.
4. Keep the `trust:push` answer for `workspaceTrust` when the push also has that key and no other grant applies.
5. Test a push of a plain key, which needs no grant.
6. Test a push of a default `/.../` key, which needs no grant.
7. Test a push of `/(a+)+$/`, which needs `config:change`.
8. Test a push of the whole default table with one plain key, which needs no grant.
9. Test that a member without `config:change` gets the push refused, and the root host takes it.
10. Update the two docs.
11. Set this task and the plan row to `implemented`.

## Validation

- The sdk tests pass from the repository root.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm boundary` pass.

## Resume

- **Done so far:** 2026-10-20: the key test exported from `commandautoapprover.ts`, the `config:change` answer in `dispatchNeeds`, the cases in `users-gate-dispatch.test.ts`, and both docs.
- **Next action:** none - implemented.
- **Open questions:** none.
- **Watch out for:** the gate compares keys as strings. A key that only a newer VS Code table has needs `config:change`.
