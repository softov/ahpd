---
title: A test reads a file before it writes it
status: todo
depends: [task-02-a-paused-run-is-answered-on-its-own-handle.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L324-L335](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L324-L335) - the `onFileEdit` case edits a file it never read"
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L262-L271](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L262-L271) - the mode table's edit rows"
  - npm://@cofold/tools@^0.3.0 - a write to a file the session did not read, or that changed since, is refused
---

## Objective

Every test that writes or edits an existing file reads it first, as a model must on tools 0.3.0.
This task replaces plugin 22 task 04.

## Files

- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts:324-335` - the script reads `a.txt` before it edits it.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts:262-271` - each edit row reads its file before the edit.
- `UPDATE: packages/agent-cofold/test/` - any other case the refusal fails, found by running the suite.

## Steps

1. Run `npx vitest run packages/agent-cofold` after task 02.
2. Find each failure whose tool result says "read it with read_file first".
3. Add a `read_file` call before the write in that case's script.
4. Add a case: cofold refuses an edit of a file the session never read, and the file stays the same.
5. Add a case: an edit after a read succeeds and reaches `onFileEdit`.

## Validation

- No test fails with "read it with read_file first" unless it expects that refusal.
- `npx vitest run packages/agent-cofold` passes.

## Resume

- The parked worktree `build-agents-cofold-uptake` has the fix for L324-335.
