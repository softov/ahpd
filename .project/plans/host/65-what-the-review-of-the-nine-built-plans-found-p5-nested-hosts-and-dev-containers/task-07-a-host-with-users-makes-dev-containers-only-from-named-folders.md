---
title: A host with users makes dev containers only from named folders
status: todo
depends: []
layer: "computer, sdk"
refs:
  - "[code://packages/computer/src/plugin.ts#L443-L454](../../../../packages/computer/src/plugin.ts#L443-L454) - `devcontainer.folders`, absent allows any"
  - "[code://packages/computer/src/plugin.ts#L481-L490](../../../../packages/computer/src/plugin.ts#L481-L490) - `folderFor`"
  - "[code://packages/sdk/src/types/plugin.ts#L95-L117](../../../../packages/sdk/src/types/plugin.ts#L95-L117) - the plugin context"
  - "[code://docs/COMPUTER.md#L537-L547](../../../../docs/COMPUTER.md#L537-L547) - allowed folders"
  - "[code://packages/computer/test/computer-devcontainer.test.ts](../../../../packages/computer/test/computer-devcontainer.test.ts) - the folder cases"
---

## Objective

On a host with a users directory and no `devcontainer.folders`, `folderFor` refuses every folder with a sentence that names `devcontainer.folders`; on a host without one, an unset list allows any folder as today (decision [dev-containers-need-allowed-folders-on-a-host-with-users](../../../decisions/dev-containers-need-allowed-folders-on-a-host-with-users.md)).

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:95-117` - a read-only field saying whether the host has a users directory; today a plugin cannot tell.
- `UPDATE: packages/server/src/commands/run.ts` - sets it from `options.users`.
- `UPDATE: packages/computer/src/plugin.ts:481-490` - the refusal; today `containerFolders === undefined` returns the folder, so on a shared host anybody with `computer:write` builds a `devcontainer.json` asking for `--privileged`.
- `UPDATE: docs/COMPUTER.md:537-547` - the rule.
- `UPDATE: packages/computer/test/computer-devcontainer.test.ts` - the cases below.

## Steps

1. Failing case first: the plugin on a host with a users directory and no `folders`; a create body naming a `devcontainer` source is refused naming `devcontainer.folders`. Today it is built.
2. The same through the `devcontainer://<folder>` setting, the picker (no row) and the relay's `connect`.
3. A host without a users directory and no `folders` still builds (passes before and after).

## Validation

- The cases in steps 1 and 2 fail on `e1c4ccc` and pass after.
- `pnpm exec vitest run packages/computer/test/computer-devcontainer.test.ts`.

## Resume
