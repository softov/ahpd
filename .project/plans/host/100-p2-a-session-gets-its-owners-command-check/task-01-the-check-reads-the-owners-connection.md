---
title: The check reads the owner's connection
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L648-L661](../../../../packages/sdk/src/host/spawn.ts#L648-L661) - `trustedBy`"
  - "[code://packages/sdk/src/host/gate.ts#L342](../../../../packages/sdk/src/host/gate.ts#L342) - `PER_CONNECTION`"
---

## Objective

`Start.getAutoApproval` answers from the owner's connection, as `trustedBy` does.
host/101 adds its rule to it later.

## Files

- `UPDATE: packages/sdk/src/types/agent.ts:183` - the `getAutoApproval` field and its doc.
- `UPDATE: packages/sdk/src/host/spawn.ts:648-661` - build the check beside `trustedBy`.
- `UPDATE: packages/sdk/src/host/gate.ts:342` - add the three keys to `PER_CONNECTION`.
- `UPDATE: packages/sdk/src/host/root.ts:557-567` - show the three keys per connection.
- `UPDATE: packages/sdk/test/root-config.test.ts:185-212` - the keys move to the per-connection list.
- `UPDATE: packages/sdk/test` - the check with one client, two clients and the check turned off.

## Steps

1. Add `getAutoApproval` to `Start`; it takes a tool kind, the command line and the shell.
2. Make it return a `ToolCallConfirmationReason` or nothing.
3. Find the owner's connection as `trustedBy` does, and return nothing when there is none.
4. Return nothing when that connection set `terminalAutoApproveEnabled` to `false`.
5. Call the approver with the connection's rules, its edit rules and the session's working folder.
6. Return `not-needed` only for `approved`.
7. Add the three keys to `PER_CONNECTION`, and update `root.ts` and the root config test.
8. Write the tests.
9. Set this task and the plan row to `implemented`.

## Validation

- The sdk tests pass for one client, two clients and a client with the check turned off.
- A member's push of the three keys needs no `config:change`.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm boundary` pass.

## Resume

- **Done so far:** 2026-10-18: the check on `Start`, built in `spawn.ts`, and the three keys per connection. Tests in `autoapproval.test.ts` and `root-config.test.ts`.
- **Next action:** none - implemented.
- **Open questions:** none.
- **Watch out for:** `trustedBy` returns `false` with no sender; the check returns nothing in the same case. The protocol's `ToolCallConfirmationReason` is an ambient const enum, so `spawn.ts` writes `'not-needed'` as that type rather than importing the value.
