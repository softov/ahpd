---
title: The denial, the end-of-run sweep, cancel and a session with no directory are pinned by tests
status: todo
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/session.ts#L514-L536](../../../../packages/agent-cofold/src/session.ts#L514-L536) - `apply`: the `tool.denied`, declined approval and `run.finished` settlements"
  - "[code://packages/agent-cofold/src/session.ts#L191](../../../../packages/agent-cofold/src/session.ts#L191) - `where`"
  - "[code://test/agent-cofold-tools.test.ts#L73-L100](../../../../test/agent-cofold-tools.test.ts#L73-L100) - `open`, the session helper the new cases reuse"
  - "file:///github/cofold/packages/tools/src/shell.ts - `execShell`, which kills the command's process group on the run's signal"
---

## Objective

Every path that sends an edit's `after`, the kill of a cancelled shell command, and the tools of a session with no working directory each have a test that fails when the code that serves them is removed.

## Files

- `UPDATE: test/agent-cofold-tools.test.ts` - the four cases below.

## Steps

1. Denial: in `plan`, a `write_file` call; record `onFileEdit` calls and emitted actions in one ordered log, and assert the `after` comes before the call's `chat/toolCallComplete`; the end-of-run sweep would also send it, but only after that completion, so the order is what proves the `tool.denied` line at `session.ts:522`.
2. Sweep: in `default`, a `write_file` that asks, then `session.cancel('t1')`; assert `before` then `after` and a `chat/turnCancelled`; delete the sweep at `session.ts:533-535` locally and check the case fails; if the declined-approval path settles it instead, find the ending only the sweep covers (a `session.close()` during the ask is the next candidate) and record which in *Resume*.
3. Cancel: in `bypassPermissions`, `shell_exec` with `sleep 30 & echo $! > child.pid; wait`; once `child.pid` exists, cancel the turn; assert the turn is cancelled and `process.kill(pid, 0)` throws `ESRCH` for the backgrounded child, which proves the whole group is killed, not only `sh`.
4. No directory: a session created without `workingDirectory`, in `bypassPermissions`, is offered `shell_exec` and `read_file`, and `shell_exec` of `pwd` prints `process.cwd()`, per [decision: a session without a directory keeps its tools](../../../decisions/a-session-without-a-directory-keeps-its-tools.md).

## Validation

- These pin current behaviour, so they pass on the current code; each one is checked by removing the line it covers (steps 1 and 2) or by the kill being skipped (step 3), and the case failing.
- `node_modules/.bin/vitest run test/agent-cofold-tools.test.ts` green, in under ten seconds.

## Resume
