---
title: A session placed off this host has a token of its own
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L8683-L8692](../../../../packages/sdk/src/host.ts#L8683-L8692) - where a session's machine is placed"
  - "[code://packages/sdk/src/host.ts#L4886-L4897](../../../../packages/sdk/src/host.ts#L4886-L4897) - `removeSession`, where the token is dropped"
  - "[code://packages/sdk/src/listen.ts#L57-L68](../../../../packages/sdk/src/listen.ts#L57-L68) - `same`, the constant-time comparison to reuse"
---

## Objective

The host mints a random token for each session whose machine its port calls `remote`, answers whose it is (session, owner, scope) to a caller holding the token, and forgets it when the session is disposed.

## Files

- `CREATE: packages/sdk/src/session-tokens.ts` - `sessionTokens()`: `mint(session, owner, scope)`, `whose(token)`, `drop(session)`.
- `UPDATE: packages/sdk/src/host.ts` - mint after `placedIn` for a remote machine, drop in `removeSession`, and expose `whose` on the handle proxy 02's listener is given.

## Steps

1. 32 random bytes, base64url; only a hash is kept, compared with `same`.
2. For now the table is in memory beside the session, not a principal in the users directory; a resumed session gets a new token, since the old one died with the daemon. `sessionTokens()` is the one place tokens are kept, so a stored form can replace it.
3. Read proxy 02's plan before building step 3 of the objective, and match the hook it names; if it names none, stop and ask.

## Validation

- `packages/sdk/test/session-tokens.test.ts`: mint, whose, drop, a wrong token, a token after the session is disposed.

## Resume
