---
title: Only allowed folders become dev containers, and devcontainer false turns every route off
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L298-L318](../../../../packages/computer/src/plugin.ts#L298-L318) - the `devcontainer` option and `cliOptions`, read once"
  - "[code://packages/computer/src/plugin.ts#L683-L721](../../../../packages/computer/src/plugin.ts#L683-L721) - the `devcontainer://<folder>` session-time create"
  - "[code://packages/computer/src/plugin.ts#L933-L950](../../../../packages/computer/src/plugin.ts#L933-L950) - the picker's `devcontainer://` row"
  - "[code://packages/computer/src/plugin.ts#L829-L878](../../../../packages/computer/src/plugin.ts#L829-L878) - the relay launcher and its `connect`"
  - "[code://packages/computer/src/manifest.ts#L393](../../../../packages/computer/src/manifest.ts#L393) - `devcontainerOf`, the create body's route"
  - "[code://packages/sdk/src/host.ts#L8683-L8688](../../../../packages/sdk/src/host.ts#L8683-L8688) - policy/01's `computer:` rows, checked before a session's machine is placed"
---

## Objective

The computer plugin takes an allowlist of folders for dev containers; a folder outside it is refused on every route (a create body, a `devcontainer://` session setting, the picker row and the relay's `connect`), and `devcontainer: false` turns all four off.
With no allowlist, any folder is allowed.
This applies [A dev container is made only from a folder the operator allows](../../../decisions/a-dev-container-is-made-only-from-a-folder-the-operator-allows.md) and [A devcontainer source names any allowed folder](../../../decisions/a-devcontainer-source-names-any-allowed-folder.md).

This allowlist is the operator's, per plugin; policy/01's `computer:` rows are the person's, per principal, and already gate `devcontainer://F` before placement but not the form create or the relay's `connect`.
Both apply, and this task does not change policy/01's check.

## Files

- `UPDATE: packages/computer/src/plugin.ts:298-318` - the option, read once, and one check every route calls; `devcontainer: false` removes the picker row, refuses the session-time create and the relay's `connect`, and leaves the launcher unregistered.
- `UPDATE: packages/computer/src/plugin.ts:683-721`, `:933-950`, `:868-877` - each route calls the check.
- `UPDATE: packages/computer/src/manifest.ts:393` - the create body goes through the same check.
- `UPDATE: packages/computer/test/computer-devcontainer.test.ts` - the cases below.

## Steps

1. One function answers "may a dev container be made from folder F", used by all four routes, with one sentence.
2. A folder is compared after resolving it, so `..` and symlinks cannot leave the list.

## Validation

- With `devcontainer: false`, a `devcontainer://F` session setting is refused and no row is offered; today both still work.
- With a list, a folder outside it is refused on each route; a folder inside works.
- With no list, container/01's connect works unchanged.

## Resume
