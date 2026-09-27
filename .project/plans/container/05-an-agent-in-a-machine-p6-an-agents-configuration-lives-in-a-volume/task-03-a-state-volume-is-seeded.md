---
title: A state volume is seeded when its seed changed
status: todo
depends: [task-02-a-machine-gets-its-state-volumes.md]
layer: "computer"
refs:
  - https://docs.docker.com/reference/cli/docker/container/cp/ - copying into a created container
  - "[code://packages/computer/src/runtime.ts#L638-L660](../../../../packages/computer/src/runtime.ts#L638-L660) - the copy-in pattern this replaces for state"
---

## Objective

Before a machine starts, each state volume whose `.ahpd-seed.json` stamp differs from the seeds' current size and mtime is seeded: the named files are written, `keep` and `drop` applied, others left alone, and the stamp rewritten.

## Files

- `UPDATE: packages/computer/src/runtime.ts` - `seedState(volume, seeds, image)`.
- `UPDATE: packages/computer/test/fixtures/docker.mjs` - volumes that keep files across containers.

## Steps

1. Read the stamp with `docker run --rm -v <volume>:/s <base image> cat /s/.ahpd-seed.json` or, where the image has no shell, `docker cp` out of a created container.
2. Changed: `docker create -v <volume>:/s <base image>`, `docker cp` each seed (a JSON with `keep` or `drop` is filtered into a temporary file first), write the stamp, remove the container.
3. One seed per volume at a time.

## Validation

- The first create seeds; the second copies nothing; touching a seed reseeds that file only; a file the agent wrote stays.
- A `.claude.json` seed with `keep: ["mcpServers"]` lands with that key alone, and a `settings.json` with `drop: ["security.auth"]` lands without it.

## Resume
