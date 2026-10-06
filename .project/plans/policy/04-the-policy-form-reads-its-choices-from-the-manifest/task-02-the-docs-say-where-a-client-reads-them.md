---
title: The docs say where a client reads the choices
status: done
depends: [task-01-the-manifest-says-its-choices.md]
layer: "docs"
refs:
  - "[code://docs/POLICY.md](../../../../docs/POLICY.md) - \"The scheme\", where a client is told how to write a row"
---

## Objective

`docs/POLICY.md` tells a client that the kinds, effects, periods, limit pools, and each kind's measures and match types are in the `policy:` manifest.

## Files

- `UPDATE: docs/POLICY.md` - one paragraph under "The scheme".

## Steps

1. Say the manifest carries them as `enum` and per-kind `allOf`, and that a client draws its choices from there rather than from this page.

## Validation

- The paragraph names the manifest's fields as built in task 01.

## Resume

Implemented 2026-10-06.
One paragraph under "The scheme", between the write paragraph and the sentence about `policies.json`, naming `enum` on `kind`, `effect` and a limit's `measure`, `period` and `pool`, and the per-kind `if`/`then` in `allOf` that narrows a row's measures and match types.
This task has no test and none failed first: its validation is a reading, and no test in the repository reads a `.md` file.
The page's own tables and lists are left as they are, as the plan asks for one paragraph and not a rewrite.
