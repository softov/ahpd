---
title: What the issuer left, a provider from the CLI and roles from a claim - implemented
date: 2026-09-23
refs:
  - code://packages/sdk/src/types/users.ts
  - code://packages/sdk/src/issuers.ts
  - code://packages/sdk/src/users.ts
  - code://packages/sdk/src/index.ts
  - code://packages/server/src/main.ts
  - code://scripts/dev-issuer.mjs
  - code://test/users-issuer.test.ts
  - code://docs/USERS.md
  - code://docs/DAEMON.md
---

Two gaps the issuer feature left are closed. A record's provider is set from the command line instead of by editing the file, and a person's roles can come from a claim the issuer answers with, with every grant still written in this host's file.

## What was built

- `code://packages/sdk/src/types/users.ts` - `IssuerAnswer` with the whole claims body beside the subject, `Issuer.who` in place of `Issuer.subject`, and `UserRecord.rolesFrom`.
- `code://packages/sdk/src/issuers.ts` - `answer()`, and `who` on `githubIssuer` and `oidcIssuer`, so the body already fetched for the subject is not fetched again for a claim.
- `code://packages/sdk/src/users.ts` - `rolesFromClaim`, which resolves a claim's values against the roles this file defines and the built-ins and reports one that names nothing; `principalOf`, which adds the claim's roles to the record's own and stamps their grants once while the record's roles are still resolved on every command; `add` taking an optional issuer and refusing a name nothing can resolve.
- `code://packages/server/src/main.ts` - `user add --issuer <name>`, named in the confirmation and the usage line, and `rolesFrom` printed by `user list`.
- `code://scripts/dev-issuer.mjs` - `Bearer ana|eng,ops` answers `sub: ana` with `groups: [eng, ops]`, so the whole claim path is tryable without an identity provider.
- `code://docs/USERS.md` - the field, the claim-values-are-roles rule, the two clocks, and how to try it with the dev issuer.

## Verified

- `test/users-issuer.test.ts`, 23 cases with no network. New: `add` with an issuer sets it, refuses `nope`, and leaves the provider alone without the option; a claim's roles are added to the record's own; one value naming nothing is reported once and the rest kept; an absent claim contributes nothing; a claim of one string is read; the file's roles are live while the claim's are the ones sign-in stamped; the answer carries the whole body.
- `test/users.test.ts`, `test/users-gate.test.ts`, `test/users-host.test.ts`, `test/listen-identity.test.ts`, `test/daemon.test.ts` - unchanged and green.
- `pnpm test` (whole suite), `pnpm typecheck` and `pnpm boundary` green.
- By hand: the dev issuer on 9311, a daemon with `--issuer http://127.0.0.1:9311`, and one record `ana (guest)` with `rolesFrom: "groups"` and a file role `operators` of `file:read file:write`. `authenticate` with `ana|operators` was accepted and `resourceRead` was served; `authenticate` with `ana` alone was accepted and `resourceRead` was refused `-32009`, so the claim is what carried the role. `ahpd user list` printed `rolesFrom=groups`, and `ahpd user add sam --role guest --issuer github` wrote the provider onto a second record.

## Departures from the plan

- None. `Issuer.subject` became `Issuer.who` rather than gaining a second method, so the typecheck names every call site that has to decide what to do with the claims.

## Left for later

- Verifying a JWT locally against an issuer's key set remains deferred in [host/08's deferred.md](../08-an-issuer-behind-the-users-port/deferred.md). It is the smaller network cost and the larger code, and it does not help GitHub, which issues opaque tokens.
- A role that was removed at the issuer stays in force until the next sign-in, which is the deliberate half of the two clocks.
