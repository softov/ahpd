---
title: A qualified model keeps its provider
status: todo
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/models.ts#L91-L110](../../../../packages/agent-pi/src/models.ts#L91-L110) - `modelFor`, the rule this task changes"
  - "[code://packages/agent-pi/src/backend.ts#L680-L690](../../../../packages/agent-pi/src/backend.ts#L680-L690) - `setModel`, which passes the providers"
  - "[code://packages/agent-pi/src/session.ts#L1074-L1076](../../../../packages/agent-pi/src/session.ts#L1074-L1076) - the start's `setModel`, which gets the log"
---

## Objective

`modelFor` never matches a qualified id against another provider's bare id. A configured model that pi refuses at the start is logged.

## Files

- `UPDATE: packages/agent-pi/src/models.ts:91-110` - `modelFor` takes the provider ids and refuses a qualified id with no exact match.
- `UPDATE: packages/agent-pi/src/backend.ts:680-690` - `setModel` passes the ids of `modelRuntime.getProviders()`.
- `UPDATE: packages/agent-pi/src/session.ts:1074-1076` - a refused configured model logs one `warn` line.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts:148-161` - the `modelFor` case gets an OpenRouter row and a qualified id.
- `UPDATE: packages/agent-pi/test/fake-pi.ts:150-153` - the fake's `setModel` passes its runtime's providers.
- `UPDATE: packages/agent-pi/README.md:84-94` - the record example names `deepseek/deepseek-flash`.

## Steps

1. Add an optional `providers` parameter to `modelFor`, a set of provider ids, with the providers of `models` as its default.
2. After the exact lookup, return `undefined` when the text before the first slash of `wanted` is in `providers`.
3. Update the comment of `modelFor` to say that a qualified id is never read as bare.
4. In `setModel`, pass the ids of `session.modelRuntime.getProviders()` to `modelFor`.
5. At the start's `setModel`, log `${provider}: chat ${start.chatUri} starts on pi's default: pi does not offer ${options.model}` at `warn` when it answers `false`.
6. Add the OpenRouter row and the qualified case to the `modelFor` test.
7. Add a session case: a configured model that the fake refuses logs one `warn` line.
8. Change the README record example to `deepseek/deepseek-flash`.

## Validation

- `agent-pi.test.ts`: `modelFor` gives `undefined` for `deepseek/deepseek-chat` with a `deepseek` provider and an OpenRouter row of that bare id.
- `agent-pi.test.ts`: the old cases still pass, `claude-opus-5` bare and `gpt-5` ambiguous among them.
- `pnpm typecheck` passes.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/agent-pi` passes.

## Resume

