---
title: ahpd takes the cofold release
status: todo
depends: [task-02-a-write-rechecks-the-file-it-opened.md, task-03-a-stale-write-is-refused.md]
layer: "agent-cofold"
refs:
  - npm://@cofold/tools@^0.1.1 - the range ahpd takes today
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L324-L335](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L324-L335) - edits an unread file"
---

## Objective

After Softov releases `@cofold/tools` through cofold's `release.yml`, ahpd's range takes it and the suite passes.

## Files

- `UPDATE: packages/agent-cofold/package.json:68` - the `@cofold/tools` range, and `pnpm-lock.yaml`.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts:324-335` - the `onFileEdit` case edits a file the session never read, so its script reads `a.txt` first.
- `UPDATE: packages/agent-cofold/test/` - any other case that writes or edits an existing file unread, found by running the suite.

## Steps

1. Bump the range, `pnpm install --no-frozen-lockfile` once, run the gates.
2. Add a `read_file` before each write or edit of an existing file in the agent-cofold tests the new refusal fails.

## Validation

- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
