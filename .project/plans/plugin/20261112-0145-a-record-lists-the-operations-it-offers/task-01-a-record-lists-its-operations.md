---
title: A record lists the operations it offers
status: implemented
depends: []
layer: "sdk, tunnel-devtunnel"
refs:
  - "[code://packages/sdk/src/types/kinds.ts#L44-L102](../../../../packages/sdk/src/types/kinds.ts#L44-L102) - `KindOperation` gains the function, the record type gains the field"
  - "[code://packages/sdk/src/tunnels/channel.ts#L279-L333](../../../../packages/sdk/src/tunnels/channel.ts#L279-L333) - the host's operations for each kind"
  - "[code://packages/sdk/src/clients/channel.ts#L192](../../../../packages/sdk/src/clients/channel.ts#L192) - the clients channel's operations"
  - "[code://packages/sdk/src/kinds/operations.ts#L60-L140](../../../../packages/sdk/src/kinds/operations.ts#L60-L140) - the checks of `x-ahpd/invokeOperation`"
  - "[code://packages/tunnel-devtunnel/src/kind.ts#L90-L104](../../../../packages/tunnel-devtunnel/src/kind.ts#L90-L104) - devtunnel's own operations"
---

## Objective

Each record in `x-ahpd-tunnels` and `x-ahpd-clients` carries `operations`, the ids of the list operations it offers now. `x-ahpd/invokeOperation` refuses an id the target record does not offer.

## Files

- `UPDATE: packages/sdk/src/types/kinds.ts:44-102` - `KindOperation` gains an optional host-side function that answers whether a record offers it; the record type gains `operations`.
- `UPDATE: packages/sdk/src/tunnels/channel.ts:279-333` - each published record carries its ids; Enable and Disable follow `enabled`.
- `UPDATE: packages/sdk/src/clients/channel.ts` - each client record carries its ids.
- `UPDATE: packages/sdk/src/kinds/operations.ts` - the target check refuses an id the record does not list.
- `UPDATE: packages/tunnel-devtunnel/src/kind.ts:90-104` - Start for a tunnel that is not running, Stop and Restart for one that is.
- `UPDATE: packages/sdk/test/tunnels-channel.test.ts` - the record's ids and the refusal.
- `UPDATE: packages/tunnel-devtunnel/test/tunnel-devtunnel-kind.test.ts` - devtunnel's ids by status.

## Steps

1. Add the function to `KindOperation`. Leave it out of the state a client gets.
2. Add `operations: string[]` to each record a tunnels or clients channel publishes.
3. Offer Enable only on a record with `enabled` false, and Disable only on one with `enabled` true.
4. Offer Edit and Remove on every record, as today.
5. Offer a kind's own operation when its function answers true, and always when it has none.
6. In devtunnel, offer Start when the status is not `running`, and Stop and Restart when it is. Offer Anonymous access always.
7. Refuse in `invokeOperation` an operation id that the target record's `operations` does not hold, with the id in the error.
8. Write a comment at the function on `KindOperation` that a `when` condition is a later idea, with the path `.project/ideas/an-operation-says-when-it-applies.md`.

## Validation

- A test where an enabled, running devtunnel record lists Disable, Stop, Restart and Anonymous access, and not Enable or Start.
- A test where a disabled record lists Enable and not Disable.
- A test where `invokeOperation` refuses Enable on an enabled record.
- `pnpm schema` once, then the sdk suite and the tunnel-devtunnel suite pass.

## Resume

Implemented 2026-11-11 in the worktree; the reviewer commits. Files changed:

- `packages/sdk/src/types/kinds.ts` - `KindOperation.offered`, with the comment naming `.project/ideas/an-operation-says-when-it-applies.md`.
- `packages/sdk/src/kinds/operations.ts` - `OperationChannel.offers`, and the refusal in `invokeOperation`.
- `packages/sdk/src/tunnels/channel.ts` - each row's `operations`, `offers`, and the module's note.
- `packages/sdk/src/clients/channel.ts` - each row carries `operations: ['drop']`.
- `packages/tunnel-devtunnel/src/kind.ts` - Start, Stop and Restart conditions.
- `packages/sdk/test/tunnels-channel.test.ts` - the record ids and the refusal.
- `packages/tunnel-devtunnel/test/tunnel-devtunnel-kind.test.ts` - devtunnel's ids by status.

Checked: `pnpm exec tsc -p tsconfig.json --noEmit` at the root passes, and the sdk package check passes too. The tunnel-devtunnel package check names `@ahpd/sdk` from `dist`, which is not built in this worktree, so the root checker is what covers that package.

