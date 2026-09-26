---
title: The capture rolls at 75 MiB, keeps five files, and caps a line
status: todo
depends: [task-01-a-capture-line-is-vs-codes-line.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/run.ts#L344-L360](../../../../packages/server/src/commands/run.ts#L344-L360) - the tap whose writer this bounds"
  - "[code://packages/server/src/commands/run.ts#L275-L279](../../../../packages/server/src/commands/run.ts#L275-L279) - `diagnostics.logs`, which must list every file"
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/ahpJsonlLogger.ts - `DEFAULT_MAX_FILE_SIZE_BYTES`, `DEFAULT_MAX_FILES`, `MAX_LOG_LINE_LENGTH`, `MAX_LOGGED_STRING_LENGTH` and `stringifyAhpLogEntryTruncated`
---

## Objective

A capture never passes five files of 75 MiB, and no line passes 1 MiB.

## Files

- `CREATE: packages/server/src/wire.ts` - the writer: append, roll, cap a line.
- `UPDATE: packages/server/src/commands/run.ts:344-360` - the tap hands its line to the writer.
- `UPDATE: packages/server/src/commands/run.ts:275-279` - `diagnostics.logs` lists the capture's files, oldest first.
- `CREATE: test/wire-writer.test.ts` - the cases below.

## Steps

1. Past 75 MiB, rename `<file>.3` to `<file>.4` down to `<file>` to `<file>.1`, dropping the fifth, and start `<file>` again.
2. A line longer than 1 MiB is serialised again with every string over 16 KiB cut, and `_ahpLog.truncated` set to `true`.
3. Take the sizes as writer options with VS Code's values as defaults, so a test can roll at a few bytes.
4. `diagnostics.logs` names the rotated files that exist, then `<file>`.

## Validation

- `test/wire-writer.test.ts`: with a small cap, six rolls leave five files; an oversized line is cut, is valid JSON and carries `truncated`.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.

## Resume

