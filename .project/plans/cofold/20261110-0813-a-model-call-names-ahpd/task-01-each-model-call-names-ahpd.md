---
title: Each model call names ahpd
status: todo
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/agent.ts](../../../../packages/agent-cofold/src/agent.ts) - `CofoldOptions`, `providerOf` and the `openaiCompat` call"
  - "[code://packages/agent-cofold/src/plugin.ts](../../../../packages/agent-cofold/src/plugin.ts) - `apply` and the engine's `open`"
---

## Objective

A cofold agent builds every provider and model with `app: { name: 'ahpd', version: host.version, url: 'https://ahpio.com' }`.

## Files

- `UPDATE: packages/agent-cofold/package.json:72` - `@cofold/model-openai-compat` `^0.3.0`.
- `UPDATE: pnpm-lock.yaml` - the lock for the new range.
- `UPDATE: packages/agent-cofold/src/agent.ts:29-131` - `CofoldOptions` takes `app`.
- `UPDATE: packages/agent-cofold/src/agent.ts:527` - `openaiCompat` gets `app`.
- `UPDATE: packages/agent-cofold/src/agent.ts:721-733` - `openaiCompatProvider` gets `app`.
- `UPDATE: packages/agent-cofold/src/plugin.ts:241` - `apply` builds the app from `host.version` and hands it to each record's options.
- `UPDATE: packages/agent-cofold/test/agent-cofold-models.test.ts` - the cases on the headers.
- `UPDATE: docs/updates/v0_15.md` - one line under *Unreleased*, *Plugins*.

## Steps

1. Read the changes of `@cofold/model-openai-compat` from `0.2.1` to `0.3.0`, and stop if one changes more than the app.
2. Set the range to `^0.3.0`, and run `pnpm install`.
3. Add `app?: AppIdentity` to `CofoldOptions`, with a comment that says what it is.
4. Pass `options.app` to `openaiCompatProvider` in `providerOf` and to `openaiCompat`.
5. In `apply`, build `{ name: 'ahpd', version: host.version, url: 'https://ahpio.com' }`, and pass it to each record's options.
6. Add the cases in *Validation* to `agent-cofold-models.test.ts`.
7. Add the release note line.

## Validation

- A listing of an endpoint sends `user-agent: ahpd/<version>`.
- A listing of `https://openrouter.ai/api/v1` sends `http-referer: https://ahpio.com` and `x-openrouter-title: ahpd`.
- A listing of another host sends neither OpenRouter header.
- A harness provider with its own `user-agent` header sends its own.
- `pnpm typecheck`, then `pnpm exec vitest run packages/agent-cofold`.

## Resume

