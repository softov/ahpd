---
title: Docs
status: done
depends: [task-01-a-need-value-is-read-from-the-vault.md]
layer: "docs"
refs:
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - `## Profiles`, where a profile's `needs` are described"
---

## Objective

`docs/COMPUTER.md` says a need value may name a secret, when it is read, and which scopes a machine may read.

## Files

- `UPDATE: docs/COMPUTER.md` - under `## Profiles`, a need value written `{ "$secret": "<name>" }`, read when the machine is made, for its owner and team; a pointer to `docs/DAEMON.md`'s vault section for setting one.

## Steps

1. One sentence per line, no em dash, no hard wrap.

## Validation

- The example in the docs is one `computer-needs.test.ts` runs.

## Resume
