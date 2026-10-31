---
title: The case driver requires every dispatch answered once
status: planned
depends: []
layer: host
refs:
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts) - `driven`, which sends a case's actions and reads the state back"
---

## Objective

The protocol case driver numbers each dispatch as a client does and requires, for every action a case sends, exactly one envelope carrying its origin: an echo of any type, or a refusal.

## Files

- `UPDATE: packages/sdk/test/ahp-test-cases.test.ts` - dispatches carry a `clientSeq`; `driven` counts the envelopes carrying each one's origin; every case expects one answer per action.

## Steps

1. Number the dispatches and count the answers.
2. Run every case on `08b1d57a` and record each one that goes unanswered.

## Validation

- On `08b1d57a`, the cases that go unanswered are listed and each is one of this plan's gaps.
- After tasks 02 and 03, every case passes.
