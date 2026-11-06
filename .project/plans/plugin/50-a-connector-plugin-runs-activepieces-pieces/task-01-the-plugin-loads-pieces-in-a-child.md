---
title: The plugin loads pieces in a child
status: done
depends: []
layer: "activepieces"
refs:
  - "[code://packages/webhook/package.json#L61-L73](../../../../packages/webhook/package.json#L61-L73) - the `ahpd` manifest to copy"
  - "[code://packages/webhook/src/plugin.ts#L38-L39](../../../../packages/webhook/src/plugin.ts#L38-L39) - `optionsSchema`, the pattern for `pieces`"
  - "[code://packages/sdk/src/types/plugin.ts#L1154](../../../../packages/sdk/src/types/plugin.ts#L1154) - `apply` may answer a promise"
  - "[code://package.json#L15](../../../../package.json#L15) - the build list, which gets the new package"
---

## Objective

`packages/activepieces` is a plugin with a `pieces` option.
`apply` starts one child process, and the child loads each named piece and describes it as plain JSON.

## Files

- `CREATE: packages/activepieces/package.json` - the manifest, with `contracts.adapters: ["ap-*"]` and the three pieces at exact versions.
- `CREATE: packages/activepieces/tsconfig.json` - as `packages/webhook/tsconfig.json`.
- `CREATE: packages/activepieces/LICENSE` - MIT, as the other packages.
- `CREATE: packages/activepieces/src/index.ts` - the plugin export.
- `CREATE: packages/activepieces/src/plugin.ts` - `optionsSchema` and `apply`.
- `CREATE: packages/activepieces/src/child.ts` - the child entry: the TLS pin, `describe` and the message loop.
- `CREATE: packages/activepieces/src/wire.ts` - the message types between the plugin and the child.
- `UPDATE: package.json:15` - add `tsc -p packages/activepieces` before the server.
- `CREATE: packages/activepieces/test/child.test.ts` - the cases below.

## Steps

1. Copy the package layout of `packages/webhook`.
2. Declare `pieces` in `optionsSchema` as a list of package names, each starting with `@activepieces/piece-`.
3. In `child.ts`, replace `process.env` with a proxy that ignores a write or a delete of `NODE_TLS_REJECT_UNAUTHORIZED`.
4. Do this before the child requires any piece.
5. In `child.ts`, answer `describe` with the `auth` and the actions of each piece.
6. Find each piece as the exported object that has `_actions`.
7. Answer each prop as its `type`, `displayName`, `description`, `required` and static `options`, and drop its functions.
8. Answer a piece that fails to load as an error that names it, and keep the others.
9. In `apply`, fork `child.ts` with an IPC channel, and send `describe` with the `pieces` option.
10. Make the child exit when its IPC channel closes.
11. Report each piece error through the plugin's log, and keep loading.
12. Add the tests, and run the package tests.

## Validation

- `child.test.ts`: a piece that sets `NODE_TLS_REJECT_UNAUTHORIZED` to `"0"` leaves it unset in the child.
- `child.test.ts`: `describe` of a test piece answers its auth and its actions, with no function in the answer.
- `child.test.ts`: a package that is not installed answers an error, and the other pieces still load.
- `child.test.ts`: the child exits when the parent closes the channel.
- `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.

## Resume

- **Done so far:** `packages/activepieces` exists, with the manifest, the tsconfig, the license, `plugin.ts`, `child.ts`, `wire.ts` and `index.ts`.
  The child pins `NODE_TLS_REJECT_UNAUTHORIZED` with a `process.env` proxy before it imports any piece.
  It finds a piece by its `_actions` member, describes its `auth` and its actions as plain JSON, and names each piece that fails to load.
  `apply` forks the child with an IPC channel, sends `describe`, and reports each error through `host.problem`.
  The child exits with code 0 when the channel closes.
  `child.test.ts` passes all four cases, and `pnpm -s build`, `pnpm -s typecheck` and `pnpm -s boundary` pass.
- **Next action:** task 02, which turns each described piece into an adapter.
- **Files:** `packages/activepieces/package.json`, `packages/activepieces/tsconfig.json`, `packages/activepieces/LICENSE`, `packages/activepieces/src/index.ts`, `packages/activepieces/src/plugin.ts`, `packages/activepieces/src/child.ts`, `packages/activepieces/src/wire.ts`, `packages/activepieces/test/child.test.ts`, `packages/activepieces/test/fixtures/piece-simple.mjs`, `packages/activepieces/test/fixtures/piece-tls.mjs`, `package.json`.
- **Open questions:** none.
- **Departures:** none.
- **Watch out for:** the child is `src/child.ts` when the daemon runs from source, and `dist/child.js` when it runs a build. `childPath` picks by the suffix of this module's URL.
