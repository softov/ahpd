---
title: The documents say 1.0.0 and 0.9.0
status: done
depends: [task-02-the-package-is-1-0-0-and-the-highest-version-wins.md]
layer: "docs"
refs:
  - "[code://docs/AHP.md#L3-L13](../../../../docs/AHP.md#L3-L13) - 0.9.0, six versions and the client-order rule"
  - "[code://docs/AHP.md#L68](../../../../docs/AHP.md#L68) - the `initialize` row, \"in the client's order of preference\""
  - "[code://README.md#L8](../../../../README.md#L8) - the badge"
  - "[code://README.md#L381](../../../../README.md#L381) - the version `ahpd` targets"
---

## Objective

`docs/AHP.md` and `README.md` say ahpd builds against 1.0.0, accepts 1.0.0 and 0.9.0, and answers the highest compatible version offered.

## Files

- `UPDATE: docs/AHP.md:3-13` - the package is 1.0.0; the versions are `1.0.0` and `0.9.0`; the host answers the highest compatible version offered, as the spec requires; VS Code 1.140 offers `0.9.0` and is answered `0.9.0`.
- `UPDATE: docs/AHP.md:68` - the `initialize` row: the highest compatible version offered, and `-32602` for a malformed one.
- `UPDATE: README.md:8`, `:381` - 1.0.0.

## Steps

1. Rewrite the header paragraph in the file's own style: it is hard-wrapped at 80 columns, so the new lines are too.
2. Drop the sentence about VS Code vendoring an unpublished 1.0.0, which is no longer true.

## Validation

- `rg -n "0\.8\.0|0\.5\.1|order of preference" docs/AHP.md README.md` finds nothing about negotiation.
- `pnpm test` passes (nothing reads these files, so this is a check the change touched nothing else).

## Resume
