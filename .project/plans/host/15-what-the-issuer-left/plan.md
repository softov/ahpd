---
title: What the issuer left, a provider from the CLI and roles from a claim
domain: host
status: built
priority: medium
created: 2026-09-23
revalidated: 2026-09-23
requires:
  - plans/host/14-a-record-may-name-its-own-issuer/plan.md
changes: []
creates: []
decisions:
  - decisions/a-claim-names-the-roles-this-host-defines.md
refs:
  - "[code://packages/sdk/src/types/users.ts#L96-L134](../../../../packages/sdk/src/types/users.ts#L96-L134) - `rolesFrom` and `IssuerAnswer`"
  - "[code://packages/sdk/src/users.ts#L343-L397](../../../../packages/sdk/src/users.ts#L343-L397) - `principalOf` and `rolesFromClaim`"
  - "[code://packages/sdk/src/issuers.ts#L60-L72](../../../../packages/sdk/src/issuers.ts#L60-L72) - `answer`, which keeps the claims"
  - "[code://packages/server/src/main.ts](../../../../packages/server/src/main.ts) - `user add --issuer`, and the flag parsing it joins"
  - "[code://scripts/dev-issuer.mjs](../../../../scripts/dev-issuer.mjs) - the claim a test can read"
  - "[code://docs/USERS.md](../../../../docs/USERS.md) - the operator's side"
---

## Goal

The two things an issuer can do that it could not: a record's provider is set from the command line rather than by hand, and the roles come from a claim the issuer answers with, while this file stays the only place a grant is written down.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "\\.subject\\(" packages test` - eight call sites, one in `verify` and seven in the issuer suite, so the answer shape changes in two files and nowhere else.
- `rg -n "user add|--role|--issuer" packages/server/src/main.ts` - the `user` verb parses its own flags after `--users`, so the record's provider is one more case in that loop and not a new verb.
- `rg -n "rolesFrom|claim" packages/sdk/src` - nothing existed, so the field, the resolution and the stamp are all new.

### Gaps

- A record's `issuer` could only be written by editing the file, which the CLI then preserved but could not set.
- `Issuer.subject` threw the rest of the answer away, so a claim was a second request that the host would have had to keep the token for.
- Nothing decided what a role from an issuer means, so the obvious wrong answer - a claim value as a grant - was one line away.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A claim names the roles, and this file defines them](../../../decisions/a-claim-names-the-roles-this-host-defines.md) | The user, 2026-09-23: "c now, then b", choosing the roles-from-claims option after the deferred item named "a claim mapping" as what it needs. |

| What | Source | Task |
| --- | --- | --- |
| The claim's values are role names, never grants | decision 1 | 02 |
| An absent claim contributes nothing | decision 1 | 02 |
| Claim roles are stamped at sign-in, the record's roles stay live | decision 1 | 02 |
| `user add` takes `--issuer` and leaves a record's provider alone without it | decision 1 | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A record's provider from the command line](task-01-a-provider-from-the-command-line.md) | done | - |
| [02 - The roles a claim names](task-02-the-roles-a-claim-names.md) | done | 01 |

## Risks and tradeoffs

- The issuer can now add a role this host defines, so an administrator of that provider can promote somebody within the host's own roles.
  The mitigation is decision 1: a value that names no role here does nothing, and a grant can only be written in this file.
- Claim roles are stamped at sign-in and the record's roles are live, which is two clocks on one principal.
  The mitigation is that both are stated where a person reads them, and the alternative - keeping the token - is worse.
- `--issuer` on `user add` with no `--role` sets the roles to `guest`, which is what the verb already did.
  The mitigation is that the message names the roles it set, and the file shows what changed.

## Resume state

- **Done so far:** both tasks, 2026-09-23. `user add --issuer` sets a record's provider and refuses one nothing resolves; a record's `rolesFrom` reads a claim from the same answer the subject came from, and the file still defines every grant. See [implemented.md](implemented.md).
- **Next action:** none; the plan is built.
- **Open questions:**
  1. Are a claim's values roles or grants? - answered by decision 1: roles, so a grant is never written outside the file.
  2. Is the claim read on every command? - answered by decision 1: no, it is stamped at sign-in, because re-asking needs the token at rest.
- **Watch out for:** `Issuer.who` replaced `Issuer.subject`, so every implementation and every test passes the answer object now. A claim value that is one string is read as one value and an array is read as many, because providers do both.

## Final verification checklist

- [x] `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- [x] `test/users-issuer.test.ts` - `add` with an issuer sets it, refuses an unresolvable one, and leaves the provider alone without the option; a claim's roles are added to the record's; a value that names nothing is reported once and dropped; an absent claim contributes nothing; a claim of one string is read; the file's roles stay live and the claim's are stamped.
- [x] `scripts/dev-issuer.mjs` answers `groups` for `Bearer ana|eng,ops`.
- [x] `plans/index.md`, `docs/USERS.md`, `docs/DAEMON.md` and `working/HANDOFF.md` updated.
