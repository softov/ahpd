---
title: configure asks about the web UI
status: done
depends: []
layer: server
refs:
  - "[code://packages/server/src/commands/configure.ts#L45-L52](../../../../packages/server/src/commands/configure.ts#L45-L52) - `BACKENDS` and `FIRST`"
  - "[code://packages/server/src/commands/configure.ts#L172-L180](../../../../packages/server/src/commands/configure.ts#L172-L180) - the backend questions"
  - "[code://packages/server/src/commands/configure.ts#L294-L307](../../../../packages/server/src/commands/configure.ts#L294-L307) - the install of the missing packages"
---

## Objective

`ahpd configure` asks `Web UI?`, and a Yes installs `@ahpd/web` and enables it.

## Files

- `UPDATE: packages/server/src/commands/configure.ts:45-52` - a list of other plugins with `{ name: 'Web UI', package: '@ahpd/web' }`.
- `UPDATE: packages/server/src/commands/configure.ts:172-180` - the question for each plugin in that list.
- `UPDATE: packages/server/src/commands/configure.ts:294-307` - the plugins answered Yes in the missing packages.
- `UPDATE: packages/server/test/server-configure.test.ts` - the cases below.
- `UPDATE: docs/server/CONFIGURE.md` - the `Web UI?` question.
- `UPDATE: docs/server/INSTALL.md` - the web UI in what the script sets up.

## Steps

1. Add a list of other plugins beside `BACKENDS`, with the web UI as its one entry.
2. After the backend questions, ask `Web UI?` for that entry.
3. Make Enter take the web UI on a first run, and keep the file's answer later.
4. Switch the entry off on a No when the file names it, as the backend loop does.
5. Add a plugin answered Yes to the missing packages, when the file does not name it.
6. Keep `backends` in the result to the backends only.
7. Update the test that writes the defaults on Enter, so it installs Claude and the web UI.
8. Add a case where a No to the web UI installs only Claude.
9. Add a case where a No switches off a web UI that the file names.
10. Update the cases that count the questions, and change no other behaviour.
11. Add the question to `docs/server/CONFIGURE.md` and `docs/server/INSTALL.md`.
12. Run the server tests, and set this task and the plan row to `implemented`.

## Validation

- The tests in `packages/server/test/server-configure.test.ts` pass from the repository root.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

- **Done so far:** `configure` has an `OTHERS` list with the web UI as its one entry, asked after the backend questions. Enter takes the web UI on a first run. A later run shows the file's answer, so a plugin the file names and switches off stays off. A Yes adds `@ahpd/web` to the missing packages, and a No on a named entry writes `enabled: false`. The `backends` result holds the backends only. `docs/server/CONFIGURE.md` and `docs/server/INSTALL.md` name the question. `server-configure.test.ts` passed 38 of 38. From the repository root, `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` passed, and the full suite passed 6476 tests with 29 skipped (387 files passed, 1 skipped).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** the web UI is not a backend. The message `Every backend is already named` does not count it. A daemon with only the web UI still refuses to start.
