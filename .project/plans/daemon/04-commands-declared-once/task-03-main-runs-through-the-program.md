---
title: main.ts runs through the terminal program
status: todo
depends: [task-02-the-commands-are-declared.md]
layer: "server"
refs:
  - file:///github/cofold/packages/terminal/src/program.ts - `Program`
  - "[code://packages/server/src/main.ts](../../../../packages/server/src/main.ts) - the entry"
---

## Objective

`main.ts` hands `argv` to `@cofold/terminal`'s `Program` over the registry, and the hand-written parser and verb branches are gone.

## Files

- `UPDATE: packages/server/src/main.ts` - the entry, down to the program and the daemon's own run.

## Steps

1. Replace the parser and the verb branches with the program.
2. Keep `--stdio` from writing anything but frames to stdout.

## Validation

- Every test from task 01 passes unchanged.
- `ahpd --help`, `ahpd completion bash`, `ahpd status --json` by hand.

## Resume
