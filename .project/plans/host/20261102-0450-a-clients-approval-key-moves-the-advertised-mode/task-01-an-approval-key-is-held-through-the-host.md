---
title: An approval key is held through the host
status: done
depends: []
layer: "sdk test"
refs:
  - "[code://packages/sdk/test/conformance.test.ts#L935-L960](../../../../packages/sdk/test/conformance.test.ts#L935-L960) - the continuation's case for `mode`"
---

## Objective

A client's `autoApprove` reaches Claude through the host, and every client holds the permission mode it moved.
A value neither name has is refused naming the value.

## Files

- `UPDATE: packages/sdk/test/conformance.test.ts:960` - a case after the continuation's: two approval levels, then an unknown mode.

## Steps

1. Send `autoApprove: assisted`, and read the answer and the served `permissionMode`.
2. Send `autoApprove: autopilot`, and read the served `permissionMode`.
3. Send `mode: yolo`, and read the refusal and the served `permissionMode`.
4. Run the case on main's code and on the continuation.

## Validation

- On the continuation the case passes, with the conformance file whole.
- On main's code the served `permissionMode` stays `default` after `autoApprove: assisted`.

## Resume

Done 2026-11-02 in `4392a0fd`; [implemented.md](implemented.md) says what was verified.
