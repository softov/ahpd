---
title: The name a create gives a dev container is kept for it
status: todo
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
