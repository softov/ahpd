---
title: A claim names the roles, and this file defines them
status: accepted
date: 2026-09-23
refs:
  - "[code://packages/sdk/src/types/users.ts#L96-L134](../../packages/sdk/src/types/users.ts#L96-L134) - `UserRecord.rolesFrom` and `IssuerAnswer`, which is where the claims now travel"
  - "[code://packages/sdk/src/users.ts#L343-L397](../../packages/sdk/src/users.ts#L343-L397) - `principalOf` stamping the claim's grants, and `rolesFromClaim`"
  - "[code://packages/sdk/src/issuers.ts#L60-L72](../../packages/sdk/src/issuers.ts#L60-L72) - `answer`, which keeps the whole body beside the subject"
  - "[code://scripts/dev-issuer.mjs](../../scripts/dev-issuer.mjs) - the throwaway issuer, which now carries `groups`"
  - "[code://docs/USERS.md](../../docs/USERS.md) - what an operator writes"
---

## Context

An issuer answered who a token belonged to and nothing else, so the roles always came from this file.
That is the safe half of the split - the identity provider says who, the host says what they may do - and it means a group somebody is in at the issuer has to be written into the file again, by hand, and kept in step.

The answer already carries the rest: an OpenID Connect `userinfo` returns whatever claims the provider was configured to release, and GitHub's user endpoint returns a body with `login` beside plenty else.
Reading a claim is one field of an answer this host already fetched, so the question is not whether it can, it is which claim and what its values mean.

The fork is the mapping, and the risk of getting it wrong is that the issuer becomes the authority on what a person may do.

## Decision

A record may name `rolesFrom`, the claim whose values are role names.
The values are added to the record's own `roles`, and a value that names no role this file defines and no built-in is reported once and dropped, the way a role on a record is.
The file stays the only place a grant is written down: the issuer names roles, never grants.
An absent claim contributes nothing, because an issuer that omits a group is answering rather than refusing.
A record reached by a minted secret has no issuer answer to read, so `rolesFrom` does nothing for one.

The claim is read once, at sign-in, from the same answer the subject came from.
The record's own roles are still resolved on every command, so the two halves have different clocks: a change at the issuer lands on the next sign-in, and a change in the file lands on the next command.
That is deliberate - asking again would mean keeping the token, and a host that kept a bearer token to re-ask would be holding a credential it does not need.

## Consequences

A person's group at an identity provider can be their role here without a second list to maintain, which is what makes an issuer worth configuring for a team rather than for one login.
The issuer is now half an authority: it cannot grant anything this file does not define, but it can add a role the file defines, so an administrator of that provider can promote somebody within the roles this host has.
A value that names nothing is a message on stderr and not a failed sign-in, so a typo in a group name is visible and harmless.
The whole claim body is now in memory for the length of one sign-in and no longer, because answers travel with `who` and nothing stores them.
The two clocks are a thing to document, because a person whose group was removed at the issuer keeps the role until they sign in again.

## Options

- **The claim's values are grants.** Rejected: it hands the provider the ability to write permissions this file never named, and a compromised or misconfigured provider would be host-wide power with no local line to review.
- **A per-record map from claim value to roles.** Rejected: it repeats on every record for the same result, and the file can define a role named after the group instead, which is the same thing with one place to read it.
- **A host-wide mapping in the configuration.** Rejected: the configuration is not where per-person facts live, and with per-record issuers the claim name is not one value for the whole host.
- **Read the claim on every command, keeping the token.** Rejected: re-asking needs the bearer token at rest, and a credential kept to answer a question the file can answer is a credential that can be stolen.
- **A fixed claim name, such as `groups`.** Rejected: providers disagree (`groups`, `roles`, a namespaced claim), and one field on the record says it without a second configuration.
