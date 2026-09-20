---
title: The ready connect URL lives in the daemon record and never on stdout - implemented
date: 2026-09-20
refs:
  - code://packages/server/src/daemon.ts
  - code://packages/server/src/main.ts
  - code://test/daemon.test.ts
---

A person who starts a detached daemon can copy a ready `ws://<host>:<port>/?tkn=<token>` URL out of the 0600 `daemon.json` instead of assembling one, while stdout keeps saying only where the secret came from and `ahpd status` never prints the token.

## What was built

- `code://packages/server/src/daemon.ts` - `Running` carries `connectUrl` beside the token-free `url`; `readyUrl(origin, token)` is the one place the query is appended; `recordOf(announced, pid, token)` builds the record from the child's own announcement; `statusLine(record)` builds the `status` line from `url`, `pid` and `startedAt` alone; and `start(argv, self, token?)` writes the record through `recordOf` at the same mode `0o600`.
- `code://packages/server/src/main.ts` - the `start` verb derives the token with `secret(parse(rest))` before it spawns and passes it to `start()`, and the `status` verb prints `statusLine(found)` instead of formatting the record inline.
- `code://test/daemon.test.ts` - the `readyUrl` and `recordOf` cases, the `statusLine` line, and the read-back through `running()` over a temporary `XDG_CONFIG_HOME`.

## Verified

- `test/daemon.test.ts`: six cases, covering `readyUrl` with a token and without, `recordOf` splitting a real announcement into `url`, `connectUrl`, both paths and the automations line, `statusLine` equal to the origin line with neither `secret` nor `connectUrl` in it, and `running()` reading back a record whose `url` is token-free and whose `connectUrl` carries the token.
- `pnpm test`: 36 files, 641 tests, all passed.
- `pnpm typecheck` and `pnpm boundary` green; `@ahpd/sdk`, `@ahpd/agent-claude` and `@ahpd/server` declare everything their sources import.
- By hand under a temporary `XDG_CONFIG_HOME`: `ahpd start --connection-token secret` printed the origin without the token, wrote `daemon.json` at mode 600 with `url` `ws://127.0.0.1:9187` and `connectUrl` `ws://127.0.0.1:9187/?tkn=secret`, and `ahpd status` then printed the origin, the paths and the automations and no part of `secret`; `grep -n "connectUrl" packages/server/src/main.ts` found nothing.

## Departures from the plan

- None in what was built: the record gains `connectUrl`, the `start` verb passes the token the parent derived, and every printer stays on `url`, exactly as the two tasks specified.
- The checks ran as `pnpm --config.verify-deps-before-run=false <script>`: a concurrent uncommitted change to `package.json` made plain `pnpm` run a dependency install that cannot open the pnpm store, and the flag skips only that pre-check, leaving the `tsc`, `vitest` and `node scripts/boundary.mjs` commands themselves unchanged.

## Left for later

- `docs/DAEMON.md` does not yet point at the ready URL in the record - see [deferred.md](deferred.md).
