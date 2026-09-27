---
title: A person can build ahead, and the docs say how
status: todo
depends: [task-03-built-on-first-use.md, task-04-the-joined-image.md]
layer: "computer, docs"
refs:
  - "[code://scripts/computer.mjs](../../../../scripts/computer.mjs) - gains a `parts` verb"
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - gains a Parts section"
---

## Objective

`node scripts/computer.mjs parts [<id>...|--all|--joined]` builds ahead, and `docs/COMPUTER.md` explains parts, the versions file and the joined image.

## Files

- `UPDATE: scripts/computer.mjs` - the verb, calling `parts.ts`.
- `UPDATE: docs/COMPUTER.md` - a Parts section.

## Steps

1. The verb prints each tag and whether it was built or already there.
2. The docs say where the file is, how to add a part, and that bumps come by pull request.

## Validation

- By hand: `parts --all` twice; the second builds nothing.

## Resume
