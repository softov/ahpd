---
title: The roles a claim names
status: done
depends: ["01"]
layer: packages/sdk
refs:
  - "[code://packages/sdk/src/types/users.ts#L96-L134](../../../../packages/sdk/src/types/users.ts#L96-L134) - `UserRecord.rolesFrom` and `IssuerAnswer`"
  - "[code://packages/sdk/src/issuers.ts#L55-L75](../../../../packages/sdk/src/issuers.ts#L55-L75) - `answer`, and `who` on both issuers"
  - "[code://packages/sdk/src/users.ts#L343-L397](../../../../packages/sdk/src/users.ts#L343-L397) - `principalOf` and `rolesFromClaim`"
  - "[code://scripts/dev-issuer.mjs](../../../../scripts/dev-issuer.mjs) - a claim to read"
  - "[code://test/users-issuer.test.ts](../../../../test/users-issuer.test.ts) - the cases"
---

## Objective

A record with `rolesFrom` gets the roles the named claim carries, added to its own, from the same answer the subject came from. A value that names no role this host defines is reported once and dropped, an absent claim contributes nothing, and the file is still the only place a grant is written.

## Files

- `UPDATE: packages/sdk/src/types/users.ts` - `IssuerAnswer { subject, claims }`, `Issuer.who` in place of `Issuer.subject`, and `UserRecord.rolesFrom`.
- `UPDATE: packages/sdk/src/issuers.ts` - `answer`, and `who` on `githubIssuer` and `oidcIssuer`.
- `UPDATE: packages/sdk/src/users.ts` - `rolesFromClaim`, and `principalOf` taking the claim's roles and stamping their grants.
- `UPDATE: packages/sdk/src/index.ts` - export `IssuerAnswer`.
- `UPDATE: scripts/dev-issuer.mjs` - `Bearer ana|eng,ops` answers `groups`.
- `UPDATE: test/users-issuer.test.ts` - the claim cases, and every call site moved to `who`.
- `UPDATE: docs/USERS.md`, `docs/DAEMON.md` - the field and the two clocks.

## Steps

1. Return the whole answer from an issuer: `IssuerAnswer`, `answer()` in `issuers.ts`, and `who` on both implementations.
2. Add `rolesFrom` to the record and keep it through the file's read, so the CLI verbs preserve it.
3. Resolve the claim's values against the roles this file defines and the built-ins, reporting and dropping a value that names nothing.
4. Pass those roles into `principalOf`, which adds them to the record's own and stamps their grants once, beside the live resolution of the record's roles.
5. Let the dev issuer carry groups, so the whole path can be tried without an identity provider.
6. Document the field, the claim-values-are-roles rule, and the two clocks.

## Validation

- `test/users-issuer.test.ts` - the claim's roles are added to the record's; a value that names nothing is reported once and the rest are kept; an absent claim contributes nothing; a claim of one string is read as one value; the file's roles stay live and the claim's are stamped at sign-in; the whole claim set is on the answer.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Done 2026-09-23.
An issuer's answer carries its claims, a record's `rolesFrom` names one, and the roles it holds are added to the record's own. The claim is read at sign-in and the record's roles on every command, which is the decision's deliberate pair of clocks.
