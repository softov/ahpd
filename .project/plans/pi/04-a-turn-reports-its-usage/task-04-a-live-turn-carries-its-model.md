---
title: A live pi turn carries its model on the message
status: done
depends: [task-01-a-turn-sends-its-usage.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L614-L678](../../../../packages/agent-pi/src/session.ts#L614-L678) - `begin`, where the turn and its `message` are built"
  - "[code://packages/agent-cofold/src/session.ts#L738-L760](../../../../packages/agent-cofold/src/session.ts#L738-L760) - the sibling: `message.model` with the reference the turn runs on"
  - file:///github/externals/vscode - `agentHostSessionHandler.ts` `lastTurnModelSelection`: a reopened chat defaults to its last turn's `message.model`
---

## Objective

A pi turn's `chat/turnStarted` and its turn in `chatState()` carry `message.model` with the wire id the turn runs on, and the client's `config` when it sent one, so a client that reconnects shows that model.

## Files

- `UPDATE: packages/agent-pi/src/session.ts` - `begin`.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the case below.

## Steps

1. The id is the one the turn runs on: the turn's own model, else the session's current one, else `options.model`, as a `provider/modelId` wire id.
2. A turn whose model is not known leaves `model` out.

## Validation

- `packages/agent-pi/test/agent-pi.test.ts`: a turn started with `message.model.id` `openrouter/x` emits `chat/turnStarted` with it; a turn with none on a session configured with `openrouter/y` carries `openrouter/y`.
- Seen live on 2026-09-27: `chat/turnStarted` had no `model`.
- `node_modules/.bin/vitest run packages/agent-pi` green.

## Resume

Built.
`session.ts`'s `begin` puts `model: { id, config? }` on the turn's message, with the id the turn runs on: the turn's own choice, else the model the session is already on, else `options.model`, as a `provider/modelId` wire id.
The client's `config` rides only when the turn sent one, and a turn whose model is not known leaves `model` out.
`chat/turnStarted` and the turn in `chatState()` carry the same message.

- Failed first: the turn's own model was absent from `chat/turnStarted` and `chatState()`, and the configured model case read `undefined`.
- `node_modules/.bin/vitest run packages/agent-pi` green, 91 tests; `pnpm typecheck` green.
