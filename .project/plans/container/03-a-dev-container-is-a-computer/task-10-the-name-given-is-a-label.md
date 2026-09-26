---
title: The name a create gives a dev container is a label on it
status: todo
depends: [task-07-the-fake-cli-behaves-like-the-real-one.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/provider.ts](../../../../packages/computer/src/provider.ts) - the write, which ignores the id `run` answers"
  - "[code://packages/computer/src/runtime.ts#L683-L692](../../../../packages/computer/src/runtime.ts#L683-L692) - `exec`"
---

## Objective

`computer://box` written with a devcontainer body lists as `box`: the name is a label on the container, and the runtime resolves the name through it.
This applies [The name a create gives a dev container is a label on it](../../../decisions/the-name-a-create-gives-a-dev-container-is-a-label-on-it.md).

## Files

- `UPDATE: packages/computer/src/runtime.ts` - `up` adds the name label; listing answers the name; `exec` targets the container by `--container-id`.
- `UPDATE: packages/computer/src/provider.ts` - the write keeps the name it was given.
- `UPDATE: test/computer-devcontainer.test.ts` - the test that asserts the listing is `['abc123']` after writing `computer://box` asserts `['box']`.

## Steps

1. Two names for one folder: the second write finds the container the first made (the CLI reuses it by label) and is refused with a sentence naming the first.

## Validation

- Writing `computer://box` lists `box`; today it lists the CLI's id, so the case fails.

## Resume
