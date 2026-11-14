---
title: The row says where and what it holds
status: done
depends: [task-01-the-row-says-who-and-which-client.md]
layer: "sdk listen, sdk host, docs"
refs:
  - "[code://packages/sdk/src/types/listen.ts#L40-L56](../../../../packages/sdk/src/types/listen.ts#L40-L56) - `Opened`, which gains `path`"
  - "[code://packages/sdk/src/listen.ts#L53-L66](../../../../packages/sdk/src/listen.ts#L53-L66) - `openedOf`, where `path` is cut from `url`"
  - "[code://packages/sdk/src/listen.ts#L129-L133](../../../../packages/sdk/src/listen.ts#L129-L133) - `pathOf`, reused as it is"
  - "[code://packages/sdk/src/host.ts#L2235-L2258](../../../../packages/sdk/src/host.ts#L2235-L2258) - `accept`, which keeps `path` and `node`"
  - "[code://packages/sdk/src/host.ts#L2268-L2271](../../../../packages/sdk/src/host.ts#L2268-L2271) - the queue limit"
  - "[code://packages/sdk/src/host.ts#L274-L289](../../../../packages/sdk/src/host.ts#L274-L289) - `presence`, read for `sessions`"
  - "[code://packages/sdk/src/host/handshake.ts#L947-L953](../../../../packages/sdk/src/host/handshake.ts#L947-L953) - the shape of a kept token"
---

## Objective

A row says the path its socket opened on and the node that admitted it.
It also says the services it pushed a token for, the sessions it is in, and the bytes queued for it.

## Files

- `UPDATE: packages/sdk/src/types/listen.ts:40-56` - add `path` to `Opened`, documented as the URL without its query.
- `UPDATE: packages/sdk/src/listen.ts:53-66` - `openedOf` sets `path` from `pathOf(url)` when it is not empty.
- `UPDATE: packages/sdk/src/types/host.ts:2015-2035` - add `path` and `node` to `Connection`.
- `UPDATE: packages/sdk/src/types/host.ts:179-200` - add `path`, `node`, `authenticated`, `sessions`, `queuedBytes` and `queueLimit` to `ConnectedClient`.
- `UPDATE: packages/sdk/src/host.ts:2235-2258` - `accept` keeps `opened.path` and `opened.node` on the connection.
- `UPDATE: packages/sdk/src/host.ts:1973-1984` - `clientRow` copies `path` and `node`, and reads `authenticated`, `sessions`, `queuedBytes` and `queueLimit`.
- `UPDATE: packages/sdk/test/listen-identity.test.ts` - a Node socket opened with `?tkn=` reports `path` with no query.
- `UPDATE: packages/sdk/test/host-handshake.test.ts` - cases for the new fields.
- `UPDATE: docs/plugins/PLUGINS.md:1876` - name the new fields, and say a row never carries the query or a token.

## Steps

1. Add `path` to `Opened`, and set it in `openedOf` from `pathOf(seen.url)`.
2. Add `path` and `node` to `Connection`, and copy them from `opened` in `accept`.
3. Add the six fields to `ConnectedClient`, with one doc line each.
4. In `clientRow`, copy `path` and `node` when present.
5. In `clientRow`, set `authenticated` to the distinct `resource` of each value in `connection.tokens`, when there is one.
6. In `clientRow`, set `sessions` to `ctx.nameOf(id)` for each `presence` entry that holds the connection's client id, when there is one.
7. In `clientRow`, set `queuedBytes` from `connection.peer.buffered?.()` when it is a number.
8. In `clientRow`, set `queueLimit` from `clientQueueBytes(ctx.rootConfig)` when it is a number.
9. Write the tests that *Validation* lists.
10. Update the `x-ahpd-clients` section of `PLUGINS.md`.

## Validation

- `packages/sdk/test/listen-identity.test.ts`: a Node socket opened on `/?tkn=secret` reports `path: '/'`, and nothing it reports holds `secret`.
- `packages/sdk/test/host-handshake.test.ts`: a socket accepted with `opened.path` and `opened.node` carries both on its row.
- `packages/sdk/test/host-handshake.test.ts`: after `authenticate` with a token for one resource, the row carries `authenticated: [resource]` and no token text.
- `packages/sdk/test/host-handshake.test.ts`: after `session/activeClientSet` on a session, the row carries that session's URI in `sessions`.
- `packages/sdk/test/host-handshake.test.ts`: a peer whose `buffered` answers 42 gives `queuedBytes: 42`.
- `pnpm --filter @ahpd/sdk test` passes.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- By hand on a test daemon: ahpw's own row carries `path`, `sessions` while a session is open, and `queuedBytes`.

## Resume

The six row fields are built: `path`, `node`, `authenticated`, `sessions`, `queuedBytes` and `queueLimit`.
`path` is cut by `pathOf` in `openedOf`, and `accept` keeps `path` and `node` on the connection.
`clientRow` reads `authenticated` from the distinct resource of each pushed token, `sessions` from `presence`, and `queuedBytes` from `peer.buffered()`.
`queueLimit` is always set, since `clientQueueBytes` always answers a number; the plan named it absent when unknown, which never happens.
`listen-identity.test.ts` checks that `path` is `/` for a socket opened on `/?tkn=secret`, and that no field a row carries holds the token.
`host-handshake.test.ts` checks `path` and `node` on the row, `authenticated` with no token text, `sessions` after `session/activeClientSet`, and `queuedBytes: 42`.
Both test files pass, and `pnpm exec tsc -p tsconfig.json --noEmit` is clean.
`PLUGINS.md` names the six fields and says a row never carries the URL's query or a token.
The by-hand check on a test daemon was not run; the same row is read by `clientRegistry.connected()` in the tests.
