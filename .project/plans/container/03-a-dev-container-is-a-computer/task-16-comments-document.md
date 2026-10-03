---
title: The comments in this plan's code document
status: todo
depends: [task-18-every-command-reaches-it-by-docker-exec.md]
layer: "sdk | computer"
refs:
  - "[code://packages/sdk/src/computers.ts#L4-L26](../../../../packages/sdk/src/computers.ts#L4-L26) - `refuseComputer`'s comment, \"exactly one of those today\" at :9"
  - "[code://packages/sdk/src/computers.ts#L34-L47](../../../../packages/sdk/src/computers.ts#L34-L47) - `computerSource`, \"`disposable:<profile>` today, `devcontainer://<folder>` after it\" at :38-39"
  - "[code://packages/sdk/src/computers.ts#L56-L62](../../../../packages/sdk/src/computers.ts#L56-L62) - `openComputer`, \"a disposable profile today and a folder's dev container after it\" at :60"
---

## Objective

The comments this plan touched say what each declaration is; history belongs in the decisions.

## Files

- `UPDATE: packages/sdk/src/computers.ts:9`, `:38-39`, `:60` - each names the sources and backends as they are, with no "today" and no "after it".
- `UPDATE: packages/computer/src/devcontainer.ts`, `packages/computer/src/runtime.ts`, `packages/computer/src/plugin.ts` - any comment from this plan that says what used to be, read after task 18 has rewritten the reach comments.

## Validation

- `rg -n "today|after it|used to|no longer" packages/sdk/src/computers.ts packages/computer/src` finds no comment that narrates.
- `pnpm typecheck` green.

## Resume
