---
title: The sender's push decides a folder's trust on a host with no people
status: accepted
date: 2026-10-06
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L435-L444](../../packages/sdk/src/host/spawn.ts#L435-L444) - `trustedBy`, which reads the sender's value on such a host"
  - "[code://packages/sdk/src/host/owners.ts#L48-L52](../../packages/sdk/src/host/owners.ts#L48-L52) - `ownerFor`, `undefined` whenever the host was given no people directory"
  - "[code://packages/sdk/src/host.ts#L195](../../packages/sdk/src/host.ts#L195) - `users`, the option `--users` fills"
  - git://fb1f022 - the build this was found in
---

## Context

A host started without `--users` has no people directory, so `ownerFor` answers `undefined` for every connection and every session there has no owner.
`trustedBy` compared the two and refused every folder.
The `workspaceTrust` a window pushed then reached no backend.
An ACP session was refused in every folder, and Claude and pi loaded no project file in any of them.

## Decision

On a host with no people directory, the sender decides which folders a backend trusts.
This is the connection that sent the turn that starts or restarts it, and there is no owner check.
An automation, a host tool and a daemon coming back up send no turn, so what they start is untrusted.

Source: Softov, 2026-10-06, asked "On a host without `--users` (no people, no owners), whose workspaceTrust decides a session's folder?" and chose "The sender's push".

## Consequences

- A window on such a host is trusted for the folders it pushed, which is the deployment that has one person and one machine.
- A host with people is unchanged: there the sender must also own the session.
- Trust stays a connection's own, so one window on such a host never decides for another.

## Options

- **Any connected window decides.** Lost: trust belongs to the connection that pushed it, so a second window would open folders for the first one's session.
- **Every folder is trusted.** Lost: a client that pushed nothing would open every folder, against `a-folder-is-untrusted-until-a-client-says-otherwise`.
