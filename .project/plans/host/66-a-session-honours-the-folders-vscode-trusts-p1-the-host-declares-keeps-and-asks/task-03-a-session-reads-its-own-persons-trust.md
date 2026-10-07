---
title: A session reads its own person's trust
status: done
depends: [task-02-workspacetrust-is-kept-per-connection.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/owners.ts#L94-L97](../../../../packages/sdk/src/host/owners.ts#L94-L97) - who sent each running turn"
  - "[code://packages/sdk/src/types/agent.ts](../../../../packages/sdk/src/types/agent.ts) - what a backend is started with"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts) - `trustedBy`, where the answer is read"
  - "[code://packages/sdk/src/repo/worktrees.ts](../../../../packages/sdk/src/repo/worktrees.ts) - where a worktree sits beside its repository"
---

## Objective

When the host starts or restarts a backend, it hands it whether each session folder is trusted.
The trust comes from the connection that sent the turn that starts or restarts it.
On a host with people that connection must also own the session ([the sender's decision](../../../decisions/the-sender-decides-on-a-host-with-no-people.md)).
A session in a worktree reads the trust of the repository it was cut from ([the worktree decision](../../../decisions/a-worktree-inherits-its-repositorys-trust.md)).
No window is asked about the worktree.
With no value, or with no connection (an automation), every folder is untrusted ([the decision](../../../decisions/a-folder-is-untrusted-until-a-client-says-otherwise.md)).

## Files

- `UPDATE: packages/sdk/src/types/agent.ts` - the start carries `trusted: (folder) => boolean` or a per-folder answer; today a backend is told nothing.
- `UPDATE: packages/sdk/src/host/spawn.ts` - where the start is built.
- `UPDATE: packages/sdk/test/` - the cases below, with a fake backend.

## Steps

1. Failing case first: two people; A trusts `/a`, B trusts nothing; B starts a session in `/a`. Expect the fake backend to hear a no for `/a`; today it hears nothing.
2. A's own session in `/a` hears a yes.
3. A turn A sends into B's session in `/a`: untrusted, since A is not the owner.
4. An automation's session: untrusted.
5. A host with no people directory: the sender's push decides for its own session.
6. An automation's session on that host: untrusted, whatever any window pushed.
7. A session in a worktree: the repository's trust decides.

## Validation

- The case fails on `e1c4ccc` and passes after.

## Resume
