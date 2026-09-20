---
title: Every printer of the daemon record stays token free, status included
status: done
depends: [task-01-record-the-ready-url.md]
layer: packages/server
refs:
  - code://packages/server/src/main.ts#L271-L318 - the `start`, `stop` and `status` verbs, the three places a record field is printed
  - code://packages/server/src/main.ts#L290-L305 - the `stop` and `status` lines, which must keep reading `url` and never `connectUrl`
  - code://packages/server/src/daemon.ts#L8-L18 - `Running`, whose `connectUrl` is the only field that carries the token
  - code://packages/server/src/daemon.ts#L41-L53 - `running()`, the one reader of the record every verb goes through
  - code://packages/server/src/main.ts#L462-L472 - the child's stdout, which already prints where the secret came from and not the secret
  - code://test/daemon.test.ts - the tests task 01 creates, which this task extends with the no-token case
---

## Objective

Every reader of the daemon record is checked, and `start`, `stop` and `status` print only the token-free `url`, with a tested line builder so `ahpd status` cannot start printing the token that `connectUrl` carries.

## Files

- `UPDATE: packages/server/src/daemon.ts:41-53` - no behaviour change; add the comment that `running()` is the one reader and that a printer takes `url`.
- `UPDATE: packages/server/src/daemon.ts:129-145` - export `statusLine(record: Running): string`, the line `status` prints, built from `url` alone.
- `UPDATE: packages/server/src/main.ts:295-305` - the `status` verb prints `statusLine(found)` instead of formatting the record inline.
- `UPDATE: packages/server/src/main.ts:274-294` - confirm the `start` and `stop` lines read `url`, and leave them as they are.
- `UPDATE: test/daemon.test.ts` - the no-token case over a record whose `connectUrl` carries one.

## Steps

1. Audit every read of `Running` in `packages/server`: `daemon.ts`'s `running()` at line 44, `main.ts`'s `start` at 280, `stop` at 292 and `status` at 296 to 302. Only `connectUrl` may carry the token, and no printer may name it.
2. Export `statusLine(record: Running): string` from `daemon.ts` returning `ahpd on ${record.url} (pid ${record.pid}), started ${record.startedAt}`, and use it in the `status` verb.
3. Leave the `stop` line on `stopped.url` and the `start` line on `begun.url`.
4. Add a comment beside `running()` saying that a caller printing a record takes `url`, because `connectUrl` is the secret.
5. Extend `test/daemon.test.ts` with a record whose `connectUrl` is `ws://127.0.0.1:9187/?tkn=secret` and whose `url` has no token, and assert `statusLine()` contains the origin and neither `connectUrl` nor `tkn=secret`.

## Validation

- `test/daemon.test.ts`: `statusLine({ pid: 42, url: 'ws://127.0.0.1:9187', connectUrl: 'ws://127.0.0.1:9187/?tkn=secret', paths: [], startedAt: '2026-09-19T00:00:00.000Z' })` equals the origin line and contains no `secret`.
- `test/daemon.test.ts`: `running()` on that record answers `url` token-free and `connectUrl` with the token, which is the invariant the printers rely on.
- `pnpm test` green; `pnpm typecheck` and `pnpm boundary` green.
- By hand: `ahpd status` on a daemon started with `--connection-token secret` prints no part of `secret`, and `grep -n "connectUrl" packages/server/src/main.ts` finds no printer.

## Resume

Done.
`statusLine(record)` builds the `status` line from `url`, `pid` and `startedAt` alone, and the `status` verb prints it.
`grep -n "connectUrl" packages/server/src/main.ts` finds nothing, so no printer names the field that carries the token.
`test/daemon.test.ts` holds `statusLine` to the origin line with neither the token nor `connectUrl` in it, and holds a record read back with a token-carrying `connectUrl` to a token-free `url`.
