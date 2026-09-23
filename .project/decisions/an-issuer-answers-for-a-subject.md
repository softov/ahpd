---
title: An issuer answers for a subject, and the directory still decides what they may do
status: accepted
date: 2026-09-23
refs:
  - "[code://packages/sdk/src/users.ts#L148-L175](../../packages/sdk/src/users.ts#L148-L175) - `Users.verify`, which turns a token into a `Principal` and is the one question an issuer joins"
  - "[code://packages/sdk/src/users.ts#L108-L146](../../packages/sdk/src/users.ts#L108-L146) - `grantsOf` and `principalOf`, the role table the directory already owns"
  - "[code://packages/sdk/src/types/users.ts#L64-L84](../../packages/sdk/src/types/users.ts#L64-L84) - `Principal`, whose `id` is the record's id and becomes the subject an issuer answers with"
  - "[code://packages/sdk/src/host.ts#L5415-L5432](../../packages/sdk/src/host.ts#L5415-L5432) - where `verify` is called and where a refusal becomes `-32007`, which is what an unreachable issuer must not turn into a crash"
  - https://www.rfc-editor.org/rfc/rfc9728.txt - the protected resource publishes `authorization_servers`, and the token is obtained from one of them
---

## Context

A host that is its own issuer has one way to check a token: hash it and compare.
That is exactly what a client which only acquires tokens from an OAuth provider cannot use, because the token was never this host's to mint.
The fix is to name a real authorization server in `authorization_servers` and accept what it issues, which raises one question: where do roles come from once the credential does.

There are two answers.
The issuer could return a `Principal` itself, with the roles written into the issuer's configuration.
Or the issuer could answer only who the token belongs to, and the directory that already holds the roles could answer the rest.

## Decision

An issuer answers one question: **who does this token belong to**, as an opaque subject string.
The roles stay in the directory, and a record's `id` is that subject when an issuer is configured, so `fileUsers` maps the two and `principalOf` is unchanged.
`Users.verify` asks the local hashes first and the issuer only when nothing matched, so a deployment that still mints secrets keeps working and a locally minted token is checked exactly as it was.

An issuer that cannot be reached, or that refuses a token, answers that the token belongs to nobody: the person is unknown and the command is refused `-32007` rather than the host failing with an internal error.
That is a fail-closed answer and it is stated in the docs, because "the issuer is down" and "that token is not ours" look the same to a client.

## Consequences

One file still says who may do what, and it says it the same way for a locally minted secret and an issuer-backed one.
A deployment can run both at once: a person can hold a secret this host minted, or sign in through the issuer, and the record does not care which.
The subject must be the thing the issuer actually returns (`login` for GitHub, `sub` for OpenID Connect), which is a fact an operator has to write down, and a mismatch is indistinguishable from an unknown person.
An issuer is asked on every failed local check, which for a host with no issuer configured is never and for one with an issuer is a network call per sign-in attempt, not per command.
A record with no local secret can never be used at the door as a connection token, because the connection token path calls the same `verify` and the issuer would have to be asked before the socket exists. That is a real limit and the door remains local secrets only.

## Options

- **The issuer returns a `Principal`, with roles in its own configuration.** Rejected: it puts a second role table somewhere other than the user file, so two places decide the same thing and one of them is not the file an operator edits.
- **Roles from the issuer's claims or groups.** Rejected for now: it needs a claim mapping, an issuer that carries groups, and a policy for what a missing claim means. It is a plan of its own once the simple case exists.
- **Add a `principalFor(subject)` method to the `Users` port and have the issuer compose with a separate directory.** Rejected: the port is one question, `verify`, and splitting it into two ports for one feature buys nothing when the same file already holds both halves.
