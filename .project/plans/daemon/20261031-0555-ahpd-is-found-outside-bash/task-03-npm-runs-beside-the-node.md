---
title: npm runs beside the daemon's Node
status: done
depends: []
layer: server
refs:
  - "[code://packages/server/src/install.ts#L76-L115](../../../../packages/server/src/install.ts#L76-L115) - `launch` and its comment"
  - "[code://packages/server/test/plugin-install.test.ts#L160-L203](../../../../packages/server/test/plugin-install.test.ts#L160-L203) - the `launch` cases"
  - "[code://.project/specs/daemon.md#L120-L126](../../../../.project/specs/daemon.md#L120-L126) - \"Windows runs npm as node\""
---

## Objective

On every platform, the daemon runs npm as its own Node with npm's `npm-cli.js`.
It runs `npm` from the PATH only when that file is not there.

## Files

- `UPDATE: packages/server/src/install.ts:76-115` - look for `npm-cli.js` on every platform, and say so in the comment.
- `UPDATE: packages/server/test/plugin-install.test.ts:160-203` - change the Linux case, and add the Unix cases.
- `UPDATE: .project/specs/daemon.md:120-126` - the requirement covers every platform.

## Steps

1. In `launch`, keep the program unchanged when it is not `npm`.
2. Take `env.npm_execpath` when its base name is `npm-cli.js` and it exists, on every platform.
3. Else, on Windows, take `node_modules/npm/bin/npm-cli.js` in the folder of `execPath`, as today.
4. Else, on any other platform, take `../lib/node_modules/npm/bin/npm-cli.js` from the folder of `execPath`.
5. Use `posix` paths for every platform but Windows, and `win32` paths for Windows.
6. When `launch` finds a path, answer `execPath` as the command and the path before the arguments, with no shell.
7. When `launch` finds no path on Windows, answer the shell with quoted arguments, as today.
8. When `launch` finds no path on any other platform, answer `npm` by its name with no shell.
9. Change the Linux test at line 169 to expect `/usr/bin/node` and the `npm-cli.js` beside it.
10. Add a test: on Linux with no `npm-cli.js`, `launch` answers `npm` with no shell.
11. Add a test: on macOS, `launch` skips `npm_execpath` at `pnpm.cjs` and takes the file beside `execPath`.
12. Change the requirement "Windows runs npm as node" in `daemon.md` to cover every platform.

## Validation

- `packages/server/test/plugin-install.test.ts` passes, with the changed and new cases.
- `pnpm typecheck` is clean.
- By hand: a plugin install from a daemon under nvm runs the npm beside that Node.

## Resume
