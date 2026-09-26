---
title: The computer docs describe ociRuntime
status: todo
depends: [task-01-a-profile-names-the-oci-runtime.md]
layer: "docs"
refs:
  - "[code://docs/COMPUTER.md#L189-L225](../../../../docs/COMPUTER.md#L189-L225) - the Profiles section"
  - "[code://docs/COMPUTER.md#L277](../../../../docs/COMPUTER.md#L277) - the Security section"
---

## Objective

`docs/COMPUTER.md` says a profile may name `ociRuntime`, that `runsc` is gVisor, and that a client cannot change it.

## Files

- `UPDATE: docs/COMPUTER.md:189-225` - the field, with a one-line example.
- `UPDATE: docs/COMPUTER.md:277` - one line in Security on what gVisor adds.

## Steps

1. Add the field and the example.
2. Say Docker must have the runtime installed, and that a missing one is Docker's refusal.

## Validation

- Read against the code by hand.

## Resume

