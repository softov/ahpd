---
title: The Claude folders are watched
status: done
depends: []
layer: agent-claude
refs:
  - "[code://packages/sdk/src/sessions/changes.ts#L1921-L1984](../../../../packages/sdk/src/sessions/changes.ts#L1921-L1984) - the debounce, the name filter and the `error` handler to copy"
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L443-L554 - the folders and names VS Code watches
---

## Objective

A function watches the Claude folders of the scopes it is given, and calls back once after a burst of changes.
A folder that is not there yet is watched from its parent, so the first file written into it is seen.

## Files

- `CREATE: packages/agent-claude/src/session/watch.ts` - `watchFolders`, the watcher of the personal and project Claude folders.
- `CREATE: packages/agent-claude/test/watch.test.ts` - the tests of the watcher, on a temporary folder.

## Steps

1. Add `watchFolders({ configDir, cwd }, onChange)` to `watch.ts`, which returns a `close` function.
2. Watch `configDir` and `<cwd>/.claude` with `fs.watch` and `recursive: true`.
3. Watch `cwd` without `recursive`, for `CLAUDE.md` and `CLAUDE.local.md` only.
4. Call `onChange` for a change under `agents`, `skills`, `commands`, `rules` or `plugins`.
5. Call `onChange` for a change to `CLAUDE.md`, `CLAUDE.local.md`, `settings.json` or `settings.local.json`.
6. Ignore any other name, such as a transcript under `projects` or a file under `todos`.
7. Call `onChange` once, 300 ms after the last change of a burst.
8. When a watched folder is missing, watch its parent, and start the folder's watch when it appears.
9. On an `error` from a handle, close that handle only, as `changes.ts` does.
10. Throw nothing when `fs.watch` fails on every folder, and return a `close` that does nothing.
11. In `close`, close every handle and clear the timer, so no `onChange` comes after it.
12. Write `watch.test.ts` with one case for each of steps 4, 6, 7, 8 and 11.

## Validation

- `packages/agent-claude/test/watch.test.ts` passes on Linux, and on Windows CI.
- `pnpm typecheck` is clean.

## Resume

