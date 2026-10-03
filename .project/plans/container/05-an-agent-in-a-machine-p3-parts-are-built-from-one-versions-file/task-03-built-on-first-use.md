---
title: A part is built the first time it is asked for
status: todo
depends: [task-02-a-part-image-per-kind.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L570-L577](../../../../packages/computer/src/runtime.ts#L570-L577) - `must`"
  - "[code://packages/computer/test/fixtures/docker.mjs](../../../../packages/computer/test/fixtures/docker.mjs) - learns `image inspect` and `build -`"
---

## Objective

`ensurePart(id)` answers the part's tag once its image exists, builds it when it does not, and shares one build between concurrent callers; a part's `requires` are ensured first.

## Files

- `UPDATE: packages/computer/src/parts.ts` - `ensurePart`.
- `UPDATE: packages/computer/src/runtime.ts` - `ComputerRuntime.hasImage`, `buildImage(tag, dockerfile)` for Docker.
- `UPDATE: packages/computer/test/fixtures/docker.mjs` - the two verbs.

## Steps

1. A map of pending builds by tag in the plugin's process.
2. `docker image inspect <tag>`; absent, `docker build -t <tag> -` with the Dockerfile on stdin.
3. A failed build rejects every waiter with Docker's last lines, and is not cached.

## Validation

- Two concurrent `ensurePart('codex')` on the fake run one build.
- A part with `requires: ['node']` builds `node` first.
- An existing tag runs no build.

## Resume
