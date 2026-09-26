---
title: The picker offers the session folder's dev container
status: todo
depends: [task-02-reached-through-devcontainer-exec.md]
layer: "computer | sdk"
refs:
  - "[code://packages/computer/src/plugin.ts#L297-L321](../../../../packages/computer/src/plugin.ts#L297-L321) - the answerer"
  - "[code://packages/sdk/src/computers.ts](../../../../packages/sdk/src/computers.ts) - where a session opens its computer"
---

## Objective

The answerer adds `devcontainer://<folder>` when the asking session's folder has a `devcontainer.json` and no computer is labelled with it; a session started with it makes the computer through the port, with its agent's needs as `--mount` and `--remote-env`, and then runs in `computer://<id>`.

## Files

- `UPDATE: packages/computer/src/plugin.ts`
- `UPDATE: packages/sdk/src/computers.ts` - the session-time create shared with `plugin/16`.

## Steps

1. Once the computer exists the row is the ordinary `computer://` one.

## Validation

- Answerer tests with and without the file and with an existing computer; a session-start create against the fake CLI.

## Resume
