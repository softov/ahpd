---
title: The computer tests close what they open
status: todo
depends: [task-02-the-computer-plugin-stops-on-close.md]
layer: "computer tests"
refs:
  - "[code://packages/computer/test/computer-disposable.test.ts#L34-L43](../../../../packages/computer/test/computer-disposable.test.ts#L34-L43) - the cleanup that fails"
  - "[code://packages/computer/test/computer-disposable.test.ts#L165-L190](../../../../packages/computer/test/computer-disposable.test.ts#L165-L190) - `room`, which makes a host and never closes it"
  - "[code://packages/computer/test/devcontainer.test.ts#L26-L34](../../../../packages/computer/test/devcontainer.test.ts#L26-L34) - a cleanup that fails the same way"
  - "[code://packages/computer/test/computer-devcontainer.test.ts#L36-L46](../../../../packages/computer/test/computer-devcontainer.test.ts#L36-L46) - a cleanup that fails the same way"
---

## Objective

Every computer test closes the hosts, loads and launchers it made before it removes its folders.
`npx vitest run packages/computer` passes 10 times in a row.

## Files

- `UPDATE: packages/computer/test/computer-disposable.test.ts` - `room` keeps each host it makes; `afterEach` closes them before it removes `loose` and `state`. A load with no host, such as `again` in "gives a worktree session a git directory of its own", runs its `options.closers` in `afterEach`.
- `UPDATE: packages/computer/test/devcontainer.test.ts` - `afterEach` closes each launcher a test made before it removes `root`.
- `UPDATE: packages/computer/test/computer-devcontainer.test.ts` - the same for its hosts and loads.
- `UPDATE: packages/computer/test/*.test.ts` - every other computer test file that calls `createHost(` or `loadPlugins(` does the same: `computer-owner`, `computer-plugin`, `computer-uptime`, `computer-session`.
- `CREATE: packages/computer/test/support/closing.ts` - if more than two files need it: one helper that keeps hosts and loads and closes them all.

## Steps

1. Write the helper, or the per-file arrays.
2. Make `afterEach` async, close first, then remove the folders.
3. Remove the `maxRetries` from the removal in `computer-disposable.test.ts`. With nothing still running, a plain `rmSync` is enough, and a retry hides a writer that is still alive.

## Validation

- `for i in $(seq 1 10); do npx vitest run packages/computer || break; done` passes every time.
- A temporary probe in `afterEach`: write a marker file, wait 1.5 s, and run `find <folder> -newer <marker>`. It finds nothing in any computer test file. Remove the probe after the check.
- `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `npx vitest run` pass from the root.

## Resume
