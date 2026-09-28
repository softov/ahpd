---
title: A personal URL brackets an IPv6 host
status: done
depends: [task-26-addresses-read-back-as-urls.md]
layer: "server"
refs:
  - "[code://packages/server/src/config.ts#L299-L302](../../../../packages/server/src/config.ts#L299-L302) - `personalUrl`, which writes `ws://${host}:${port}`"
  - "[code://packages/server/src/commands/run.ts#L49](../../../../packages/server/src/commands/run.ts#L49) - `urlHost`, which brackets an IPv6 address"
  - "[code://packages/server/src/commands/run.ts#L38](../../../../packages/server/src/commands/run.ts#L38) - `run.ts` already imports `../config.js`, so `config.ts` cannot import from `run.ts`"
  - "[code://packages/server/src/commands/user.ts#L185](../../../../packages/server/src/commands/user.ts#L185) - `user token --url`, its one caller"
  - "[code://packages/server/test/daemon.test.ts#L74-L84](../../../../packages/server/test/daemon.test.ts#L74-L84) - the `personalUrl` cases"
---

## Objective

`user token --url` on a daemon bound to an IPv6 address prints a URL a parser reads, with the address in brackets, as task 26 made the other addresses the daemon prints.

## Files

- `UPDATE: packages/server/src/config.ts:299-302` - `personalUrl` writes the host through `urlHost`.
- `UPDATE: packages/server/src/config.ts` - `urlHost` moves here from `run.ts`.
- `UPDATE: packages/server/src/commands/run.ts:38,49` - `urlHost` is removed and imported from `../config.js` with the names it already imports.
- `UPDATE: packages/server/test/daemon.test.ts:74-84` - the case below.

## Steps

1. `personalUrl` writes a host that is not a wildcard through `urlHost`, so `::1` becomes `[::1]`; the machine name a wildcard falls back to is written as it is.
2. Move `urlHost` into `packages/server/src/config.ts`, and have `run.ts` import it from there.
   `run.ts` already imports `../config.js`, so `config.ts` importing from `run.ts` would be a cycle.

## Validation

- `daemon.test.ts`: `personalUrl('abc', '::1', 9187, 'box')` is `ws://[::1]:9187/?tkn=abc`, and `new URL(...)` of it has `hostname` `[::1]`.
  Today it is `ws://::1:9187/?tkn=abc`, which `new URL` rejects.
- The existing `127.0.0.1` and wildcard cases still pass.
- `node_modules/.bin/vitest run packages/server/test/daemon.test.ts` green; `pnpm typecheck` and `pnpm boundary` green.

## Resume

Implemented 2026-09-27. The IPv6 case was written first and seen to fail: `personalUrl('abc', '::1', 9187, 'box')` was `ws://::1:9187/?tkn=abc`, which `new URL` rejects.

`urlHost` moved from `packages/server/src/commands/run.ts` into `packages/server/src/config.ts`, which `run.ts` already imports, and `personalUrl` writes a non-wildcard host through it. A wildcard's machine name is written as it is.

The existing `127.0.0.1` and wildcard cases pass. `node_modules/.bin/vitest run packages/server/test/daemon.test.ts`: 19 passed. `pnpm typecheck`, `pnpm boundary` and `pnpm test`: 103 files, 1363 tests passed.
