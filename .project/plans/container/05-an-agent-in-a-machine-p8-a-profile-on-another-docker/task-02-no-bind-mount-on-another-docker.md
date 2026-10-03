---
title: A machine on another Docker takes no bind mount
status: todo
depends: [task-01-a-profile-names-its-docker.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L726-L732](../../../../packages/computer/src/runtime.ts#L726-L732) - `-v` for mounts and the folder"
  - "[code://packages/computer/src/runtime.ts#L736-L744](../../../../packages/computer/src/runtime.ts#L736-L744) - copies by `docker cp`"
  - "[code://packages/computer/src/manifest.ts#L508](../../../../packages/computer/src/manifest.ts#L508) - `manifestOf`, where a body and a profile become a spec"
  - "[code://packages/agent-cofold/src/agent.ts#L586-L592](../../../../packages/agent-cofold/src/agent.ts#L586-L592) - cofold's config need, a file that holds provider keys"
  - "[code://packages/sdk/src/types/machine.ts#L19-L38](../../../../packages/sdk/src/types/machine.ts#L19-L38) - `Need`, where the credential mark goes"
---

## Objective

A spec for a remote runner carries no `mounts` and no `folder`; a directory or file need becomes a copy-in where the agent allows it and a refusal where it does not, and the plugin's `mounts` option does not apply.
A directory or file need marked as holding credentials (cofold's config file, Claude's `~/.claude` and `.claude.json`) is refused on a remote runner rather than copied, since a copy would put the host's keys on another box; p12 task 03 covers copies and env together.

## Files

- `UPDATE: packages/computer/src/manifest.ts` - `ManifestDefaults.remote`: mounts refused with a sentence, `folder` dropped for the clone, directory and file needs turned into `copies`.
- `UPDATE: packages/sdk/src/types/machine.ts:19-38` - `Need.credential?: boolean`, documented as "this need's source holds a credential".
- `UPDATE: packages/agent-cofold/src/agent.ts:586-592` and `packages/agent-claude/src/claude.ts` (the config dir and `.claude.json` needs) - `credential: true`.
- `UPDATE: packages/computer/test/computer-needs.test.ts`.

## Steps

1. A named volume (p6) and an image mount (p4) are Docker-side and stay.
2. The refusal names the profile and the mount.
3. A need with `credential: true` whose source is the agent's own default (the host's file) is refused on a remote runner, naming the need and the agent, and is never turned into a copy. A profile that gives that need its own value, a file the operator wrote for that box (a cofold config that points at p12's proxy and holds no key), is copied as any other need.

## Validation

- A profile on another Docker with `mounts` is refused; one with a directory need gets a `docker cp` in the fake's argv and no `-v`.
- A cofold session on a profile on another Docker is refused naming `cofoldConfig`, and no `docker cp` of it is recorded; with the profile's `needs.cofoldConfig` naming another file, that file is copied.

## Resume
