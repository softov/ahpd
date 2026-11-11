---
title: A pi model named with its provider keeps that provider - implemented
date: 2026-11-11
refs:
  - git://2e5f28906
  - "[code://packages/agent-pi/src/models.ts](../../../../packages/agent-pi/src/models.ts) - `modelFor` takes the provider ids"
  - "[code://packages/agent-pi/src/backend.ts](../../../../packages/agent-pi/src/backend.ts) - `setModel` passes every provider pi has"
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts) - the start logs a configured model pi refuses"
  - "[code://packages/agent-pi/test/agent-pi.test.ts](../../../../packages/agent-pi/test/agent-pi.test.ts) - the cases"
---

A pi model whose first segment is one of pi's providers runs on that provider. Else the session starts on pi's default, and the daemon's log names the model. It never runs on another provider whose own id is spelled the same.

## What was built

- [`code://packages/agent-pi/src/models.ts`](../../../../packages/agent-pi/src/models.ts) - `modelFor` takes `providers`, with the providers of its models as the default, and refuses a qualified id that has no exact match.
- [`code://packages/agent-pi/src/backend.ts`](../../../../packages/agent-pi/src/backend.ts) - `setModel` passes the ids of `modelRuntime.getProviders()`, keyed or not.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - a configured model pi refuses at the start logs one `warn` line: "starts on pi's default: pi does not offer <model>".
- [`code://packages/agent-pi/README.md`](../../../../packages/agent-pi/README.md) - the record example names `deepseek/deepseek-flash`.
- [`code://docs/updates/v0_15.md`](../../../../docs/updates/v0_15.md) - one line under *Plugins*.

## Verified

- `pnpm typecheck` is clean.
- `npx vitest run packages/agent-pi` under the shared lock: 18 files, 277 tests passed.
- A test daemon on port 39200 ran this branch. A record on `deepseek/deepseek-chat` with a DeepSeek key ran on `deepseek/deepseek-flash`, pi's default from its settings file. It logged the line. The same record with a bad key got DeepSeek's 401. On main both had answered on OpenRouter.

## Departures from the plan

- `test/fake-pi.ts` is unchanged: the default of `providers` reads the fake's runtime, so its `setModel` gets the same rule.

## Left for later

- None.
