---
title: A refused protocol is written again
status: implemented
depends: []
layer: "tunnel-devtunnel"
refs:
  - "[code://packages/tunnel-devtunnel/src/service.ts#L409-L418](../../../../packages/tunnel-devtunnel/src/service.ts#L409-L418) - the two port writes"
  - "[code://packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts](../../../../packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts) - the service tests and their stand-in management client"
---

## Objective

`add` and `access` write a port that the tunnel holds with another protocol, by removing it and writing it again.

## Files

- `UPDATE: packages/tunnel-devtunnel/src/service.ts:409-418` - `add` and `access` recover from the protocol refusal.
- `UPDATE: packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts` - cases for the refusal.

## Steps

1. Add a function to `service.ts` that finds "The tunnel port protocol cannot be changed" in an error's text.
2. Add a function that writes a port, and on that refusal calls `deleteTunnelPort` and writes the port again.
3. Use it in `add`, in place of the bare `createOrUpdateTunnelPort`.
4. Use it in `access`, in place of the bare `updateTunnelPort`.
5. Pass any other error on unchanged.
6. Write a comment that cites VS Code's `dev_tunnels.rs#L1119-L1141`.

## Validation

- Test a first write that the stand-in client refuses with the text. Expect a delete, a second write, and the URL.
- A test where `access` gets the same refusal and recovers.
- Test another error. Expect it to pass on, with no delete.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/tunnel-devtunnel` passes.

## Resume

- **Done so far:** `writePort` in `packages/tunnel-devtunnel/src/service.ts` writes a port through the `Host`.
  When the service answers "The tunnel port protocol cannot be changed" it takes the port off with `Host.remove` and writes it again with `Host.add`.
  `sdkService.add` and `sdkService.access` both go through it, and `access` refreshes the relay after a recovery.
  `fakeCloud` in `packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts` now answers a `refuse` text for the first write of a kind.
  Three service cases cover the add refusal, the access refusal and another error.
- **Next action:** the reviewer runs the suite and commits.
  Nothing is committed here.
- **Files:** `packages/tunnel-devtunnel/src/service.ts`, `packages/tunnel-devtunnel/test/tunnel-devtunnel.test.ts`, this task file, the plan and `implemented.md`.
- **Open questions:** none.
- **Departures:** the recovery sits in `sdkService`, one layer above the task's `service.ts:409-418`, because the stand-in client is the `Host`.
  A recovery inside `sdkCloud` could not be reached by the tests.
  The retry writes through `Host.add` on both paths, because `updateTunnelPort` sends `If-Match: *` and a port cannot be updated after a delete.
- **Watch out for:** `packages/tunnel-devtunnel/tsconfig.json` has no `paths` for `@ahpd/sdk`, so a fresh worktree resolves it only after `pnpm exec tsc -p packages/sdk`.
  With that build, `pnpm exec tsc -p tsconfig.json --noEmit` passes in the package.
  The root `pnpm exec tsc -p tsconfig.json --noEmit` passes without it, and it covers the package's source and its tests.

