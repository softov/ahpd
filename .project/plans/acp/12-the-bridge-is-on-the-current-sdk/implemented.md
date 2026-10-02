---
title: The bridge is on the current SDK entry, and lists sessions properly - implemented
date: 2026-10-02
refs:
  - "[code://packages/agent-acp/src/connection.ts](../../../../packages/agent-acp/src/connection.ts)"
  - "[code://packages/agent-acp/src/catalog.ts](../../../../packages/agent-acp/src/catalog.ts)"
---

The bridge is on `@agentclientprotocol/sdk` `^1.5.0` through `client({ name }).connect(stream)`, reports the package version in `clientInfo`, follows `session/list` pages to the end, and keeps one listing connection per registration that closes after a minute idle.

## What was built

- [`code://packages/agent-acp/src/connection.ts`](../../../../packages/agent-acp/src/connection.ts) - one handler per client method on the SDK's client app; calls go through `connection.agent.request`; `CLIENT_INFO.version` from `sdkVersion()`.
- [`code://packages/agent-acp/src/catalog.ts`](../../../../packages/agent-acp/src/catalog.ts) - `listingFor`, `idleClose`, `dropListing`; the page loop stops at a missing cursor or one handed back twice.
- The fixture gained a paged mode; `agent-acp-catalog.test.ts` covers paging and reuse.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm boundary` clean, `pnpm test` 162 files and 2394 tests.
- Read against the plan: same SDK, v1 protocol kept, one minute idle.

## Departures from the plan

- The version is the workspace's, read through `@ahpd/sdk`; every package carries the same version.
- Review added the stop on a repeated cursor.

## Left for later

- none.
