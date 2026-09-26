---
title: A session's folder reaches a machine only where its profile allows it
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/computer/src/plugin.ts#L516-L523](../../packages/computer/src/plugin.ts#L516-L523) - the session's folder written into the disposable profile, past the `bodyMounts` gate"
  - "[code://packages/computer/src/manifest.ts#L514-L538](../../packages/computer/src/manifest.ts#L514-L538) - the `folder` gate a create body passes"
  - "[code://packages/computer/src/runtime.ts#L634](../../packages/computer/src/runtime.ts#L634) - the folder mounted read-write at the same path"
---

## Context

A disposable machine is made with the session's working directory mounted read-write at the same path, so Claude's history is one list inside and out.
A create body may name a `folder` only where the operator set `bodyMounts`, because a folder is the host's filesystem inside the machine.
The session's working directory is chosen by the client, and it reaches the machine without that gate.

## Decision

A profile says whether the session's folder is mounted into a machine made from it, with its own flag, `sessionFolder: true`.
Without the flag, a machine made for a session carries no folder of the session's.
Source: Softov, 2026-09-26, asked "The session folder mounted read-write without `bodyMounts`: accept it, gate it on `bodyMounts` or a per-profile flag, or mount it read-only unless the profile says otherwise?": "gate it with a per-profile flag".

## Consequences

An operator opts a profile in, per profile, and the plugin's `bodyMounts` keeps meaning only what a create body may name.
A profile without the flag loses the same-path history until the operator sets it, which the docs have to say.

## Options

- **Accept it, since the client could run on the host anyway.** Nothing to configure, and a sandbox profile stops being one for the folder the client names.
- **Gate it on `bodyMounts`.** One switch for two different people: a body's author and the session's client.
- **Read-only unless the profile says otherwise.** Safe by default, and a session that edits files cannot write them.
