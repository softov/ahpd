---
title: A session a client creates is held under its provider's name
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L7187-L7281](../../../../packages/sdk/src/host.ts#L7187-L7281) - `createSession`, where the held name is computed"
  - "[code://packages/sdk/src/host.ts#L408-L422](../../../../packages/sdk/src/host.ts#L408-L422) - `named`, whose comment says the host echoes the client's URI as the key"
  - "[code://packages/sdk/src/host.ts#L942-L958](../../../../packages/sdk/src/host.ts#L942-L958) - `names`, whose comment says the client names the session"
  - "[code://packages/sdk/src/host.ts#L3366-L3368](../../../../packages/sdk/src/host.ts#L3366-L3368) - `names.set(idOf(uri), uri)` in `spawn`"
  - "[code://packages/sdk/src/host.ts#L8401-L8434](../../../../packages/sdk/src/host.ts#L8401-L8434) - resume, which spawns under `nameOf(id)`: the pattern to mirror"
  - "[code://packages/sdk/test/host.test.ts#L6351-L6385](../../../../packages/sdk/test/host.test.ts#L6351-L6385) - `a session a client names`, where the new cases go"
---

## Objective

A session created as `ahp-session:/<uuid>` with `provider: "claude"` is held, listed and announced as `claude:/<uuid>`, and the backend is still handed `<uuid>` as its id.

## Files

- `UPDATE: packages/sdk/src/host.ts:7187-7281` - `createSession` computes ``held = `${provider}:/${idOf(uri)}` `` and passes it to `placedIn`, `openSession` and the `presence` / `activeClientSet` block, instead of `uri`.
- `UPDATE: packages/sdk/src/host.ts:408-422` - the comment on `named`: the client names the id and the host names the scheme, per decision 1; the code is unchanged.
- `UPDATE: packages/sdk/src/host.ts:942-958` and `3366-3368` - the comments: `names` records the held name, which is the provider's.
- `UPDATE: packages/sdk/test/host.test.ts` - new cases under `a session a client names`.

## Steps

1. In `createSession`, compute the held name from `provider` (the resolved one, `params.provider ?? first.provider`) and `idOf(uri)`, applying decision 1.
2. Use it for every call below that line in the handler; `uri` itself is no longer used after it is checked by `named`.
3. Leave `openSession`'s duplicate check as `sessions.has(held)`, so creating `ahp-session:/x` after `claude:/x` exists is refused the same way.
4. Rewrite the three comments so they say what the code does now, without the history.

## Validation

- `host.test.ts`, `a session a client names`:
  - created as `ahp-session:/<uuid>`, `listSessions` returns `resource: "claude:/<uuid>"` and `root/sessionAdded` carries `summary.resource: "claude:/<uuid>"`;
  - subscribing `ahp-session:/<uuid>` returns a snapshot whose `resource` and `defaultChat` are in the `ahp-session:` spelling;
  - the backend's `sessionId` is `<uuid>`;
  - created as `claude:/<uuid>`, nothing changes (the conformance case `takes the session URI VS Code chose, and answers on it` still passes).
- `pnpm -C packages/sdk test` passes.

## Resume

