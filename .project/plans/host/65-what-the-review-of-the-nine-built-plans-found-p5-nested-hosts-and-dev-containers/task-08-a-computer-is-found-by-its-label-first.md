---
title: A computer is found by its label first
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L1752-L1762](../../../../packages/computer/src/runtime.ts#L1752-L1762) - `containerOf` inspects the raw id first"
  - "[code://packages/computer/src/runtime.ts#L2164-L2168](../../../../packages/computer/src/runtime.ts#L2164-L2168) - `remove`, which then runs `rm -f` on what it found"
---

## Objective

`containerOf` finds a computer by this plugin's label and its `ahpd.name` first, and takes a raw id only for a container that carries this plugin's label.

## Files

- `UPDATE: packages/computer/src/runtime.ts:1752-1762` - the label lookup first; today `docker inspect <id>` is asked first and succeeds for any container, image or volume named that, so an unrelated container with the computer's name hides it, and `stop`, `restart` and `remove` (`rm -f`) act on the unrelated one.
- `UPDATE: packages/computer/test/` - the case below, with the scripted runtime the other runtime cases use.

## Steps

1. Failing case first: the scripted `docker` answers `inspect web` for an unlabelled container called `web`, and `ps --filter label=...` with the computer whose `ahpd.name` is `web` under another container name. `remove('web')` today runs `rm -f web`; after, it runs `rm -f` on the labelled one.

## Validation

- The case fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/computer/test/computer-*.test.ts`.

## Resume
