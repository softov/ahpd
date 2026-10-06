---
title: A host with users makes dev containers only from named folders
status: done
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

Implemented. `PluginContext` has `hasUsers?: boolean`, absent meaning nobody signs in here, and `folderFor` refuses every folder on a host that has one with `This host has a users directory, so no dev container is made from <folder> until its operator names the folders it may use in devcontainer.folders`. One check, so all four routes - the create body, the `devcontainer://<setting>`, the picker's row and the relay's `connect` - refuse with the one sentence and the picker draws no row at all. Naming the folders is the opting in and the folder is then built as it always was.

One departure, and it is what makes the field impossible to get wrong: `packages/server/src/commands/run.ts` is untouched. The task's Files list has it setting the flag from `options.users`, but the loader already has that answer - the daemon hands the users port in the base it folds into (`run.ts`'s `...(users === undefined ? {} : { users })`), and `hostName` is read from the base the same way. So `loadPlugins` sets `users: true` for a plugin when `base.users !== undefined` and `loadOne` answers `hasUsers` from it, and a plugin cannot be told one thing about the host it is folded into and handed another. A host inside a machine has no users port, so a dev container in there is unaffected.

Two cases followed from it. `computer-devcontainer.test.ts`'s `load` gained a `people` flag, which gives the base a real users port (`fileUsers`) rather than a stub, and the task's step 1 and 2 are one case over all four routes; step 3, a host with no users directory and no `folders`, is the file's first case, which passes before and after. `computer-owner.test.ts`'s base has a users directory (it is how that file gives the host somebody to charge work to), so its two dev container cases now name their folder in `devcontainer.folders`, through a `folders` key `optionsOf` folds into the CLI fixture.

Gates: `npx tsc -b` clean, `pnpm exec vitest run packages/computer/test/computer-devcontainer.test.ts packages/computer/test/computer-owner.test.ts packages/sdk/test/plugin-host.test.ts` 63 passed.
