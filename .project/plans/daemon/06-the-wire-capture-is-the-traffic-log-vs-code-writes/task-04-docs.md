---
title: The docs describe the capture as VS Code's traffic log
status: done
depends: [task-01-a-capture-line-is-vs-codes-line.md, task-02-the-capture-rolls-and-caps.md, task-03-the-capture-is-owner-only.md]
layer: "docs"
refs:
  - "[code://docs/DAEMON.md#L157](../../../../docs/DAEMON.md#L157) - the `--wire` row"
  - "[code://docs/AHP.md#L801-L808](../../../../docs/AHP.md#L801-L808) - where a capture and `pnpm wire` are described"
---

## Objective

A reader of `docs/DAEMON.md` knows a capture is in VS Code's shape, rolls at 75 MiB into five files, and is owner-only.

## Files

- `UPDATE: docs/DAEMON.md:157` - the row says the shape, the roll and the mode.
- `UPDATE: docs/AHP.md:801-808` - one line that a VS Code capture is checked the same way.

## Steps

1. Rewrite the row in one sentence per fact.
2. Say the capture holds tokens, which is why it is `0600`.

## Validation

- Read against the code by hand.
