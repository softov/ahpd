---
title: A session records its owner
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L7857](../../../../packages/sdk/src/host.ts#L7857) - where `createSession` opens a session"
  - "[code://packages/sdk/src/sessions.ts#L76-L86](../../../../packages/sdk/src/sessions.ts#L76-L86) - the persisted shape"
---

## Objective

A session created by a signed-in person has `owner: 'user:<id>'`, kept by the session store and restored at start.

## Files

- `UPDATE: packages/sdk/src/host.ts:7857` - pass the connection's principal into `openSession`; store `owner` on the held session.
- `UPDATE: packages/sdk/src/sessions.ts:76-86` - `owner?: string` in `Saved`, written and read like `flags`.
- `UPDATE: packages/sdk/src/types/sessions.ts` - the `SessionStore` record gains `owner`.

## Steps

1. No users directory or a root connection: no owner.
2. A fork or a session made by a tool keeps the owner of the session it came from.

## Validation

- `packages/sdk/test/sessions.test.ts`: `owner` round-trips; a file without it loads.
- A host test: a session created over a signed-in connection has the owner, and after reload too.
- `pnpm -F @ahpd/sdk test`.

## Resume
