---
title: A cofold model on an explicit endpoint keeps its slashes - implemented
date: 2026-11-11
refs:
  - git://999d8dfe8
  - "[code://packages/agent-cofold/src/agent.ts](../../../../packages/agent-cofold/src/agent.ts) - `adapterOptionsOf` cuts the first segment only where it names something"
  - "[code://packages/agent-cofold/test/agent-cofold-models.test.ts](../../../../packages/agent-cofold/test/agent-cofold-models.test.ts) - the case"
---

A cofold agent on an explicit `baseUrl` sends the endpoint the model id it was given. The first segment goes only when it names the agent or a provider of the harness file.

## What was built

- [`code://packages/agent-cofold/src/agent.ts`](../../../../packages/agent-cofold/src/agent.ts) - `cut` in `adapterOptionsOf`: true for a file provider or the backend's own id, and the model is `reference` otherwise.
- [`code://packages/agent-cofold/test/agent-cofold-models.test.ts`](../../../../packages/agent-cofold/test/agent-cofold-models.test.ts) - "sends an endpoint its own id with a slash whole": the model id, the backend's own prefix, and the request body.
- [`code://packages/agent-cofold/README.md`](../../../../packages/agent-cofold/README.md) - one sentence after the one on the backend's own prefix.
- [`code://docs/updates/v0_15.md`](../../../../docs/updates/v0_15.md) - one line under *Plugins*.

## Verified

- `pnpm typecheck` is clean.
- `npx vitest run packages/agent-cofold` under the shared lock: 18 files, 323 tests passed.
- A test daemon on port 39200 ran this branch. A record on OpenRouter with `deepseek/deepseek-chat` answered; on main it got a 400. A DeepSeek record and a harness record still answered.

## Departures from the plan

- None.

## Left for later

- None.
