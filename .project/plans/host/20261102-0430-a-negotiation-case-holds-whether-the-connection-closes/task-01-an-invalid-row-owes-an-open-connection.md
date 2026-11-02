---
title: An invalid row owes an open connection
status: todo
depends: []
layer: "sdk test"
refs:
  - "[code://packages/sdk/test/ahp-test-cases.test.ts#L303-L341](../../../../packages/sdk/test/ahp-test-cases.test.ts#L303-L341) - the negotiation cases"
---

## Objective

An invalid offer owes `-32602` and a connection still open, stated in the case rather than read off the host.

## Files

- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:303-309` - the comment says the connection stays open after a malformed offer.
- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts:328` - an invalid row owes `closed: false`.

## Steps

1. Set the invalid row's owed `closed` to `false`.
2. Say in the comment that the interop host leaves the connection open after a malformed offer.
3. Make the host close the connection on a malformed offer, and run the old and the new cases against it.

## Validation

- The 22 negotiation rows pass on the host as it stands.
- With the host closing on a malformed offer, the new rows 12 to 22 fail and the old ones pass.

## Resume

Not started.
