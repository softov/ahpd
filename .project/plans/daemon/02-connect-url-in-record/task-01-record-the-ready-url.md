---
title: The daemon record carries a ready connect URL with the token in it
status: done
depends: []
layer: packages/server
refs:
  - code://packages/server/src/daemon.ts#L8-L18 - `Running`, which gains `connectUrl` beside the token-free `url`
  - code://packages/server/src/daemon.ts#L100-L127 - the stdout poll whose match becomes the record's origin
  - code://packages/server/src/daemon.ts#L129-L145 - the record write, which keeps the mode at 0o600
  - code://packages/server/src/main.ts#L271-L289 - the `start` verb, which already parses before spawning and must now pass the token
  - code://packages/server/src/main.ts#L225-L259 - `secret()`, the token's one source
  - code://packages/server/src/main.ts#L457-L472 - the child's startup lines, which stay token-free
  - code://test/update.test.ts#L1-L40 - the temporary `XDG_CONFIG_HOME` pattern the new test follows
---

## Objective

`Running` carries a `connectUrl`, `daemon.ts` builds it from the announced origin and the token the `start` verb passes, and the record is still written at mode 0600, so a person can copy a ready `ws://<host>:<port>/?tkn=<token>` URL out of `daemon.json` while stdout keeps saying only where the secret came from.

## Files

- `UPDATE: packages/server/src/daemon.ts:8-18` - add `connectUrl: string` to `Running` with a comment saying it carries the secret and `url` does not.
- `UPDATE: packages/server/src/daemon.ts:62-64` - change `start(argv, self)` to `start(argv, self, token?)`.
- `UPDATE: packages/server/src/daemon.ts:129-145` - build the record through an exported pure helper `recordOf(announced, pid, token)` and write `connectUrl` beside `url`.
- `UPDATE: packages/server/src/daemon.ts:100-145` - export `readyUrl(origin, token)`, the one place the query is appended, and `recordOf(announced, pid, token)`.
- `UPDATE: packages/server/src/main.ts:274-289` - call `secret(parse(rest))` and pass its token to `start()`.
- `CREATE: test/daemon.test.ts` - the `readyUrl` and `recordOf` cases.

## Steps

1. Add `connectUrl: string` to `Running` in `daemon.ts`, with a comment that it carries the token and `url` does not.
2. Export `readyUrl(origin: string, token?: string): string`: strip a trailing slash from the origin, add one, and append `?tkn=${encodeURIComponent(token)}` only when a token was given.
3. Export `recordOf(announced: string, pid: number, token?: string): Running`, moving the regex reads of `paths` and `automations` out of `start()` and setting `url` to the announced origin and `connectUrl` to `readyUrl(url, token)`.
4. Change `start(argv, self)` to `start(argv, self, token?)` and write `recordOf(announced, child.pid, token)` at the same `mode: 0o600`.
5. In `main.ts`, the `start` verb computes `const { token } = secret(parse(rest))` before `start(rest, process.argv[1], token)`, so the token source is consulted once and a bad combination is refused before anything is spawned.
6. Leave `main.ts:462-472` untouched: the child still prints the origin and where the secret came from, never the secret.

## Validation

- `test/daemon.test.ts`, with `XDG_CONFIG_HOME` in a temporary directory:
  - `readyUrl('ws://127.0.0.1:9187', 'abc')` is `ws://127.0.0.1:9187/?tkn=abc`.
  - `readyUrl('ws://127.0.0.1:9187', undefined)` is `ws://127.0.0.1:9187/`.
  - `recordOf('ahpd on ws://127.0.0.1:9187 (node), sessions in /a, /b\nautomations in /c, schedules fire\n', 42, 'abc')` gives `url` without the token, `connectUrl` with it, `pid` 42, both paths and the automations line.
  - `running()` reads back a record written with `pid: process.pid` and answers both fields.
- `pnpm test` green; `pnpm typecheck` and `pnpm boundary` green.
- By hand: `XDG_CONFIG_HOME=$(mktemp -d) node packages/server/dist/main.js start --connection-token secret` and `stat -c %a "$XDG_CONFIG_HOME/ahpd/daemon.json"` is 600, and the file holds `?tkn=secret`.

## Resume

Done.
`Running` carries `connectUrl`, `readyUrl` and `recordOf` build it, and `start` takes the token the `start` verb derives with `secret(parsed)`.
The record is still written at 0600, and `test/daemon.test.ts` covers the two URL builders and the read-back through `running()`.
Task 02 still has to hold every printer of the record to `url`.
