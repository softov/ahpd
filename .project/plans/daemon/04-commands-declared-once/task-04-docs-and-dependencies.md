---
title: Docs, dependencies and the lockfile
status: implemented
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

Done: `docs/DAEMON.md` names the declarations under `packages/server/src/commands` as the source of help, completion and `--json`, and documents `--json`, `--quiet`, `--verbose`, `--no-color` and the three completion installs.
`pnpm-lock.yaml` carries `@cofold/commands@0.2.0` and `@cofold/terminal@0.2.0` under `packages/server`; `pnpm install --frozen-lockfile` is clean and `pnpm boundary` is green.
The environment's global pnpm store is read-only, so installs were run with `--store-dir /tmp/pnpm-store`.
