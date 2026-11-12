---
title: A refused protocol is written again
status: todo
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

