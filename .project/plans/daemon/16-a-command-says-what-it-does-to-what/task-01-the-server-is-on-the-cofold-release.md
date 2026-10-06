---
title: The server is on the cofold release that declares effects
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/package.json#L47-L50](../../../../packages/server/package.json#L47-L50) - the `@cofold/commands`, `@cofold/remote` and `@cofold/terminal` ranges"
  - "[code://packages/server/src/http.ts#L109-L116](../../../../packages/server/src/http.ts#L109-L116) - `apiHandler`, where the new `serve()` checks every path parameter"
  - "npm://@cofold/commands@^0.3.0 - effect and resource, cofold commands/04"
  - "npm://@cofold/remote@^0.5.0 - the manifest fields and the path check in `serve()`"
  - "npm://@cofold/terminal@^0.3.0 - the confirm on a remove, and cofold commands/03"
  - "npm://@cofold/config@^0.3.1 - the same release, on `@cofold/commands` ^0.3.0"
---

## Objective

The server depends on the cofold releases that carry commands/03 and commands/04, and the daemon starts with `"http": true` on them.

## Files

- `UPDATE: packages/server/package.json:47-50` - `@cofold/commands` ^0.3.0, `@cofold/config` ^0.3.1, `@cofold/remote` ^0.5.0, `@cofold/terminal` ^0.3.0, after Softov approves the bump.
- `UPDATE: pnpm-lock.yaml` - from `pnpm install`.

## Steps

1. Wait for the cofold release; ask Softov before changing a range.
2. Land after tasks 02 and 03, or in the same change: on the new `@cofold/remote` the daemon refuses to start while `usage.list` binds an optional `{pool}`.
3. Close daemon 09 task 03 in the same bump, since it waits on the same `@cofold/terminal`.

## Validation

- `test/server-http.test.ts`: `servedRegistry` handed to `serve()` does not throw.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test`, `pnpm build` green.

## Resume

Implemented 2026-10-06. The `release-2026-10-06` tag is on npm and `packages/server/package.json` names `@cofold/commands` ^0.3.0, `@cofold/config` ^0.3.1, `@cofold/remote` ^0.5.0 and `@cofold/terminal` ^0.3.0; `pnpm install` moved `pnpm-lock.yaml` and added the four to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`.
Landed with tasks 02 and 03, because the new `serve()` refuses `usage.list`'s optional `{pool}` and `plugin.config`'s `:key?` at the mount: `servedRegistry` handed to `serve()` now builds every route, and `packages/server/test/usage-command.test.ts` and `packages/server/test/plugin-config.test.ts` cover the two splits.
Daemon 09 task 03 is closed in the same bump: `ahpd plugin install` and `ahpd plugin remove` with no name each answer `ahpd: "plugin <word>" needs name.` and `Usage: ahpd plugin <word> <name...>`, exit 2, rather than `unknown command`, pinned in `packages/server/test/server-cli.test.ts`.
