---
title: Docker makes a machine from resolved needs
status: implemented
depends: [task-02-the-host-resolves-needs.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L272](../../../../packages/computer/src/runtime.ts#L272) - `docker run` and the label"
  - "[code://packages/computer/src/manifest.ts](../../../../packages/computer/src/manifest.ts) - the profile and manifest fields"
---

## Objective

A profile's `agents` list is read, their needs are resolved through the host at create, mounts and env become `docker run` flags, copy-ins are `docker cp` after create and before start, the session folder is mounted at the same path, and the container is labelled `ahpd.agents=<list>`.

## Files

- `UPDATE: packages/computer/src/manifest.ts` - `agents` on a profile.
- `UPDATE: packages/computer/src/runtime.ts` - the flags, the copy step, the label.

## Steps

1. A profile's own `mounts` stay and are applied as today.
2. Two agents needing the same target is refused at create.

## Validation

- `test/computer-needs.test.ts` against `test/fixtures/docker.mjs`: the flags for each kind, the copy order, the label, the refusals.

## Resume

Done 2026-09-26. `Profile` gains `agents`, `needs` and `folder`, and `plugins.ts` keeps all three. `manifestOf` calls `needsOf` (the host's `machineNeeds`, handed down through the provider) for every agent the profile names, resolves the needs with the profile's and the plugin option's values, and adds the mounts, env, copies and same-path folder to the spec; an unknown agent, a missing host path and two needs at one target are refused there. `MachineSpec` gains `env`, `copies`, `agents` and `folder`; the Docker runtime adds `-e` flags, the `ahpd.agents` label and the folder mount, and makes a machine with a copy as `create`, one `cp` per copy, then `start` - a machine without one stays one `run -d`. `test/fixtures/docker.mjs` answers `create` and `cp` and reports labels; `test/computer-needs.test.ts` is the proof.

Found: `docker run -d` starts what it makes, so a copy-in cannot ride on it; the second path is taken only when a copy exists, which keeps every existing machine and test unchanged. A body's `folder` is gated by `bodyMounts` exactly as `mounts` is, because it is the host's filesystem inside the machine.
