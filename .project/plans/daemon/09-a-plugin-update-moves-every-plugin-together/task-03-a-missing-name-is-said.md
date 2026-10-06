---
title: "`ahpd plugin install` with no name says a name is needed"
status: done
depends: []
layer: "server"
refs:
  - "npm://@cofold/terminal@^0.2.0 - the release that carries cofold commands/03"
---

## Objective

Once cofold commands/03 is released, the server depends on that `@cofold/terminal`, and `ahpd plugin install` and `ahpd plugin remove` with no name each say the name is needed, with no `unknown command`.

## Files

- `UPDATE: packages/server/package.json` - the `@cofold/terminal` range, after Softov approves the bump.
- `UPDATE:` a CLI test for the two commands with no name.

## Steps

1. Wait for the cofold release; ask before changing the range.
2. Test first: both commands with no name, the message and exit code 2.

## Validation

- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

Implemented 2026-10-06, in daemon 16 task 01's bump. `@cofold/terminal` is ^0.3.0, and both commands with no name are answered by the declaration they are one argument short of, rather than by `unknown command`: `ahpd: "plugin install" needs name.` with `Usage: ahpd plugin install <name...>` on stderr, exit 2, and the same for `plugin remove`. Pinned in `packages/server/test/server-cli.test.ts`, in `refuses install, remove and update with nothing named`.
