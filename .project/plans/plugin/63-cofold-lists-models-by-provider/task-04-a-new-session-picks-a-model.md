---
title: A new Cofold session picks a model
status: done
depends: []
layer: "plugin"
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L430-L438](../../../../packages/agent-cofold/src/agent.ts#L430-L438) - `schema`, whose `model` field has no values"
  - "[code://packages/agent-cofold/src/turns.ts#L115-L120](../../../../packages/agent-cofold/src/turns.ts#L115-L120) - a model named on the turn wins over the session's"
  - "[code://packages/agent-cofold/src/agent.ts#L227-L231](../../../../packages/agent-cofold/src/agent.ts#L227-L231) - `modelReferenceOf`, which still reads `settings.model` for a session made before this task"
  - "[code://packages/agent-cofold/test/agent-cofold.test.ts#L24](../../../../packages/agent-cofold/test/agent-cofold.test.ts#L24) - the test that lists the schema's keys"
  - "[code://packages/agent-cofold/test/agent-cofold-modes.test.ts#L109](../../../../packages/agent-cofold/test/agent-cofold-modes.test.ts#L109) - the second test that lists the schema's keys"
---

## Objective

A client draws a Model picker for a new Cofold session from the agent's `models`, as it does for Claude, pi and ACP agents.
Today the session schema has a `model` field with no values, and a client that prefers the schema's `model` draws no picker.

## Files

- `UPDATE: packages/agent-cofold/src/agent.ts:430-438` - remove `model` from the session schema.
- `UPDATE: packages/agent-cofold/test/agent-cofold.test.ts:24` - the schema keys without `model`.
- `UPDATE: packages/agent-cofold/test/agent-cofold-modes.test.ts:109` - the schema keys without `model`.
- `UPDATE: packages/agent-cofold/README.md` - remove `model` from the session settings, if the README lists it there.

## Steps

1. Remove the `model` property from `schema()` in `agent.ts`.
2. Keep each read of `settings.model`, so a session made with that setting still runs on its model.
3. Update the two tests that list the schema's keys.
4. Add a test: a turn with `Message.model` runs on that model, with no `model` in the session config.
5. Run `rg -n "'model'" packages/agent-cofold/src`, and check that no other place offers `model` as a session setting.

## Validation

- `pnpm -s typecheck` passes.
- `pnpm -s vitest run packages/agent-cofold` passes.
- By hand: the ahpw New session composer for Cofold draws a Model pill with the agent's models.
- By hand: a new Cofold session runs its first turn on the model picked there.

## Resume

- **Done so far:** `model` is gone from the session schema.
  `defaults()` no longer names it either, so a new session's config carries no model.
  Every read of `settings.model` stays, so a session made with that setting still runs on its model.
  The two schema tests now expect `baseUrl`, `instructions`, `permissionMode` and `effortLevel` alone.
  A new turn test sends a model on the message and checks the endpoint, key and model id it runs on.
  A search for `'model'` in `packages/agent-cofold/src` finds only `LIVE_KEYS` and `NOT_A_RECORD`, neither of which is a session setting.
  `pnpm -s typecheck`, the full `packages/agent-cofold` suite, `pnpm -s build` and `pnpm -s boundary` pass.
  The two by-hand checks in Validation are not run.
- **Next action:** none.
- **Files:** `packages/agent-cofold/src/agent.ts`, `packages/agent-cofold/test/agent-cofold.test.ts`, `packages/agent-cofold/test/agent-cofold-modes.test.ts`, `packages/agent-cofold/test/agent-cofold-turn.test.ts`, `packages/agent-cofold/test/agent-cofold-config.test.ts`, this task file, `plan.md` and `plans/index.md`.
- **Open questions:** none.
- **Departures:** this task's Files list did not name the defaults or the config test.
  The `model` default had to go with the schema field, so its test now checks that the harness model still reaches `modelOf`.
- **Watch out for:** the agent record's `model` is the agent's default, from the Settings tab. It is not the session schema's `model`, and it stays.
