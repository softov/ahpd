---
title: No provider is read from a scheme
status: todo
depends: [task-01-the-store-keeps-a-sessions-uri.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/tooling.ts#L1028-L1032](../../../../packages/sdk/src/host/tooling.ts#L1028-L1032) - `reportedBy`, which reads `schemeOf(heldAs(uri))`"
  - "[code://packages/sdk/src/plugins/plugins.ts#L1200-L1213](../../../../packages/sdk/src/plugins/plugins.ts#L1200-L1213) - `sessionKept`, which compares the stored provider with `schemeOf(uri)`"
  - "[code://packages/sdk/src/host/routing.ts#L41-L67](../../../../packages/sdk/src/host/routing.ts#L41-L67) - `spaceHere`, `heldAs` and `nameOf`, and the comments on them"
  - "[code://packages/sdk/src/host/channels.ts#L85-L98](../../../../packages/sdk/src/host/channels.ts#L85-L98) - the comment on `named`"
  - "[code://packages/sdk/src/sessions/catalog.ts#L85-L91](../../../../packages/sdk/src/sessions/catalog.ts#L85-L91) - the comment on `uriFor`"
  - "[code://packages/sdk/test/plugin-host.test.ts#L61-L66](../../../../packages/sdk/test/plugin-host.test.ts#L61-L66) - the `sessionKept` cases"
---

## Objective

Nothing in `@ahpd/sdk` reads a session's provider from its URI.
A URI whose scheme is a loaded provider still reaches a session by its id.

## Files

- `UPDATE: packages/sdk/src/host/tooling.ts:1028-1032` - `reportedBy` reads `kept.provider(idOf(heldAs(uri)))` when no chat runs.
- `UPDATE: packages/sdk/src/plugins/plugins.ts:1200-1213` - `sessionKept` compares the held name with the URI it is asked about.
- `UPDATE: packages/sdk/src/host/routing.ts:41-67` - the comments on `spaceHere` and `nameOf` say a provider scheme is an old name and the held name comes from the row.
- `UPDATE: packages/sdk/src/host/channels.ts:85-93` - the comment on `named` cites the new decision and says the client names a new session.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:920-930` - the comment on `createSession` cites the new decision.
- `UPDATE: packages/sdk/src/sessions/catalog.ts:85-91` - the comment on `uriFor` says it is the name of every new session.
- `UPDATE: packages/sdk/test/plugin-host.test.ts:61-66` - `sessionKept` cases for an `ahp-session:` URI and for an old name.
- `UPDATE: packages/sdk/test/host-names.test.ts` - a case for customizations of a session that runs no chat.

## Steps

1. Change `reportedBy` to read the stored provider of the held session.
2. Make `sessionKept` compare the URI it gets with the name the host holds for the session.
3. Keep `spaceHere` as it is, so that a provider scheme still names a session.
4. Change the comments on `spaceHere`, `nameOf`, `named` and `uriFor`.
5. Run `rg -n "schemeOf\(" packages/sdk/src`, and check that no hit reads a session's provider.

## Validation

- Test that a session held as `ahp-session:/<id>` with no chat running reports its provider's customizations.
- Test in `packages/sdk/test/plugin-host.test.ts` that `sessionKept` is true for the held name of a kept `ahp-session:` session.
- Test that `sessionKept('acp:/one')` stays false for a row of `echo`.
- `pnpm boundary`, `pnpm typecheck` and `pnpm test` pass.

## Resume
