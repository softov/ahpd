---
title: A teardown waits for its children
status: implemented
depends: []
layer: "sdk and computer tests"
refs:
  - "[code://packages/sdk/test/nested-process.test.ts](../../../../packages/sdk/test/nested-process.test.ts) - the teardown"
  - "[code://packages/computer/test/computer-disposable.test.ts](../../../../packages/computer/test/computer-disposable.test.ts) - the teardown"
---

## Objective

The nested-process teardown waits for each killed inner host to exit, and both teardowns try a removal again.

## Files

- `UPDATE: packages/sdk/test/nested-process.test.ts` - `exited`, and an async teardown.
- `UPDATE: packages/computer/test/computer-disposable.test.ts` - removals that try again.
- `UPDATE: .project/problems/a-test-removes-its-folder-while-a-child-writes-in-it.md` - the two teardowns fixed, the others still open.

## Steps

1. Add `exited(child, ms)`, which waits for a child's exit, 5 s at most.
2. Make the teardown kill each child, wait for all of them, and then remove the folders.
3. Give each removal `maxRetries: 10` and `retryDelay: 100`, here and in the disposable teardown.
4. Add to the problem file the two teardowns this task fixes, and the ones it leaves.

## Validation

- The nested-process file passes.

## Resume

Implemented 2026-11-13. See [implemented.md](implemented.md).
