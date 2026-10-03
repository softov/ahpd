---
title: A session placed off this host has a token of its own
status: blocked
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L8683-L8692](../../../../packages/sdk/src/host.ts#L8683-L8692) - where a session's machine is placed"
  - "[code://packages/sdk/src/host.ts#L4952-L4960](../../../../packages/sdk/src/host.ts#L4952-L4960) - `removeSession`, where the token is dropped"
  - "[code://packages/sdk/src/nested.ts#L115-L129](../../../../packages/sdk/src/nested.ts#L115-L129) - `startInside`, the nested start every road to a nested session goes through"
  - "[code://packages/sdk/src/listen.ts#L57-L68](../../../../packages/sdk/src/listen.ts#L57-L68) - `same`, the constant-time comparison to reuse"
---

## Objective

The host mints a random token inside the nested start of each session whose machine its port calls `remote`, keyed by the session URI, answers whose it is (session, owner, scope) to a caller holding the token, and forgets it in `removeSession`.
Minting in the nested start covers every road that starts one: a create, a resume, a restart of the chat and an automation's start.
This task is `blocked` until the proxy listener plan exists, since the hook it answers is that plan's.

## Files

- `CREATE: packages/sdk/src/session-tokens.ts` - `sessionTokens()`: `mint(session, owner, scope)`, `whose(token)`, `drop(session)`.
- `UPDATE: packages/sdk/src/nested.ts` - the nested start asks the host to mint for the session URI when the port says `remote(id)`; a second start for the same URI replaces the token.
- `UPDATE: packages/sdk/src/host.ts` - the token table beside the sessions, `drop` in `removeSession` (`:4952`), and `whose` exposed on the handle the proxy listener is given.

## Steps

1. 32 random bytes, base64url; only a hash is kept, compared with `same`.
2. For now the table is in memory beside the session, not a principal in the users directory; a resumed session gets a new token, since the old one died with the daemon. `sessionTokens()` is the one place tokens are kept, so a stored form can replace it.
3. Read the proxy listener plan before building `whose`, and match the hook it names; if it names none, stop and ask.

## Validation

- `packages/sdk/test/session-tokens.test.ts`: mint, whose, drop, a wrong token, a token after the session is disposed.
- `nested-start.test.ts`: a create, a resume and a chat restart on a remote machine each mint through the nested start, the last one's token is the one `whose` answers, and `removeSession` drops it.

## Resume
