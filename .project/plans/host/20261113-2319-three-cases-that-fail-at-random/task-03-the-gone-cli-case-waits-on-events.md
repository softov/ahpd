---
title: The gone-CLI case waits on events
status: implemented
depends: []
layer: "computer tests"
refs:
  - "[code://packages/computer/test/computer-spawn.test.ts](../../../../packages/computer/test/computer-spawn.test.ts) - the case"
---

## Objective

The case imports the backend outside its limit, waits for the stand-in CLI to have run, and waits for the error.

## Files

- `UPDATE: packages/computer/test/computer-spawn.test.ts`.
- `DELETE: .project/problems/the-case-of-a-claude-cli-that-is-gone-waits-on-fixed-times.md`.

## Steps

1. Import `claude.js` at the top of the file.
2. Make the stand-in CLI write a file before it exits.
3. Wait for the file in place of the 600 ms.
4. Wait for the `chat/error` with `vi.waitFor` in place of the 100 ms.
5. Give the case 30 s.
6. Delete the problem file.

## Validation

- The file passes three times in a row on Softov's machine.

## Resume

Implemented 2026-11-13. See [implemented.md](implemented.md).
