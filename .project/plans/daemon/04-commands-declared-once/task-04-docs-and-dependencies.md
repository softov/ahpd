---
title: Docs, dependencies and the lockfile
status: todo
depends: [task-03-main-runs-through-the-program.md]
layer: "docs"
refs:
  - "[code://docs/DAEMON.md](../../../../docs/DAEMON.md) - the CLI reference"
---

## Objective

`docs/DAEMON.md` shows help, completion and `--json`, and the lockfile carries the new dependencies.

## Files

- `UPDATE: docs/DAEMON.md`
- `UPDATE: pnpm-lock.yaml`

## Steps

1. Document completion setup and `--json`.
2. `pnpm install --no-frozen-lockfile` once.

## Validation

- `pnpm install --frozen-lockfile` clean; `pnpm boundary` green.

## Resume
