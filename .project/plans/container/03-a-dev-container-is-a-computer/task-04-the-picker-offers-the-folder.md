---
title: The picker offers the session folder's dev container
status: implemented
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

Implemented 2026-09-26.
`packages/computer/src/plugin.ts` handles `devcontainer://<folder>` in `ComputerPort.create`: it refuses a folder that is not absolute and one with no `devcontainer.json`, resolves the session agent's needs through `manifestOf` with `for: asked.provider` and `devcontainer: folder`, makes it with the CLI as `--mount` and `--remote-env`, and answers the container's own id so the host writes `computer://<id>` over the setting.
The picker adds the `devcontainer://<folder>` row when the asking session's folder has a `devcontainer.json` and no listed computer carries `ahpd.devcontainer.folder=<folder>`, and a running dev container's description is its folder.
`packages/sdk/src/computers.ts` needed no change: `openComputer` already makes any non-`computer://` source through the port and the host already resolves it before a spawn, so there was nothing to add there.
Validated by the picker and session-start tests in `test/computer-devcontainer.test.ts`.
