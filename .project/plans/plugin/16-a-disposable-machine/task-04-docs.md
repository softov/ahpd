---
title: Docs
status: implemented
depends: [task-03-it-goes-after-the-last-session.md]
layer: "docs"
refs:
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - profiles"
---

## Objective

`docs/COMPUTER.md` documents the three fields with an example.

## Files

- `UPDATE: docs/COMPUTER.md`

## Steps

1. Say that a copy-in is paid on every create, so a disposable profile prefers mounts.

## Validation

- The example works pasted into a config.

## Resume

Done 2026-09-26. `docs/COMPUTER.md` has a "Disposable machines" section: the three fields as a table, a `scratch` profile example, what the machine is labelled, that a re-picked source reuses the machine, that a failed create answers with the runtime's sentence, and that a copy-in is paid on every create so a disposable profile prefers mounts. The picker paragraph in "A session in one" links to it. `test/computer-disposable.test.ts` loads the example's `profiles` object as plugin options.

