---
title: The session methods are one file
status: implemented
depends: [task-01-the-classification-test-reads-every-file.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L8078-L8415](../../../../packages/sdk/src/host.ts#L8078-L8415) - `subscribe`, `fetchTurns`, `completions`, `listSessions`"
  - "[code://packages/sdk/src/host.ts#L8996-L9295](../../../../packages/sdk/src/host.ts#L8996-L9295) - `createSession`, `createChat`, `disposeChat`, `disposeSession`"
  - "[code://packages/sdk/src/host.ts#L9648-L9811](../../../../packages/sdk/src/host.ts#L9648-L9811) - `resolveSessionConfig`, `sessionConfigCompletions`"
  - "[code://packages/sdk/src/host.ts#L540-L575](../../../../packages/sdk/src/host.ts#L540-L575) - `PAGE_CAP`, `PAGE_MOST`, `sealed`, `opened`, read by `listSessions` only"
---

## Objective

`host/sessionmethods.ts` exports a per-connection factory that returns the session methods above, unchanged.

## Files

- `CREATE: packages/sdk/src/host/sessionmethods.ts` - `PAGE_CAP`, `PAGE_MOST`, `sealed`, `opened`, and the ten methods.
- `UPDATE: packages/sdk/src/host.ts` - those removed; spread into `handlers`.

## Steps

1. Move each method with its comment, unchanged but for indentation.
2. `createSession` reads `tokensFor` from the handshake factory (task 02).

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass; `test/host.test.ts`, `test/subscribe.test.ts`, `test/sessions.test.ts`, `test/session-fixed-key.test.ts` cover it.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume

Built 2026-10-04. `packages/sdk/src/host/sessionmethods.ts` (889 lines) holds `PAGE_CAP`, `PAGE_MOST`, `sealed`, `opened` and the ten methods, moved by name rather than by line range so that `createTerminal`, `disposeTerminal`, the automation methods and the `vscode/*` handlers - which sit between them in the literal - stayed where task 05 expects them.

`host.ts` is 3,365 lines.

The paging helpers moved inside the factory body, at two spaces, since nothing outside the factory reads them; `older`, `namesOf`, `SEEDS` and `uriOf` left `host.ts` with the code that used them.

Step 2 needed nothing: `createSession` reads `conn.tokensFor`, which the handshake factory sets on the connection context, so the order of the two factories in `accept` is what carries it rather than a parameter. `accept` builds `const sessionMethods = createSessionMethods(ctx, conn);` after `createHandshake` and spreads `...sessionMethods` after `...methods`.

Validation: `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm test` all pass, 176 files and 2,707 tests. `users-gate.test.ts` still finds the 45 task 01 recorded.
