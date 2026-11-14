---
title: A records channel has a listing
status: todo
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/resources/recordschannel.ts](../../../../packages/sdk/src/resources/recordschannel.ts) - the records channel that gets the listing"
  - "[code://packages/sdk/src/tunnels/channel.ts#L449-L457](../../../../packages/sdk/src/tunnels/channel.ts#L449-L457) - the hand-built channel that passes the listing on"
---

## Objective

Each records channel answers its rows, whether a reader opens the list, and whether a reader sees one row. It calls a listener after each refresh.

## Files

- `UPDATE: packages/sdk/src/resources/recordschannel.ts` - add `RecordsListing` and the `listing` field, and call the listeners after each refresh.
- `UPDATE: packages/sdk/src/tunnels/channel.ts:449-457` - pass `listing` on from the records channel.
- `UPDATE: packages/sdk/src/index.ts:133` - export the `RecordsListing` type.
- `UPDATE: packages/sdk/test/recordschannel.test.ts` - cases for the listing.

## Steps

1. Add `RecordsListing` with `rows`, `opens`, `readable` and `onRefresh`.
2. Make `opens` true for no reader, for a holder of `grant`, and for a holder of `alsoGrant`.
3. Make `readable` the channel's own test of one row.
4. Call each listener after each refresh, also when the list has no subscriber.
5. Pass `listing` on in the tunnels channel.
6. Write the test cases.

## Validation

- `packages/sdk/test/recordschannel.test.ts`: the listing reads every row, and `opens` and `readable` follow the grants.
- The same file: a refresh with no subscriber calls the listener.
- `pnpm typecheck` passes.

## Resume
