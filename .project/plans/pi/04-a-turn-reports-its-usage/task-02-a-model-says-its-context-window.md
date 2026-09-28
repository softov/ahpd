---
title: A model says its context window
status: implemented
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/models.ts#L20-L24](../../../../packages/agent-pi/src/models.ts#L20-L24) - `PiModel`, as much of a pi model as is read"
  - "[code://packages/agent-pi/src/models.ts#L61-L84](../../../../packages/agent-pi/src/models.ts#L61-L84) - `offered`"
---

## Objective

Each model a pi session offers carries `maxContextWindow` and `maxOutputTokens` when pi knows them.

## Files

- `UPDATE: packages/agent-pi/src/models.ts:20-24` - `PiModel` gains optional `contextWindow` and `maxTokens`.
- `UPDATE: packages/agent-pi/src/models.ts:61-84` - `offered` sets `maxContextWindow` and `maxOutputTokens` from them when they are positive numbers.
- `UPDATE: test/agent-pi.test.ts` - the case below.

## Steps

1. Add the two fields to `PiModel`.
2. Set them in `offered`, leaving each out when pi did not give a number.

## Validation

- `test/agent-pi.test.ts`: `offered` of a model with `contextWindow: 200000, maxTokens: 64000` has both fields; one without has neither.
- `pnpm test`, `pnpm typecheck`, `pnpm wire` green.

## Resume

Built.
`PiModel` has optional `contextWindow` and `maxTokens`, and `offered` sets `maxContextWindow` and `maxOutputTokens` from each when it is a positive number, leaving both off for a model pi knows nothing about.

- `test/agent-pi.test.ts` covers a known model offering both and an unknown one offering neither, and the session's own model list carrying both ids.
- pi/09 task 09 later removed the undeclared `session/modelsChanged` announcement this task used, so the fields reach a client only through `offered` where a client is offered the model.
- `pnpm test` 102 files, 1371 tests; `pnpm typecheck` and `pnpm boundary` green.
