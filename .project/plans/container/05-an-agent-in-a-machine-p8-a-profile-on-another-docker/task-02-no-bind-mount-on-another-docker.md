---
title: A machine on another Docker takes no bind mount
status: todo
depends: [task-01-a-profile-names-its-docker.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L726-L732](../../../../packages/computer/src/runtime.ts#L726-L732) - `-v` for mounts and the folder"
  - "[code://packages/computer/src/runtime.ts#L736-L744](../../../../packages/computer/src/runtime.ts#L736-L744) - copies by `docker cp`"
  - "[code://packages/computer/src/manifest.ts#L427-L433](../../../../packages/computer/src/manifest.ts#L427-L433) - `manifestOf`, where a body and a profile become a spec"
---

## Objective

A spec for a remote runner carries no `mounts` and no `folder`; a directory or file need becomes a copy-in where the agent allows it and a refusal where it does not, and the plugin's `mounts` option does not apply.

## Files

- `UPDATE: packages/computer/src/manifest.ts` - `ManifestDefaults.remote`: mounts refused with a sentence, `folder` dropped for the clone, directory and file needs turned into `copies`.
- `UPDATE: packages/computer/test/computer-needs.test.ts`.

## Steps

1. A named volume (p6) and an image mount (p4) are Docker-side and stay.
2. The refusal names the profile and the mount.

## Validation

- A profile on another Docker with `mounts` is refused; one with a directory need gets a `docker cp` in the fake's argv and no `-v`.

## Resume
