---
title: The docs say where a client reads the choices
status: todo
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
