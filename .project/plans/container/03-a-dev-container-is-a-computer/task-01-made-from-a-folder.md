---
title: A computer can be made from a folder's devcontainer.json
status: implemented
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/devcontainer.ts](../../../../packages/computer/src/devcontainer.ts) - the CLI runner to reuse"
  - "[code://packages/computer/src/runtime.ts#L272](../../../../packages/computer/src/runtime.ts#L272) - create and list"
  - "[code://test/fixtures/devcontainer.mjs](../../../../test/fixtures/devcontainer.mjs) - the fake CLI"
---

## Objective

A computer manifest with `devcontainer: { folder }` in place of an image is made with `devcontainer up --workspace-folder <folder> --id-label ahpd.computer=1 --id-label ahpd.devcontainer.folder=<folder>`, and appears in `list` with the folder as its description.

## Files

- `UPDATE: packages/computer/src/manifest.ts` - the `devcontainer` source, exclusive with `image`.
- `UPDATE: packages/computer/src/runtime.ts` - create through the CLI for that source; remove with `docker rm -f` by id.

## Steps

1. Reuse the launcher's CLI resolution and its refusal when the CLI is missing.
2. A folder without a `devcontainer.json` is refused before the CLI runs.

## Validation

- `test/computer-devcontainer.test.ts` against the fake CLI: the exact `up` arguments, the listing, both refusals.

## Resume

Implemented 2026-09-26.
`packages/computer/src/manifest.ts` reads `devcontainer: { folder }` in place of `image`, refuses a folder that is not absolute, is not there or has no `devcontainer.json` before any CLI runs, and refuses a body that names both sources.
`packages/computer/src/runtime.ts` makes one with `devcontainer up --workspace-folder <folder> --id-label ahpd.computer=1 --id-label ahpd.devcontainer.folder=<folder>`, with no `--log-level`, which the relay's own `up` keeps.
`list` reads the folder back from the `ahpd.devcontainer.folder` label, and the container's own name is read back from that label after `up` so the id a create answers and the row a listing draws are one; a container the listing cannot see yet keeps the CLI's `containerId`.
Both refusals are the launcher's own, reused rather than reworded: `hasDefinition` for the folder and the spawn failure for a CLI that is not installed.
Validated by `test/computer-devcontainer.test.ts`, which asserts the exact `up` arguments and the listing against the fake CLI.
