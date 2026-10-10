---
title: A dev container stop misses a session placed on its machine by computer URI
status: open
date: 2026-10-10
severity: major
blocks: []
refs:
  - "[code://packages/sdk/src/host/vscodemethods.ts#L199-L206](../../packages/sdk/src/host/vscodemethods.ts#L199-L206) - `placedOn` reads only `sessionMachines`"
  - "[code://packages/sdk/src/host/machines.ts#L470-L494](../../packages/sdk/src/host/machines.ts#L470-L494) - `placedIn` records a session only when it names a source"
---

## Symptom

A session is created with `computer: 'computer://<id>'`, where `<id>` is the machine a dev container folder already is.
VS Code then sends `vscode/devContainers/stop` for that folder.
The host answers `true` and stops the machine, and the session loses the computer it runs in.

## Cause

`placedOn` finds a session only through `sessionMachines`, which holds a session that named a `devcontainer://<folder>` source.
A session that names an existing `computer://<id>` is not a source, so `placedIn` records nothing for it.
The sdk has no way to map a folder to its machine id, because only the computer plugin knows it.

## Impact

A running session can lose its machine when another client stops the folder's dev container.
This applies only to a session placed by computer URI. A session placed by folder is safe.

## Workaround

None. Place a session on a dev container by its `devcontainer://<folder>` source.

## Fix

- Add a lookup to `ContainerPort` that answers the machine a folder is, and compare it with each session's `config.computer`.
- Or let the computer plugin's `stop` and `remove` answer `false` while a session runs in the machine, from its own view of the machine.
