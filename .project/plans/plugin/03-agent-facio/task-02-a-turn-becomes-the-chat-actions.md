---
title: A turn becomes the chat actions a client already knows
status: todo
depends:
  - task-01-the-package-and-the-provider.md
layer: packages/agent-facio
refs:
  - code://packages/sdk/src/types/session.ts - `Session`, `Emit` and `Ran`, what `create` returns
  - code://packages/sdk/src/types/agent.ts#L10-L43 - `BoundTool`, the host tools the model must be offered
  - code://packages/sdk/src/types/host.ts#L279-L332 - `HostTool`, which a bound tool came from
  - file:///github/facio/packages/agents/src/types/event.ts - the `RunEvent` union this task maps
  - file:///github/facio/packages/agents/src/types/run.ts - `run`, `RunHandle`, `submit` and `cancel`
  - file:///github/facio/packages/agents/src/index.ts - `createTool`, `textOf` and the message helpers
  - code://test/example.test.ts#L90-L113 - the turn and the action ordering a backend is expected to keep
---

## Objective

A session created by `facioAgent` runs a facio agent: `begin` calls `run({ agent, session, input })`, each `RunEvent` becomes the `chat/*` action it means, the host tools the session was handed are offered to the model as facio tools, `cancel` reaches `RunHandle.cancel`, and the turn ends with the complete or cancelled action a client watching the chat expects.

## Files

- `CREATE: packages/agent-facio/src/session.ts` - the `Session`, its state and its `begin`, `steer`, `cancel` and `ran`.
- `CREATE: packages/agent-facio/src/mapping.ts` - `RunEvent` to `chat/*`, the one file a facio event change edits.
- `CREATE: packages/agent-facio/src/tools.ts` - a `BoundTool` as a facio `Tool`, and its result as an AHP tool action.
- `CREATE: test/agent-facio-turn.test.ts` - the cases below.

## Steps

1. Write `create(start)` building the facio `Agent` through task 01's factory, with the workspace from `start.workingDirectory`, the session id from the AHP session URI, and the config from `start.settings`.
2. Translate the identity once, deliberately: derive the facio `sessionId` from the AHP session URI in one function with a test, rather than passing a channel URI into a store keyed by ids.
3. Wrap every `BoundTool` in `start.tools` as a facio `Tool` through `createTool`, so the model is offered `sessionTools` and `artifactTools`, and its call runs the host tool and returns its string.
4. Write `begin(turnId, text, model)` calling `run({ agent, session, input: text, signal })` and keeping the `RunHandle`, so `cancel` has something to cancel and the next turn does not start over a live run.
5. Map `run.started` to `chat/turnStarted`, `model.delta` of kind `text` to a response part and `chat/delta`, and `model.delta` of kind `reasoning` to `chat/reasoning`, in the order facio emitted them.
6. Map `tool.proposed`, `tool.started` and `tool.completed` to the three tool-call actions, with the call id, the name, the input, the result and whether it failed, so a client draws the same row a Claude session draws.
7. Map `run.finished` to `chat/turnComplete` with its usage, and a cancelled outcome to `chat/turnCancelled`, and nothing else: an event with no AHP meaning is dropped in `mapping.ts` rather than invented.
8. Write `cancel(turnId)` to `RunHandle.cancel`, and `steer` to `RunHandle.submit`, so the two client actions AHP already has reach the runtime that understands them.
9. Leave `approval.requested`, `input.requested` and the paused run to task 03, and refuse nothing in their place: an unmapped pause is a test failure, not a silent turn end.

## Validation

- `test/agent-facio-turn.test.ts`, with a stub `ModelAdapter` and a memory store, driving the session through the host the way `test/example.test.ts` does:
  - one turn of text emits `chat/turnStarted`, a response part and deltas, and `chat/turnComplete`, in that order.
  - a reasoning delta arrives as `chat/reasoning` and not as response text.
  - a model that calls a host tool produces the three tool-call actions, and the tool's return value is what the model is given back.
  - two turns in one session keep one facio session and produce two complete turns.
  - `cancel` during a turn ends it as `chat/turnCancelled`.
  - a delta carries no event and no second turn is started by the mapping.
- `pnpm test` green, `pnpm typecheck` green.

## Resume

Empty until started.
