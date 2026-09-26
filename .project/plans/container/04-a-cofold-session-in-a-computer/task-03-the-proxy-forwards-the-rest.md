---
title: The proxy forwards asks, config, cancel and the end
status: todo
depends: [task-02-the-proxy-forwards-turns.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/session.ts](../../../../packages/sdk/src/types/session.ts) - the `Session` methods the proxy implements"
---

## Objective

Tool confirmations, input answers, config changes, cancel, and dispose reach the inner session; the inner host's exit ends the outer session.

## Files

- `UPDATE: packages/sdk/src/nested.ts`

## Steps

1. One `Session` method at a time, each with its test.

## Validation

- `test/nested-proxy.test.ts`: a permission ask answered outside is seen inside; cancel stops the inner turn; killing the inner host ends the outer session.

## Resume
