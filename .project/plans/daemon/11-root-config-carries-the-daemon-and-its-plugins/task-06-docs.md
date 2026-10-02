---
title: Docs say what a client can configure, and who sees it
status: done
depends: [task-04-a-write-only-value-is-never-answered.md, task-05-advanced-tools-and-wire-apply-live.md]
layer: "docs"
refs:
  - "[code://docs/DAEMON.md](../../../../docs/DAEMON.md) - the daemon's configuration"
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md) - `optionsSchema`, which gains `writeOnly`"
---

## Objective

`docs/DAEMON.md` lists the keys root config carries, who sees them, which apply live and `ahpd.restartNeeded`; `docs/PLUGINS.md` says to mark a credential `writeOnly`.

## Files

- `UPDATE: docs/DAEMON.md`, `docs/PLUGINS.md`.

## Steps

1. Write both, short and direct, no hard wrap.

## Validation

- Read against the code of tasks 02 to 05.
