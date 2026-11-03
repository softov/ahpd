---
title: The host lists and drops its clients
status: todo
depends:
  - task-01-a-connection-knows-its-address.md
layer: "sdk, server, docs"
refs:
  - "[code://packages/sdk/src/types/host.ts#L81-L119](../../../../packages/sdk/src/types/host.ts#L81-L119) - `NodeRegistry`, the shape `ClientRegistry` copies"
  - "[code://packages/sdk/src/host.ts#L2328-L2343](../../../../packages/sdk/src/host.ts#L2328-L2343) - `close`, where a departure is said"
  - "[code://packages/sdk/src/tunnels/channel.ts#L307-L345](../../../../packages/sdk/src/tunnels/channel.ts#L307-L345) - the records source and the snapshot with `operations`"
  - "[code://packages/sdk/src/kinds/operations.ts#L79-L95](../../../../packages/sdk/src/kinds/operations.ts#L79-L95) - `targetOf`, generalized here"
  - "[code://packages/server/src/commands/run.ts#L930-L947](../../../../packages/server/src/commands/run.ts#L930-L947) - where the channel and its operations join `invokeOperation`"
  - "[code://packages/server/src/commands/run.ts#L1045-L1049](../../../../packages/server/src/commands/run.ts#L1045-L1049) - where the channel joins `servedRecords`"
  - "[code://docs/plugins/PLUGINS.md#L1683](../../../../docs/plugins/PLUGINS.md#L1683) - the tunnels section, which the clients section copies"
---

## Objective

`x-ahpd-clients://` lists one row for each open connection, and reading it takes `client:read`.
Its state offers `drop`, which takes `client:drop`, answers the row and then closes that socket.

## Files

- `UPDATE: packages/sdk/src/types/host.ts` - add `ConnectedClient`, `ClientChange` and `ClientRegistry`, and `clients` on `Host`.
- `UPDATE: packages/sdk/src/host.ts` - serve `clients` from the set of connections, and call each watcher on an arrival and a departure.
- `UPDATE: packages/sdk/src/types/kinds.ts:25` - add `client` to `OperationScope`.
- `UPDATE: packages/sdk/src/kinds/operations.ts:79-95` - take a target for every scope other than `list`, and name the scope in each refusal.
- `CREATE: packages/sdk/src/clients/channel.ts` - `clientsChannel`, a records channel over the registry, with the `drop` operation.
- `UPDATE: packages/sdk/src/index.ts` - export `clientsChannel` and its types.
- `UPDATE: packages/server/src/commands/run.ts:930-1049` - build the channel, add its operations to `invokeOperation` and the channel to `servedRecords`, and bind the registry after the host is built.
- `UPDATE: docs/plugins/PLUGINS.md` - an `x-ahpd-clients` section after `x-ahpd-tunnels`, and `client` in the operation scopes.
- `CREATE: packages/sdk/test/clients-channel.test.ts` - the channel, the grants and the drop.
- `UPDATE: packages/sdk/test/kinds-operations.test.ts` - a `client` scope takes `target.id`, and a refusal names the scope.

## Steps

1. Add `ConnectedClient` to `types/host.ts` with `socket`, `clientId`, `name`, `address`, `forwardedFor`, `protocolVersion`, `locale`, `principal`, `watching` and `connectedAt`.
2. Add `ClientChange` as `{ socket, joined: true }` or `{ socket, joined: false }`, as `NodeChange` is.
3. Add `ClientRegistry` with `connected()`, `watch(onChange)` and `drop(socket)`, each documented.
4. Add `clients: ClientRegistry` to `Host`.
5. In `host.ts`, answer `connected()` from `connections` in arrival order, with the name from `clientNames`.
6. In `host.ts`, call each watcher after `client_connect` fires and after `connections.delete` in `close`.
7. Make `drop(socket)` close that connection's peer, and return false for a socket the set does not hold.
8. Add `client` to `OperationScope`.
9. Change `targetOf` so that any scope other than `list` takes `target: { id }`, and each message names the scope.
10. Create `clientsChannel` with a `registry()` option, read at each call, and `onProblem`.
11. Give the records source `ids()` from `connected()` and `find(id)` as the row for that socket.
12. Build the row as `id` (the socket as a string) and every other `ConnectedClient` field, with `principal` as its id.
13. Call `recordsChannel('x-ahpd-clients', source, { grant: 'client:read', describe })`, with no `ownerOf`.
14. Add `operations` to the snapshot, as the tunnels channel does.
15. Offer one operation: `id: drop`, `kind: host`, `label: Drop`, `scopes: ['client']`, `grant: client:drop` and a `confirmation`.
16. In `run`, find the row, keep it, and close the peer in a `setTimeout` of 0 ms.
17. Return the row from `run`, so the host sends the answer before the socket closes.
18. Refuse a target the registry does not hold with `-32001` and the socket id.
19. Watch the registry once it is bound, and refresh the channel on each change.
20. In `run.ts`, add the channel to `servedRecords`, and its operations to the map that `invokeOperation` reads.
21. In `run.ts`, bind `host.clients` to the channel after `createHost` returns.
22. Write the docs section with the row fields, the two grants and `forwardedFor` as a claim.
23. Say in the docs section that a drop is not a ban.
24. Add the tests named in *Files*.

## Validation

- `packages/sdk/test/clients-channel.test.ts`: two connections are two rows, and a close removes its row from every reader.
- `packages/sdk/test/clients-channel.test.ts`: the host refuses a subscribe from a reader without `client:read`.
- `packages/sdk/test/clients-channel.test.ts`: the host refuses `drop` from a caller without `client:drop`, and the socket stays open.
- `packages/sdk/test/clients-channel.test.ts`: `drop` with `client:drop` answers the row, and then the peer closes.
- `packages/sdk/test/clients-channel.test.ts`: a caller that drops its own socket receives the answer first.
- `packages/sdk/test/clients-channel.test.ts`: a dropped client id connects again and is a new row.
- `packages/sdk/test/kinds-operations.test.ts`: the host refuses a `client` operation without a target, and the message names `client`.
- Run `pnpm typecheck`. Expect no errors.
- Run `pnpm --filter @ahpd/sdk test`, and then `pnpm --filter @ahpd/server test`. Expect a pass from each.

## Resume
