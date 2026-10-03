---
title: Docker makes a machine from resolved needs
status: done
depends: [task-02-the-host-resolves-needs.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L701-L746](../../../../packages/computer/src/runtime.ts#L701-L746) - `docker run` or `create`, `cp`, `start`, the flags and the labels"
  - "[code://packages/computer/src/manifest.ts#L561-L649](../../../../packages/computer/src/manifest.ts#L561-L649) - the profile's agents resolved into mounts, env and copies"
---

## Objective

A profile's `agents` list is read, their needs are resolved through the host at create, mounts and env become `docker run` flags, copy-ins are `docker cp` after create and before start, the session folder is mounted at the same path, and the container is labelled `ahpd.agents=<list>`.

## Files

- `UPDATE: packages/computer/src/manifest.ts` - `agents` on a profile.
- `UPDATE: packages/computer/src/runtime.ts` - the flags, the copy step, the label.

## Steps

1. A profile's own `mounts` stay and are applied as today.
2. Two agents needing the same target is refused at create.

## Validation

- `packages/computer/test/computer-needs.test.ts` against `packages/computer/test/fixtures/docker.mjs`: the flags for each kind, the copy order, the label, the refusals.

## Resume
