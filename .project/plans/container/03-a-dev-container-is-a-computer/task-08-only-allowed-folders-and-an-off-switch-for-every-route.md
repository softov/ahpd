---
title: Only allowed folders become dev containers, and devcontainer false turns every route off
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - `cliOptions`, the launcher, the session-time create and the picker row"
  - "[code://packages/computer/src/manifest.ts#L372](../../../../packages/computer/src/manifest.ts#L372) - `devcontainerOf`, the create body's route"
---

## Objective

The computer plugin takes an allowlist of folders for dev containers; a folder outside it is refused on every route (a create body, a `devcontainer://` session setting, the picker row and the relay's `connect`), and `devcontainer: false` turns all four off.
With no allowlist, any folder is allowed.
This applies [A dev container is made only from a folder the operator allows](../../../decisions/a-dev-container-is-made-only-from-a-folder-the-operator-allows.md) and [A devcontainer source names any allowed folder](../../../decisions/a-devcontainer-source-names-any-allowed-folder.md).

## Files

- `UPDATE: packages/computer/src/plugin.ts` - the option, read once, and one check every route calls; `devcontainer: false` removes the picker row and refuses the session-time create.
- `UPDATE: packages/computer/src/manifest.ts` - the create body goes through the same check.
- `UPDATE: test/computer-devcontainer.test.ts` - the cases below.

## Steps

1. One function answers "may a dev container be made from folder F", used by all four routes, with one sentence.
2. A folder is compared after resolving it, so `..` and symlinks cannot leave the list.

## Validation

- With `devcontainer: false`, a `devcontainer://F` session setting is refused and no row is offered; today both still work.
- With a list, a folder outside it is refused on each route; a folder inside works.
- With no list, container/01's connect works unchanged.

## Resume
