---
title: A secret is named in the host's, a team's or a person's scope
status: accepted
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/types/host.ts](../../packages/sdk/src/types/host.ts) - the owner, team and project work is charged to"
---

## Context

A host secret any plugin option may use, a team's provider key and a person's own repository token are different things with different readers.
Without a scope, a person's token would be resolvable by every session on the host.

## Decision

A vault name carries its scope: `host:<name>`, `team:<team>/<name>` or `user:<id>/<name>`.
A `host:` secret resolves for any plugin option or machine; a `team:` secret only for work charged to that team; a `user:` secret only for that person's own sessions and machines.
Source: Softov, 2026-10-02, asked "How are vault names scoped?": "host: team: user:".

## Consequences

Resolution needs the owner and team of the work, which host/34 and host/35 already carry on sessions and machines.
A plugin option resolved when the plugin loads can only name a `host:` secret, since nothing owns a load.

## Options

- One flat namespace: every secret is the host's, and per-person tokens wait.
- A `plugin:` scope as well: left out until a plugin needs a secret no other plugin may read.
