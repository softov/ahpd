---
title: The computer docs describe ociRuntime
status: todo
depends: [task-01-a-profile-names-the-oci-runtime.md]
layer: "docs"
refs:
  - "[code://docs/COMPUTER.md#L206-L263](../../../../docs/COMPUTER.md#L206-L263) - the Profiles section"
  - "[code://docs/COMPUTER.md#L315](../../../../docs/COMPUTER.md#L315) - the Security section"
---

## Objective

`docs/COMPUTER.md` says a profile may name `ociRuntime`, that `runsc` is gVisor, and that a client cannot change it.

## Files

- `UPDATE: docs/COMPUTER.md:206-263` - the field, with a one-line example.
- `UPDATE: docs/COMPUTER.md:315` - one line in Security on what gVisor adds.

## Steps

1. Add the field and the example.
2. Say Docker must have the runtime installed, that a missing one is Docker's refusal, and that a dev container machine refuses the option.

## Validation

- Read against the code by hand.

## Resume

