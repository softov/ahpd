---
title: A part is built the first time it is asked for
status: done
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

Done 2026-10-04.

- `ComputerRuntime` grew `hasImage(tag)` and `buildImage(tag, context)`, and
  Docker answers them with `docker image inspect <tag>` and `docker build -t
  <tag> -`. The interface names a context rather than a Dockerfile because the
  ahpd part of a checkout installs from tarballs that have to travel with the
  Dockerfile; `contextOf` in `parts.ts` builds that ustar archive and
  `runtime.ts` only pipes bytes, which keeps the tar writer on the side that
  knows what is in it.
- The map holds **only builds that are running**. An entry is dropped when the
  build settles either way, so a caller that arrives afterwards asks the
  runtime what it has - which is the honest answer: a build that succeeded left
  an image, and one that failed did not. Holding a success would mean a
  daemon's image being deleted behind a daemon's back goes unnoticed, and
  holding a failure would refuse every later attempt for a build that is not
  running.
- A failed build refuses every waiter with the tag, the exit code and Docker's
  last lines. The last lines rather than all of them because BuildKit's own
  progress is long and the reason is always at the end.
- `ran` grew an optional `input`, and only opens a pipe for stdin when there is
  one - every other verb in the file still runs with stdin closed.
- The fixture's `image inspect` refuses a tag it does not hold with a non-zero
  exit, which is what the provider reads as "not here"; `build` records the
  Dockerfile and the names beside it so a test can assert the text without a
  daemon. `failBuild` is either `true` or a list of tags, so one part may fail
  while the rest of the file is healthy.
- `packages/computer/test/computer.test.ts`'s runtime is the only other typed
  `ComputerRuntime`, and it answers `hasImage` with `true` and records a build
  it never runs: that fake is about what the provider does with a runtime, not
  about images.
