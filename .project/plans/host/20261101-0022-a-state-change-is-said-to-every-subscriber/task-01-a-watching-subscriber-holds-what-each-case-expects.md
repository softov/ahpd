---
title: A watching subscriber holds what each case expects
status: planned
depends: []
layer: host
refs:
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts) - `driven`, `HOST_OWNS`"
---

## Objective

The protocol case driver holds a client that subscribes before a case's actions and sends nothing to the case's expectation: its snapshot with every action it is told of, through the protocol's reducer, on the keys the driver compares. Case 272 is driven as the protocol writes it.

## Files

- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts` - the watching subscriber and its assertion; 272's `HOST_OWNS` entry and the paragraph that kept it go, and the counts move with it.

## Steps

1. Add the subscriber and run every case on `5da31824`: 272 is the one case it finds, its `status` short of the archived bit.
2. Take 272 off `HOST_OWNS`.

## Validation

- On `5da31824` case 272 fails, on the state and on the watching subscriber; every other case passes both.
- After task 02 every case passes both.
