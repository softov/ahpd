---
title: A nested start that fails says why
status: todo
depends: [task-04-nested-instead-of-refused.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/computers.ts](../../../../packages/sdk/src/computers.ts) - where the proxy is started"
---

## Objective

A nested host that is missing, exits before `initialize`, has another protocol version, or cannot create its session ends the outer session with a sentence that carries the last lines of its stderr.

## Files

- `UPDATE: packages/sdk/src/nested.ts`

## Steps

1. A timeout on `initialize`, so a host that never answers is a sentence too.

## Validation

- One test per failure, each asserting the sentence.

## Resume
