---
title: Only allowed folders become dev containers, and devcontainer false turns every route off
status: done
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L298-L318](../../../../packages/computer/src/plugin.ts#L298-L318) - the `devcontainer` option and `cliOptions`, read once"
  - "[code://packages/computer/src/plugin.ts#L683-L721](../../../../packages/computer/src/plugin.ts#L683-L721) - the `devcontainer://<folder>` session-time create"
  - "[code://packages/computer/src/plugin.ts#L933-L950](../../../../packages/computer/src/plugin.ts#L933-L950) - the picker's `devcontainer://` row"
  - "[code://packages/computer/src/plugin.ts#L829-L878](../../../../packages/computer/src/plugin.ts#L829-L878) - the relay launcher and its `connect`"
  - "[code://packages/computer/src/manifest.ts#L393](../../../../packages/computer/src/manifest.ts#L393) - `devcontainerOf`, the create body's route"
  - "[code://packages/sdk/src/host/machines.ts#L150-L153](../../../../packages/sdk/src/host/machines.ts#L150-L153) - policy/01's `computer:` rows, checked before a session's machine is placed"
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

Implemented on 2026-10-03.

Files changed:

- `packages/computer/src/plugin.ts` - `optionsSchema` declares `folders` under `devcontainer` and its description now says `false` switches every route off. `apply` reads `words(held.folders)` once, beside the CLI reads, and builds two things from it: `resolved(path)`, which is `realpathSync` falling back to the path as written for a folder that is not there, and `refusalOf(folder)` (now `folderFor`), which answers the sentence for a folder this host will not build a dev container from, or nothing when it may. It is called by the `devcontainer://` session-time create, the picker's `devcontainer://` row (the local array was renamed `fromFolder`, since `devcontainer` was already the option's name) and the relay's `connect` wrapper, and is handed to the provider as `folderFor`.
- `packages/computer/src/manifest.ts` - `ManifestDefaults.folderFor` carries the plugin's answer down as a `FolderAnswer`, and `devcontainerOf` reads it after the folder is known absolute and before the path is touched.
- `packages/computer/src/provider.ts` - `ProviderOptions.folderFor` and `devcontainer`, forwarded into the one `manifestOf` call in `write` and into both `MANIFEST_SCHEMA` calls. **This file is not named in the task's Files list.** A create body reaches `manifestOf` through here and nowhere else, so the handoff has to exist for :393 to be reached at all; it is one field and one spread line.
- `packages/computer/test/computer-devcontainer.test.ts` - the two cases below.

What the tests cover: with `folders: [<allowed>]`, a folder outside is refused on the create body, on the session-time create and on `connect` with the same sentence naming the folder, its picker row is not offered, and nothing reaches the CLI or Docker; the folder the list names still gets its `devcontainer://` row and is made with the two id labels. With `devcontainer: false`, no containers port is registered at all, the create body and the session-time create are refused with the off sentence, the picker offers no row, and the CLI and Docker records are empty. `container/01`'s connect with no list is the existing task 05 case, unchanged.

Notes and open questions:

- The allowlist is `devcontainer.folders`, a list of absolute paths, compared with `realpathSync` on both sides. Patterns were not used: `patternOf`/`allowedBy` are an image reference grammar and would read `/srv/app` as a Hub repository, and no task asks for wildcards in a folder.
- A folder in the list that is not there resolves to itself, so an operator may list a path before the repository is cloned.
- The task says the allowlist is "the operator's, per plugin; policy/01's `computer:` rows are the person's, per principal" and both apply. Nothing here changes policy/01's check, as the task asks.
- `docs/CONTAINERS.md` and `docs/COMPUTER.md` are not touched: the decision's Consequences require them to say what the list is and what `false` turns off, but the task's Files name neither, and task 06 (the docs task) depends on 18. This is a gap to close with task 06.
- `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm test` green after the change (2491 tests).

### The review of 2026-10-03

Four things the first implementation got wrong, all in `plugin.ts` unless said otherwise:

- `refusalOf` checked the resolved path and handed the unresolved one on to `up` and to the id label, so a symlink got a second container and the check and the maker could be looking at two folders. It is `folderFor` now, and it answers the path itself rather than a refusal about it - `FolderAnswer` in `manifest.ts` - so every route gets the resolved path without each one remembering to resolve. `provider.ts` and `manifest.ts` follow it: the provider's `refuses` is `folderFor`, and `devcontainerOf` reads the answer rather than being told whether it is allowed.
- A relative entry in `devcontainer.folders` was resolved against the daemon's working directory and nothing said so. It is refused when the options are read, which is a load-time failure rather than a first-folder one.
- The comment on `devcontainer: false` claimed `devcontainer://` still worked with no launcher behind it. It does not: no containers port is registered at all. The comment now says that, and that the runtime is still built.
- With `devcontainer: false` the form still drew `source` and `devcontainer`, which are fields for a route this host refuses. `MANIFEST_SCHEMA` takes a `devcontainer` option and drops both.

Tests added: a symlinked folder goes to the CLI as its realpath and is labelled with it; a relative `folders` entry is refused at load; and with `devcontainer: false` the manifest's properties are exactly `runtime`, `image`, `cpus`, `memory` and `workdir`.

### The fix turn of 2026-10-05

No code changed for this task on 2026-10-05; the hard-wrapped review notes above were unwrapped.
