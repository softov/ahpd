---
title: An endpoint gets the id it was given
status: todo
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L307-L349](../../../../packages/agent-cofold/src/agent.ts#L307-L349) - `adapterOptionsOf`, the cut this task narrows"
  - "[code://packages/agent-cofold/test/agent-cofold-models.test.ts#L549-L561](../../../../packages/agent-cofold/test/agent-cofold-models.test.ts#L549-L561) - the case beside which the new one goes"
---

## Objective

On an explicit `baseUrl`, a model id keeps its first segment unless that segment names this backend or a harness provider.

## Files

- `UPDATE: packages/agent-cofold/src/agent.ts:340-349` - the `model` field of `adapterOptionsOf` keeps `reference` for a first segment that names nothing here.
- `UPDATE: packages/agent-cofold/test/agent-cofold-models.test.ts:549-561` - a case for an OpenRouter id on an explicit `baseUrl`, the model id and the request body.
- `UPDATE: packages/agent-cofold/README.md:47-49` - one sentence: an id with a slash of its own is sent whole on an explicit `baseUrl`.

## Steps

1. In `adapterOptionsOf`, set `cut` to true when `named` exists and either `provider` exists or `named.provider` equals `own`.
2. Set `model` to `named.modelId` when `cut` is true, else to `reference`.
3. Add a comment over `cut` that says why cofold sends an endpoint's own id whole.
4. Add a test: `modelOf({ baseUrl: 'https://local.example/v1', provider: 'cf-or' }, { model: 'qwen/qwen3-8b' }).modelId` is `qwen/qwen3-8b`.
5. Add to that test a `complete` call whose request body has `model` equal to `qwen/qwen3-8b`.
6. Add the sentence to the README after the sentence on the backend's own prefix.

## Validation

- `agent-cofold-models.test.ts`: the new case passes, and the `cofold/qwen/qwen3-8b` case still gives `qwen/qwen3-8b`.
- `pnpm typecheck` passes.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/agent-cofold` passes.

## Resume

