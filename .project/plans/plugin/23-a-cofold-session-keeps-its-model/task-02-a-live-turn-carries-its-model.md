---
title: A live cofold turn carries its model on the message
status: implemented
depends: []
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/session.ts#L719-L778](../../../../packages/agent-cofold/src/session.ts#L719-L778) - `openTurn` and the queued turn, which set `Turn.model`"
  - "[code://packages/agent-cofold/src/agent.ts#L233-L269](../../../../packages/agent-cofold/src/agent.ts#L233-L269) - `connectionOf`, whose `reference` is the model a turn runs on: `settings.model`, else `options.model`, else the harness file's `model`"
  - "[code://packages/agent-claude/src/session.ts#L2098-L2109](../../../../packages/agent-claude/src/session.ts#L2098-L2109) - the sibling's `message.model`"
---

## Objective

A cofold turn's `chat/turnStarted` carries `message.model` with the reference it runs on, as a claude turn does, so a client reconnecting to a live session shows that model.

## Files

- `UPDATE: packages/agent-cofold/src/session.ts:719-778` - the model goes on `message.model`; `Turn.model` goes.
- `UPDATE: packages/agent-cofold/test/` - the case below.

## Steps

1. Where `openTurn` and the queued turn build `message`, add `model: { id }` with the reference the turn runs on, with the client's `config` when it sent one, as claude does.
   That reference is the one `connectionOf` in `agent.ts` resolves from the turn's values: `settings.model` (the turn's own model applied over the session's), else `options.model`, else the harness file's `model`.
   It is not only `model?.id ?? str(settings.model)` at `session.ts:736`, which misses a model named in the plugin options or the harness file.
2. Remove the non-protocol `Turn.model`; check nothing in agent-cofold or the host reads it first.

## Validation

- An agent-cofold case: a turn started with `message.model.id` `open_router/x` emits `chat/turnStarted` whose `message.model.id` is `open_router/x`, and a turn started with none but a configured model carries the configured one.
  A turn with no model on the message and none in the session settings, but one in the plugin options or in the harness file, still carries that one.
  Today `message.model` is absent.
- `node_modules/.bin/vitest run packages/agent-cofold` green.

## Resume

Implemented 2026-09-27. Both cases were written first and seen to fail: a `chat/turnStarted` message carried no `model`, so the id was `undefined`.

`modelReferenceOf` is exported from `agent.ts` and used by `connectionOf` and by `openTurn`, so the reference on the message is the one the run resolves: the turn's model over the session's, else `options.model`, else the harness file's. `openTurn` puts it on `active.message.model` with the client's `config`, as a claude turn does. The non-protocol `Turn.model` is gone, and `mapTurn`'s `model` still carries the reference for the usage report; nothing in agent-cofold or the host read `Turn.model`.

`node_modules/.bin/vitest run packages/agent-cofold`: 110 passed. `pnpm typecheck`, `pnpm boundary` and `pnpm test`: 103 files, 1363 tests passed.
