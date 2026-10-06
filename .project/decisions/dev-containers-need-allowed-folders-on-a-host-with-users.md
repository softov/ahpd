---
title: On a host with a users directory, no dev container is made until `devcontainer.folders` is set
status: accepted
date: 2026-10-06
refs:
  - "[code://packages/computer/src/plugin.ts#L443-L454](../../packages/computer/src/plugin.ts#L443-L454) - `devcontainer.folders`, where absent allows any folder"
  - "[code://packages/computer/src/plugin.ts#L481-L490](../../packages/computer/src/plugin.ts#L481-L490) - `folderFor`, which every dev container route asks"
  - "[code://docs/COMPUTER.md#L537-L547](../../docs/COMPUTER.md#L537-L547) - `computer:write` and a `devcontainer.json`, and the allowed folders"
  - git://52f98f6 - container/03, which made a dev container a computer
---

## Context

With `devcontainer.folders` unset, any folder with a `devcontainer.json` may be built from.
A `devcontainer.json` can ask for `--privileged`, mounts and run arguments, and the Dev Container CLI applies them, so on a host where several people sign in, anybody who holds `computer:write` can get a privileged container on the host by pointing at a folder they wrote.
On a host with one person on it that person already holds the host, and "absent allows any" asks nothing of them.

## Decision

On a host with a users directory, every dev container route (the create body, the `devcontainer://<folder>` setting, the picker's row and the relay's `connect`) refuses until `devcontainer.folders` is set, with a sentence naming the option.
On a host without one, an unset `devcontainer.folders` still allows any folder.
`devcontainer: false` still switches every route off on both.

Source: Softov, 2026-10-06, asked "With devcontainer.folders unset, anyone with computer:write can run a devcontainer.json with --privileged. What should happen?" and chose "Required with users".

## Consequences

- A host that adds a users file stops making dev containers until its operator names the folders; the refusal and `docs/COMPUTER.md` say so.
- The computer plugin has to know whether the host has a users directory, which its context does not tell it today.

## Options

- **Absent allows any, everywhere.** Lost: `computer:write` would be root on a shared host by way of a file anybody can write.
- **Required everywhere.** Lost: a single-person host would have to configure what it gains nothing from.
