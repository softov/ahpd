---
title: A role is read on every command, not once at sign-in
status: accepted
date: 2026-09-23
refs:
  - "[code://packages/sdk/src/users.ts#L177-L200](../../packages/sdk/src/users.ts#L177-L200) - `principalOf`, which froze the grants at the moment of verification"
  - "[code://packages/sdk/src/types/users.ts#L34-L60](../../packages/sdk/src/types/users.ts#L34-L60) - `Principal`, which gains `standing`"
  - "[code://packages/sdk/src/host.ts#L7553-L7580](../../packages/sdk/src/host.ts#L7553-L7580) - the command gate, which asks both questions"
  - "[code://packages/sdk/src/host.ts#L6346-L6365](../../packages/sdk/src/host.ts#L6346-L6365) - the dispatch gate, which asks the same two"
  - "[code://docs/USERS.md](../../docs/USERS.md) - the page that claimed this already happened"
---

## Context

The directory re-reads its file on every question, and the documentation promised that this is what makes `ahpd user rm` land on the next command.
It did not. `Users.verify` resolved a record's grants once into a `Set` and the `Principal` closed over it, so a person removed after signing in kept exactly what they had until their socket dropped. The documentation described a behaviour the code did not have.

## Decision

A principal answers from the directory every time the gate asks.
`Principal.standing()` says whether the record is still there and `Principal.can(grant)` resolves the roles the record holds *now*, both by reading the file again.
The gate asks `standing` first and refuses `-32007` when it is false, because the honest answer to a removed person is "sign in again"; it asks `can` second and refuses `-32009`, because a role that does not cover the command is final.
A `Principal` built without `standing` is treated as still standing, so a test or an embedder that hands one in is unaffected.

## Consequences

Removal and a role change both land on the next command, which is what the page already said and what an operator expects when they edit the file.
The gate has two questions instead of one, and they are not interchangeable: one is "who are you" and the other is "may you".
A grant question now reads the file, which is a small synchronous read on a file the host already re-reads for every other question; the role-a-defined-nowhere complaint is still said once, at verification, rather than on every command.
Root is unaffected: it returns before either question is asked, because it holds every capability by being the host and not by being a record.

## Options

- **Re-verify the token on every command.** Rejected: the credential is deliberately not kept, and keeping it to re-hash it per command trades a small file read for holding a secret in memory for the life of the socket.
- **Keep the principal frozen and correct the documentation instead.** Rejected by the user on 2026-09-23: removal taking effect on the next connection is not what they want from editing the file.
- **Refuse a removed person `-32009` like any other denial.** Rejected: it tells the client to stop rather than to sign in, and the two are different facts with different advice.
