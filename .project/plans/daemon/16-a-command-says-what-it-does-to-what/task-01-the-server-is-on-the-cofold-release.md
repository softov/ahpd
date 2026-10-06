---
title: The server is on the cofold release that declares effects
status: blocked
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

Blocked 2026-10-06: the release (tag `release-2026-10-06`) is staged on npm and waits for Softov's approval there.
