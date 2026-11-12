---
title: takeOut names what putIn copied
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/machines.ts#L210-L232](../../../../packages/sdk/src/host/machines.ts#L210-L232) - `putIn` and `takeOut`"
---

## Objective

`takeOut` sends only the paths `putIn` copied for the session, and sends nothing for a disposable machine's last session.

## Files

- `UPDATE: packages/sdk/src/host/machines.ts:210-232` - a per-session set of copied paths, filled by `putIn` and read by `takeOut`.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:496-516` - teardown skips `takeOut` for a disposable machine that leaves with this session.
- `UPDATE: packages/sdk/test/` - cases for no attachment, a kept machine and a disposable machine.

## Steps

1. Add a `Map` from session URI to the set of copied paths in `machines.ts`.
2. Add each path to the set after `putIn` copies it.
3. In `takeOut`, send the set and delete it, and return when it is empty.
4. In teardown, skip `takeOut` when the machine is disposable and this session is its last.
5. Write the sdk cases with a fake port that records `takeOut`.

## Validation

- The new case with no attachment sees no `takeOut` call.
- The new case with a kept machine sees only the copied paths.
- The new case with a disposable machine's last session sees no `takeOut` call.
- `pnpm typecheck` and the sdk suite pass.

## Resume

Implemented 2026-11-12 in the worktree; the reviewer commits. Files changed:

- `packages/sdk/src/host/machines.ts` - the per-session set of copied paths, `takeOut` sending it, and `leavesWith` answering whether a disposable machine goes with the session.
- `packages/sdk/src/host/lifecycle.ts` - teardown calls `leavesWith` and skips `takeOut` for the machine that goes with the session.
- `packages/sdk/test/host-machine-attachments.test.ts` - the kept-machine case now expects only the copied path, and new cases cover no attachment and a disposable machine.

The port has no question that reads a machine's disposable label, so the host records each machine it makes from a `disposable:` source.
Checked with `pnpm exec tsc -p tsconfig.json --noEmit` at the root. No vitest run; Softov runs the suites.
