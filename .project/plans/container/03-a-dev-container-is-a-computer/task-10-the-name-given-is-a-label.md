---
title: The name a create gives a dev container is kept for it
status: implemented
depends: [task-07-the-fake-cli-behaves-like-the-real-one.md, task-09-read-only-needs-through-an-override-config.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/provider.ts#L269-L300](../../../../packages/computer/src/provider.ts#L269-L300) - the write, which ignores the id `run` answers"
  - "[code://packages/computer/src/runtime.ts#L580-L598](../../../../packages/computer/src/runtime.ts#L580-L598) - `namedByFolder`, the container's own name read back after `up`"
  - "[code://packages/computer/src/owners.ts#L1-L20](../../../../packages/computer/src/owners.ts#L1-L20) - why an extra `--id-label` gives a folder a second container"
---

## Objective

`computer://box` written with a devcontainer body lists as `box`, and is inspected, reached and removed by that name.
This applies [The name a create gives a dev container is kept as a label on the container](../../../decisions/the-name-a-create-gives-a-dev-container-is-a-label-on-it.md): for now the name is `--label ahpd.name=<name>` in the override config's `runArgs`, not an `--id-label`, which would give the folder a second container.

## Files

- `UPDATE: packages/computer/src/runtime.ts:389-423` - `MACHINE_NAME = 'ahpd.name'` beside the other label constants, documented as the name a create gave a dev container.
- `UPDATE: packages/computer/src/runtime.ts:645-696` - the devcontainer branch adds `--label`, `ahpd.name=<name>` to the override config's `runArgs` through task 09's `overrideOf`, and answers the name as the id.
- `UPDATE: packages/computer/src/runtime.ts:602-620` - `list` answers the name for a container that has one.
- `UPDATE: packages/computer/src/runtime.ts` - `inspect`, `exec`, `stop`, `start`, `restart`, `remove` and `stats` resolve a name to the container before any Docker verb; `docker exec` then takes the container by id like any other.
- `UPDATE: packages/computer/src/provider.ts:269-300` - the write keeps the name it was given.
- `UPDATE: packages/computer/test/computer-devcontainer.test.ts` - the test that asserts the listing is `['abc123']` after writing `computer://box` asserts `['box']`.

## Steps

1. Two names for one folder: the second write finds the container the first made (the CLI reuses it by its id labels, and a `runArgs` label is set only when the container is made) and is refused with a sentence naming the first, read from its `ahpd.name` label.
2. A dev container made for a session carries the id the host generated the same way.
3. The name goes with the container, so removing the machine removes it.
4. The label is read through `plugin/15` task 08's by-name reader, like every other label.
5. A container with no `ahpd.name` (made before this) answers the CLI's id, as today.

## Validation

- Writing `computer://box` lists `box`; today it lists the CLI's id, so the case fails.
- A second write `computer://other` for the same folder is refused with a sentence naming `box`.
- The container carries exactly the two id labels after the create, and `ahpd.name=box` as a plain label.

## Resume

Implemented on 2026-10-03.

Files changed:

- `packages/computer/src/runtime.ts` - `MACHINE_NAME = 'ahpd.name'` beside the other label constants, documented as a plain label and never an id one; `overrideOf` pushes `--label ahpd.name=<name>` into the override config's `runArgs`; `namedOf(found)` reads it back; `list` answers it in place of the Docker name; `containerOf(id)` resolves a name to the container and every verb - `inspect`, `exec`, `stop`, `start`, `restart`, `remove` and `stats` - runs it first; and `run` refuses a second name for a folder whose container already carries one.
- `packages/computer/src/plugin.ts` - `reach` hands `docker exec` the container's own `Id` rather than the name the caller gave, which is the CLI's own name for it. **This file is not named in the task's Files list.** Without it `how('box')` would build `docker exec ... box`, and the name would be reachable from a listing and by nothing else; the plugin is where `how` is built.
- `packages/computer/src/provider.ts` - no change. The write already took the name from the URI and passed it to `manifestOf`, so there was nothing to keep.
- `packages/computer/test/computer-devcontainer.test.ts` - the case below, and the `how` and `computer_exec` cases, which now ask for `box` rather than for the CLI's id.
- `packages/computer/test/computer-owner.test.ts` - the owner record is keyed by the name the create gave rather than by the container's Docker name, and the removal is by that name.

What the tests cover: writing `computer://box` lists `box` and `dockerRuntime.list()` answers the same; `how('box')` and `computer_exec` on `box` both reach `abc123`; a second write `computer://other` for the same folder is refused with a sentence naming `box`, both `up` calls answered the same container and the listing holds one machine; the container carries exactly `ahpd.computer`, `ahpd.devcontainer.folder`, `ahpd.name` and `devcontainer.metadata`, so the two id labels and nothing more; and `remove('computer://box')` takes the container away.

Choices the task did not settle:

- The second-name refusal is in `run`, after `up` has answered the container the folder already has, because that is the only point at which the name on it can be read. `up` on an existing container starts it, so a refused second write can leave a stopped container running; refusing it earlier would cost a `ps` and an `inspect` on every make.
- `containerOf` resolves by `inspect` first and falls back to `label=ahpd.name=<id>`, rather than trying the label first. A machine made from an image is `docker run --name <name>`, so the name a caller holds is very often already the container's; and an id Docker does not know is left alone so the verb itself answers with its own message.

**By hand, not run.** With the real CLI, a folder made through `computer://box`, `docker ps --filter label=ahpd.computer=1 --format '{{.Labels}}'` shows `ahpd.name=box` beside the two id labels, `devcontainer exec --workspace-folder "$F" --id-label ahpd.computer=1 --id-label "ahpd.devcontainer.folder=$F" true` answers without making a second container, and a second `devcontainer up` for the same folder with a different `ahpd.name` in its override answers the same `containerId` and its labels are unchanged.

### The fix turn of 2026-10-05

`packages/computer/test/computer-owner.test.ts` "keeps the Dev Container CLI on the folder identity" asserted the container's Docker name was `abc123`; the fake CLI keeps the container id, the Docker name and the `ahpd.name` label apart, so it now asserts `id` is `abc123`, the name is something else, and the record under the `ahpd.name` holds the owner and a probe for container `abc123`. No code changed for this task.
