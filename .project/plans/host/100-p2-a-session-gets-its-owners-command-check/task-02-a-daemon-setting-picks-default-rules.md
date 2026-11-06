---
title: The daemon setting picks the default rules
status: done
depends: [task-01-the-check-reads-the-owners-connection.md]
layer: sdk, server
refs:
  - "[code://packages/server/src/config.ts#L247-L258](../../../../packages/server/src/config.ts#L247-L258) - daemon keys that reach a session"
  - "[code://packages/server/src/commands/run.ts#L732-L741](../../../../packages/server/src/commands/run.ts#L732-L741) - where they reach the host"
---

## Objective

`terminalAutoApproveDefaults` says which rules apply when the owner's connection pushed none.
`vscode`, the default, is VS Code's table; `none` makes every command ask.

## Files

- `UPDATE: packages/server/src/config.ts:247-258` - the `terminalAutoApproveDefaults` key and its doc.
- `UPDATE: packages/server/src/commands/run.ts:732-741` - pass the key to the host.
- `UPDATE: packages/sdk/src/types/host.ts` - the host option.
- `UPDATE: packages/sdk/src/host/spawn.ts` - the check uses the table when no rules came.
- `UPDATE: packages/server/test` - the config parse, and a refused value.
- `UPDATE: packages/sdk/test` - no pushed rules with each value.

## Steps

1. Add `terminalAutoApproveDefaults` to the daemon config, with `vscode` as the default.
2. Refuse any other value at start.
3. Pass the value to the host as a host option.
4. Use `DEFAULT_TERMINAL_AUTO_APPROVE_RULES` when the value is `vscode` and the connection pushed no rules.
5. Use no rules when the value is `none`.
6. Write the tests.
7. Set this task and the plan row to `implemented`.

## Validation

- The server and sdk tests pass.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm boundary` pass.

## Resume

- **Done so far:** 2026-10-18: the daemon key with its default and its refusal, and the fallback in the check. Tests in both packages.
- **Next action:** none - implemented.
- **Open questions:** none.
- **Watch out for:** an empty object pushed by a client counts as "no rules", as VS Code reads it.
