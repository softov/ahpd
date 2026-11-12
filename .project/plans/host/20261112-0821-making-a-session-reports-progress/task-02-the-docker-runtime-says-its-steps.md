---
title: The docker runtime says its steps
status: todo
depends:
  - task-01-the-host-says-each-step-of-a-create.md
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L2164](../../../../packages/computer/src/plugin.ts#L2164) - the plugin's `create` for a `disposable:` source"
  - "[code://packages/computer/src/runtime.ts#L3326-L3335](../../../../packages/computer/src/runtime.ts#L3326-L3335) - `docker run`, then `seedGit`"
---

## Objective

A machine made for a session says `Pulling <image>`, `Making the machine` and `Seeding the checkout` through the `progress` its `MachineSource` carries.

## Files

- `UPDATE: packages/computer/src/plugin.ts:2164` - `create` passes `asked.progress` to the runtime's `run`.
- `UPDATE: packages/computer/src/runtime.ts:3326-3335` - `run` calls `progress` before the pull, the run and the seed.
- `UPDATE: packages/computer/test/` - a case that collects the steps of a `disposable:` create.

## Steps

1. Give the runtime's `run` an optional `progress` parameter.
2. Call `progress('Pulling <image>')` only when the image is not on the Docker yet.
3. Call `progress('Making the machine')` before `docker run`, and `progress('Seeding the checkout')` before `seedGit`.
4. Pass `asked.progress` from the plugin's `create` to `run`.
5. Write the computer case that collects the steps.

## Validation

- The computer case sees the steps in order for a fresh image, and no pull step for a present one.
- `pnpm typecheck` passes.

## Resume
