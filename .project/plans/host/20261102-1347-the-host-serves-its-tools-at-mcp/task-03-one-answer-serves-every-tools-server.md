---
title: One answer serves every tools server
status: todo
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/tools/server.ts#L211-L264](../../../../packages/sdk/src/tools/server.ts#L211-L264) - `answered`, the JSON-RPC answer for one message"
  - "[code://packages/sdk/src/tools/server.ts#L330-L364](../../../../packages/sdk/src/tools/server.ts#L330-L364) - the method, body and notification checks of `request`"
  - "[code://packages/sdk/src/index.ts#L54](../../../../packages/sdk/src/index.ts#L54) - what the package exports from the server"
---

## Objective

One exported function answers a request against a list of tools, after the caller is known.
The session servers and `/mcp` both use it, and a session's server answers exactly as before.

## Files

- `UPDATE: packages/sdk/src/tools/server.ts:211-364` - move the method, body and message checks with `answered` into `answerTools`.
- `UPDATE: packages/sdk/src/index.ts:54` - export `answerTools`.
- `UPDATE: packages/sdk/test/toolserver.test.ts` - `answerTools` called on its own.

## Steps

1. Define `answerTools(request, serving, info)`, where `serving` holds `tools`, `runClient`, `toolsChanged` and `mayRun`.
2. Move the `GET`, method, JSON, batch and notification checks from `request` into it.
3. Keep the token check in `request`, before `answerTools`, so a wrong token learns nothing.
4. Let a `GET` with `toolsChanged: 'list'` answer 405, as today.
5. Call `answerTools` from `request` with the session's `Serving`.
6. Export `answerTools` and its options type from the package index.

## Validation

- `packages/sdk/test/toolserver.test.ts` and `packages/sdk/test/toolauth.test.ts` pass with no change to their existing cases.
- `packages/sdk/test/toolserver.test.ts` holds: `answerTools` answers `initialize`, `tools/list` and `tools/call` for a list of tools.
- `pnpm --filter @ahpd/sdk test -- toolserver` passes.
- `pnpm typecheck` passes.

## Resume
