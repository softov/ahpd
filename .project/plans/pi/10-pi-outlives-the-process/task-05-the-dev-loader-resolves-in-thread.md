---
title: The dev loader resolves on the main thread
status: implemented
depends: [task-01-agent-pi-loads-without-importing-pi.md]
layer: "scripts"
refs:
  - "[code://scripts/dev.mjs](../../../../scripts/dev.mjs) - registers the resolver with `register`, on its own thread"
  - "[code://scripts/dev-hooks.mjs](../../../../scripts/dev-hooks.mjs) - the async `resolve` hook"
  - "[code://docs/DAEMON.md#L549](../../../../docs/DAEMON.md#L549) - the docs name `register`"
  - "[code://package.json#L47-L49](../../../../package.json#L47-L49) - `engines.node` is `>=22`"
  - https://nodejs.org/api/module.html#moduleregisterhooksoptions - `module.registerHooks`, synchronous in-thread hooks, from Node 22.15 and 23.5
---

## Objective

Run from source with `scripts/dev.mjs`, importing pi blocks the process for about as long as it does without any hooks, instead of about four times that.

## Files

- `UPDATE: scripts/dev.mjs` - registers the resolver with `module.registerHooks` when Node has it, and with `register` otherwise.
- `UPDATE: scripts/dev-hooks.mjs` - the resolve rule is one function usable by both: synchronous for `registerHooks`, and the async export `register` loads.
- `UPDATE: docs/DAEMON.md:549` - names both.

## Steps

1. Keep the resolve rule exactly as it is; only where it runs changes.
2. Prefer `registerHooks`; fall back to `register` on a Node without it, since `engines.node` is `>=22` and `registerHooks` arrived in 22.15.

## Validation

- Measured on 2026-09-28 with a scratch copy: `import('@earendil-works/pi-coding-agent')` blocked 4288 ms under `register` and 1114 ms under `registerHooks`, and 1182 ms with no hooks; a dev daemon logged agent-pi in 4478 ms and 1041 ms.
- A dev daemon boot logs agent-pi's load in about a second.
- `packages/server/test/server-cli.test.ts` and `packages/server/test/update.test.ts`, which run through `scripts/dev.mjs`, stay green.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

Implemented 2026-09-28.
`scripts/dev-hooks.mjs` keeps the resolve rule in one function, `rewrite`, and exports it as `resolveSync` for `registerHooks` and as the async `resolve` that `register` loads.
`scripts/dev.mjs` calls `module.registerHooks` when Node has it and `module.register` otherwise.
`docs/DAEMON.md` names both and says what the fallback costs.
Timed on Node 24.19 from `packages/agent-pi`: `import('@earendil-works/pi-coding-agent')` took 4577, 4791 and 4737 ms under `register`, 1381, 1557 and 1543 ms under `registerHooks`, and 1514 and 1582 ms with no hooks.
A dev daemon with only agent-pi configured logged `plugin @ahpd/agent-pi ... in 4271 ms` before and `in 1065 ms` after.
The fallback was checked by a preload that deletes `registerHooks` from `node:module` and wraps `register`, then imports `scripts/dev.mjs`: it called `register('./dev-hooks.mjs')`, `packages/agent-pi/src/index.ts` loaded through the rewrite, which fails with `ERR_MODULE_NOT_FOUND` without hooks, and pi's import took 5176 ms, the threaded cost.
`packages/server/test/server-cli.test.ts` and `packages/server/test/update.test.ts` green, 89 tests.
`pnpm typecheck` and `pnpm boundary` green, and `pnpm test`: 106 files, 1483 tests passed.
