---
title: The model API has its own gate - implemented
date: 2026-11-05
refs:
  - git://4b5e1290 - the merge of #237
  - "[code://packages/server/src/commands/run.ts](../../../../packages/server/src/commands/run.ts) - the model paths served on the `modelApi` gate"
---

The model calls and the HTTP API are two gates on the same token. A host can serve its model API without `/api` and `/mcp`, or the other way round, and `ahpd config set` writes the key.

## What was built

- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - the model paths on their own gate.
- [`code://packages/server/src/commands/config.ts`](../../../../packages/server/src/commands/config.ts) - `ahpd config set` for the `modelApi` key.

## Verified

- The new cases in `server-http.test.ts`, `proxy-listener.test.ts`, `config-set.test.ts`, `config-check.test.ts`, `server-commands.test.ts` and `server-root-config.test.ts` fail without the change.
- CI on main after #242 passed every check.

## Departures from the plan

- The change is in a new `Unreleased` section of `docs/updates/v0_15.md`, because rc.1 was published.
- A refusal of `ahpd config set` throws out of `Program.run`, as the plugin config cases expect.

## Left for later

- none
