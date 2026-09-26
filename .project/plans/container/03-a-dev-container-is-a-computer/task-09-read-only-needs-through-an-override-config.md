---
title: Read-only needs reach a dev container through an override config
status: todo
depends: [task-07-the-fake-cli-behaves-like-the-real-one.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L570-L590](../../../../packages/computer/src/runtime.ts#L570-L590) - the `up` argv with `--mount` and `--remote-env`"
---

## Objective

A need with `readOnly: true` reaches a dev container as a read-only mount, written in an override config's `mounts`, so `devcontainer up` accepts it.
This applies [Read-only needs reach a dev container through an override config](../../../decisions/read-only-needs-reach-a-dev-container-through-an-override-config.md).

## Files

- `UPDATE: packages/computer/src/runtime.ts` - the devcontainer branch writes an override config (a temporary file, removed after `up`) holding the read-only mounts, passes `--override-config` on `up` and on `exec`, and uses `--mount` only for what the pattern allows.

## Steps

1. The override must keep the folder's own config working: read how the CLI merges `--override-config` with the definition (Dockerfile paths are relative to the definition), and write only the keys this adds.
2. Task 11 adds `runArgs` and `workspaceFolder` to the same file.

## Validation

- `test/computer-devcontainer.test.ts`: a Claude session through `devcontainer://F` makes the container with the needs read-only (the fake now checks the pattern); fails today at `up`.
- By hand: the same against `/usr/local/bin/devcontainer` with a folder whose definition uses a Dockerfile.

## Resume
