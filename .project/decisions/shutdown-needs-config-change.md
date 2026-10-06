---
title: A client's `shutdown` needs `config:change`, and the root connection always may
status: accepted
date: 2026-10-06
refs:
  - "[code://packages/sdk/src/host/vscodemethods.ts#L325-L330](../../packages/sdk/src/host/vscodemethods.ts#L325-L330) - `shutdown`, which stops the daemon"
  - "[code://packages/server/src/commands/run.ts#L630-L634](../../packages/server/src/commands/run.ts#L630-L634) - the daemon wires it to `SIGTERM`"
  - "[code://packages/server/src/commands/restart.ts#L511-L514](../../packages/server/src/commands/restart.ts#L511-L514) - `ahpd restart` asks `config:write`, and over HTTP only the deployment token"
  - "[code://packages/sdk/src/users.ts#L150-L155](../../packages/sdk/src/users.ts#L150-L155) - `config`: `settings` is its read group, `change` its write group"
  - "[code://packages/server/src/commands/scopes.ts#L45](../../packages/server/src/commands/scopes.ts#L45) - a command's scopes are asked with the same `can` the gate asks"
---

## Context

`shutdown` is in neither `NEEDS` nor `UNGATED`, so on a host with a users directory any connection that completed a handshake can stop the daemon.
Something has to be asked of it, and the grant model has no admin grant of its own.
A command's scopes and the gate's grants are one namespace: `checkScopes` asks `actor.can(scope)`, the same check the gate makes.
`ahpd restart` declares `config:write`, which is the `config` subject's write group, and that group holds one operation, `change`.

## Decision

`shutdown` needs `config:change`.
The root connection (the door token, or a host with no users directory) may always call it, as it may everything.
No built-in role but `admin` (through `*:*`) holds it.

Source: Softov, 2026-10-06, asked "What may call `shutdown` on a daemon with users?" and chose "A host admin grant". The grant's name is `(defaulted: config:change, which is what restart's config:write scope holds, so the person who may restart may stop)`.

## Consequences

- A `member` or a `guest` cannot stop the daemon from a window.
- A role that holds `config:write` or `config:change` can stop it, and also change every host-wide root setting; there is no grant for one without the other.
- Over HTTP `ahpd restart` stays the deployment token's alone, so a person with `config:change` may stop a daemon they may not restart. Starting it again is the operator's.

## Options

- **Root only.** Lost: Softov chose a grant a person can hold.
- **A new `daemon:stop` grant.** Lost: a subject for one method, when the config write group already says "may change how this host runs".
- **Any signed-in person.** Lost: a guest could stop every session on the host.
