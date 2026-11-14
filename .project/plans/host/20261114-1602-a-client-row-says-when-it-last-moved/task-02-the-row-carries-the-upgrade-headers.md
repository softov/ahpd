---
title: The row carries the upgrade headers
status: todo
depends: []
layer: "sdk listen, sdk host, docs"
refs:
  - "[code://packages/sdk/src/types/listen.ts#L40-L56](../../../../packages/sdk/src/types/listen.ts#L40-L56) - `Opened`, which gains `userAgent` and `origin`"
  - "[code://packages/sdk/src/listen.ts#L53-L66](../../../../packages/sdk/src/listen.ts#L53-L66) - `openedOf`, which passes them on"
  - "[code://packages/sdk/src/listen.ts#L283-L314](../../../../packages/sdk/src/listen.ts#L283-L314) - Bun, which reads the request at the upgrade and carries it on `ws.data`"
  - "[code://packages/sdk/src/listen.ts#L371-L393](../../../../packages/sdk/src/listen.ts#L371-L393) - Deno, which reads the request at the upgrade"
  - "[code://packages/sdk/src/listen.ts#L480-L496](../../../../packages/sdk/src/listen.ts#L480-L496) - Node, which reads the request on `connection`"
  - "[code://packages/sdk/src/listen.ts#L761-L766](../../../../packages/sdk/src/listen.ts#L761-L766) - `NodeRequest`, which types the headers it reads"
  - "[code://packages/sdk/src/host.ts#L2235-L2258](../../../../packages/sdk/src/host.ts#L2235-L2258) - `accept`, which keeps them"
---

## Objective

A row carries the `User-Agent` and `Origin` its socket opened with, on Node, Bun and Deno, kept as sent.

## Files

- `UPDATE: packages/sdk/src/types/listen.ts:40-56` - add `userAgent` and `origin` to `Opened`, each documented as a claim kept as sent.
- `UPDATE: packages/sdk/src/listen.ts:53-66` - `openedOf` takes and passes `userAgent` and `origin`.
- `UPDATE: packages/sdk/src/listen.ts:283-314` - Bun reads both headers into `data`, and its `open` passes them to `openedOf`.
- `UPDATE: packages/sdk/src/listen.ts:371-393` - Deno reads both headers and passes them to `openedOf`.
- `UPDATE: packages/sdk/src/listen.ts:480-496` - Node reads both headers and passes them to `openedOf`.
- `UPDATE: packages/sdk/src/listen.ts:761-766` - `NodeRequest` types `user-agent` and `origin`.
- `UPDATE: packages/sdk/src/types/host.ts:2015-2117` - add `userAgent` and `origin` to `Connection`.
- `UPDATE: packages/sdk/src/types/host.ts:179-200` - add `userAgent` and `origin` to `ConnectedClient`.
- `UPDATE: packages/sdk/src/host.ts:2235-2258` - `accept` keeps both from `opened`.
- `UPDATE: packages/sdk/src/host.ts:1973-1984` - `clientRow` copies both when set.
- `UPDATE: packages/sdk/test/listen-identity.test.ts` - a Node socket reports both headers.
- `UPDATE: docs/plugins/PLUGINS.md:1880` - name both fields beside `forwardedFor`, as claims nothing trusts.

## Steps

1. Add `userAgent` and `origin` to `Opened` and to the parameter of `openedOf`.
2. In the Bun branch, read `user-agent` and `origin` from `request.headers` into `data`, and pass them from `ws.data` in `open`.
3. In the Deno branch, read both from `request.headers` and pass them to `openedOf`.
4. In the Node branch, read both from `request.headers` and pass them to `openedOf`.
5. Add `user-agent` and `origin` to the `headers` type of `NodeRequest`.
6. Add both to `Connection` and `ConnectedClient`, and copy them in `accept` and `clientRow`.
7. Write the tests that *Validation* lists.
8. Update the `x-ahpd-clients` section of `PLUGINS.md`.

## Validation

- `packages/sdk/test/listen-identity.test.ts`: a Node socket opened with `User-Agent: ahpc/test` and `Origin: https://example.test` reports both in `Opened`.
- `packages/sdk/test/listen-identity.test.ts`: a Node socket opened with neither header reports neither.
- `packages/sdk/test/host-handshake.test.ts`: a socket accepted with both in `opened` carries both on its row.
- `pnpm --filter @ahpd/sdk test` passes.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- By hand: a Bun and a Deno listener each report both headers. Write the result in *Resume* if no runtime is at hand.

## Resume
