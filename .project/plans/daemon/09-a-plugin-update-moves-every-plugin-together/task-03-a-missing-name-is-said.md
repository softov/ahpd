---
title: "`ahpd plugin install` with no name says a name is needed"
status: blocked
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

Blocked 2026-10-03: cofold commands/03 is planned, not released; `@cofold/terminal` is still 0.2.0.
