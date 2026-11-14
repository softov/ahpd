---
title: A client row sends what the host holds - implemented
date: 2026-11-14
refs:
  - git://a5effff43
  - "[code://packages/sdk/src/types/host.ts](../../../../packages/sdk/src/types/host.ts)"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
  - "[code://packages/sdk/src/types/listen.ts](../../../../packages/sdk/src/types/listen.ts)"
  - "[code://packages/sdk/src/listen.ts](../../../../packages/sdk/src/listen.ts)"
  - "[code://docs/plugins/PLUGINS.md](../../../../docs/plugins/PLUGINS.md)"
---

A row on `x-ahpd-clients://` now says what the host already held about each connection. It says which client it is, where its socket came in, and what it holds: roles, capabilities, sessions, pushed tokens and a send queue.

## What was built

- [`code://packages/sdk/src/types/listen.ts`](../../../../packages/sdk/src/types/listen.ts) - `Opened` gains `path`, the URL without its query.
- [`code://packages/sdk/src/listen.ts`](../../../../packages/sdk/src/listen.ts) - `openedOf` cuts `path` from `url` with `pathOf`.
- [`code://packages/sdk/src/types/host.ts`](../../../../packages/sdk/src/types/host.ts) - `Connection` gains `path` and `node`; `ConnectedClient` gains `path`, `node`, `authenticated`, `sessions`, `queuedBytes` and `queueLimit`.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `accept` keeps `path` and `node`; `clientRow` reads all six, plus the task 01 fields.
- [`code://packages/sdk/test/listen-identity.test.ts`](../../../../packages/sdk/test/listen-identity.test.ts) - the path is cut at the query.
- [`code://packages/sdk/test/host-handshake.test.ts`](../../../../packages/sdk/test/host-handshake.test.ts) - the row carries `path`, `node`, `authenticated`, `sessions` and `queuedBytes`.
- [`code://docs/plugins/PLUGINS.md`](../../../../docs/plugins/PLUGINS.md) - the `x-ahpd-clients` section names every new field and says a row never carries the query or a token.

## Verified

- `packages/sdk/test/listen-identity.test.ts` passes, 15 tests.
- `packages/sdk/test/host-handshake.test.ts` passes, 58 tests.
- `pnpm exec tsc -p tsconfig.json --noEmit` is clean.
- The by-hand check in task 01 found the missing `name` in ahpc's client library, not the host. `AhpClient.initialize` in `@microsoft/agent-host-protocol` 1.0.0 sends no `clientInfo` and no `capabilities`.
- Reviewed on 2026-11-14: `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass.
- `npx vitest run packages/sdk` under the vitest lock passes 4810 with 5 skipped and 1 failed. The failure is `plugin-own-sessions.test.ts`, which passed three runs out of three on its own: its fixed 20 ms wait, which #331 replaced with a wait for the echo.

## Departures from the plan

- The *Answers* row named `queuedBytes` and `queueLimit` each absent when unknown. `clientQueueBytes` always answers a number, so `queueLimit` is always set.
- The *Answers* row said the missing `name` is fixed in task 01 if the cause is in the host. The cause is in the client library, so nothing in the host changed and no test was added.

## Left for later

- ahpc sends no `name`, `clientVersion` or `capabilities` until its client library sends `clientInfo` and `capabilities`, or ahpc sends `initialize` itself. That fix is ahpc's.
- The by-hand check on a test daemon was not run. It would show ahpw's own row carries `path`, `sessions` and `queuedBytes`; the tests read the same row through `clientRegistry.connected()`.
- The collected fields the next plan sends: `lastIn`, `lastOut`, `lastPing`, `arrival`, `User-Agent`, `Origin` and `refused`. See [the next plan](../20261114-1602-a-client-row-says-when-it-last-moved/plan.md).
- The brief stays until that plan covers it.
