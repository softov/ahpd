---
title: A dev container made at session start counts against max and needs computer:write
status: todo
depends: []
layer: "computer"
refs:
  - "[code://.project/plans/plugin/16-a-disposable-machine/task-09-a-machine-made-for-a-session-counts.md](../../plugin/16-a-disposable-machine/task-09-a-machine-made-for-a-session-counts.md) - where the check is built for both sources"
---

## Objective

`devcontainer://F` picked for a session goes through the `max` check and the `computer:write` grant that plugin/16 task 09 builds.
This applies [A machine made for a session counts against max and needs computer:write](../../../decisions/a-machine-made-for-a-session-counts-against-max-and-needs-computer-write.md).
`computer:write` is not a grant in the SDK yet; plugin/16 task 09 adds it, which is why this task waits on it.

## Files

- `UPDATE: packages/computer/test/computer-devcontainer.test.ts` - the cases below; code only if plugin/16 task 09 left the devcontainer road out.

## Steps

1. Confirm the session-time devcontainer create ([`code://packages/computer/src/plugin.ts#L683-L721`](../../../../packages/computer/src/plugin.ts#L683-L721)) calls the same count and grant check as the disposable one.

## Validation

- With `max: 1` and one machine held, `devcontainer://F` is refused; a principal without `computer:write` is refused.

## Resume
