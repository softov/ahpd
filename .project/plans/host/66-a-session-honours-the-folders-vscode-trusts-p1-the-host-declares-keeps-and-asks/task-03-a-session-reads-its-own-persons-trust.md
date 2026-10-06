---
title: A session reads its own person's trust
status: todo
depends: [task-02-workspacetrust-is-kept-per-connection.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/owners.ts#L94-L97](../../../../packages/sdk/src/host/owners.ts#L94-L97) - who sent each running turn"
  - "[code://packages/sdk/src/types/agent.ts](../../../../packages/sdk/src/types/agent.ts) - what a backend is started with"
---

## Objective

When the host starts or restarts a backend, it hands it whether each of the session's folders is trusted, read from the connection that sent the turn that starts or restarts it, and only when that sender is the session's owner; otherwise, and with no value or no connection (an automation), every folder is untrusted ([the decision](../../../decisions/a-folder-is-untrusted-until-a-client-says-otherwise.md)).

## Files

- `UPDATE: packages/sdk/src/types/agent.ts` - the start carries `trusted: (folder) => boolean` or a per-folder answer; today a backend is told nothing.
- `UPDATE: packages/sdk/src/host/spawn.ts` - where the start is built.
- `UPDATE: packages/sdk/test/` - the cases below, with a fake backend.

## Steps

1. Failing case first: two people; A trusts `/a`, B trusts nothing; B starts a session in `/a`. The fake backend must be told `/a` is not trusted. Today it is told nothing.
2. A's own session in `/a` is told it is trusted.
3. A turn A sends into B's session in `/a`: untrusted, since A is not the owner.
4. An automation's session: untrusted.

## Validation

- The case fails on `e1c4ccc` and passes after.

## Resume
