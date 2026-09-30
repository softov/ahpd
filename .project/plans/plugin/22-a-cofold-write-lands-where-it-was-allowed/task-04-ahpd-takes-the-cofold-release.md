---
title: ahpd takes the cofold release
status: todo
depends: [task-02-a-write-rechecks-the-file-it-opened.md, task-03-a-stale-write-is-refused.md]
layer: "agent-cofold"
refs:
  - npm://@cofold/tools@^0.1.1 - the range ahpd takes today
---

## Objective

After Softov releases `@cofold/tools` through cofold's `release.yml`, ahpd's range takes it and the suite passes.

## Files

- `UPDATE:` the `@cofold/tools` range in ahpd's `package.json` files, and `pnpm-lock.yaml`.

## Steps

1. Bump the range, `pnpm install --no-frozen-lockfile` once, run the gates.

## Validation

- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
