---
title: A dev container gets its parts by volume
status: todo
depends: [task-04-a-volume-is-the-fallback.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L570-L600](../../../../packages/computer/src/runtime.ts#L570-L600) - `devcontainer up`, where copies become mounts"
  - "[code://packages/computer/test/fixtures/devcontainer.mjs](../../../../packages/computer/test/fixtures/devcontainer.mjs) - the fake CLI"
---

## Objective

`devcontainer up` gets `--mount type=volume,source=ahpd-part-<id>-<version>,target=/opt/ahpd/<id>,readonly` for each part.

## Files

- `UPDATE: packages/computer/src/runtime.ts:570-600` - the flags.
- `UPDATE: packages/computer/test/devcontainer.test.ts` - the case.

## Steps

1. Ensure each part's volume (task 04), then add the flags.

## Validation

- A dev container made for an agent with a part carries the mount in the fake CLI's argv.

## Resume
