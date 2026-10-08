---
title: Update answers what moved, with each version before and after
status: done
depends: [task-10-install-refuses-a-package-that-is-not-a-plugin.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/plugin.ts#L148-L171](../../../../packages/server/src/commands/plugin.ts#L148-L171) - `output({ plugins: names })`, the names npm was asked to move"
  - "[code://packages/server/src/install.ts](../../../../packages/server/src/install.ts) - `updatePlugins` returns those names"
---

## Objective

`plugin update`'s answer, for `--json` and over HTTP, is `{ plugins: [{ name, from, to }] }` holding only the packages whose version moved, and an empty list when nothing did.

## Steps

1. Failing first: an update where nothing moved answers `plugins: []`; one where a package moved answers its name, `from` and `to` as read from disk.

## Validation

- `pnpm typecheck`, `pnpm boundary`, full `pnpm test` 3 times.

## Resume

Implemented 2026-09-29 in the `fixes-0-8-1` worktree, test-first.
- In code: `updatePlugins` returns `Moved[]`, `{ name, from?, to? }` for each package whose version on disk changed across the npm call, read as the printed lines are; `from` or `to` is absent when that side is not installed. The `plugin.update` action answers `{ plugins: moved }`, and says `restart` (and prints the restart line) only when something moved and a daemon is running or serving.
- Tests: the unit cases now expect the moved objects, and `[]` when nothing moved. The fake npm gained `FAKE_NPM_LANDS="<name> <version>"`, which writes that package under the `--prefix` directory's `node_modules`; the HTTP case updates `left-pad` 1.0.0 to 1.3.0 and answers `{ plugins: [{ name: 'left-pad', from: '1.0.0', to: '1.3.0' }], restart: true }`, then updates again and answers `{ plugins: [] }`. Failing first: every case received the names npm was asked to move, and HTTP answered `plugins: ['left-pad']`.
- `pnpm typecheck` 0, `pnpm boundary` 0, full `pnpm test` 0 three times, 1750 passed each.
