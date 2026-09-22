---
title: A turn becomes the chat actions a client already knows
status: done
depends:
  - task-01-the-package-and-the-provider.md
layer: packages/agent-cofold
refs:
  - code://packages/sdk/src/types/session.ts - `Session`, `Emit` and `Ran`, what `create` returns
  - code://packages/sdk/src/types/agent.ts#L10-L43 - `BoundTool`, the host tools the model must be offered
  - code://packages/sdk/src/types/host.ts#L279-L332 - `HostTool`, which a bound tool came from
  - file:///github/cofold/packages/agents/src/types/event.ts - the `RunEvent` union this task maps
  - file:///github/cofold/packages/agents/src/types/run.ts - `run`, `RunHandle`, `submit` and `cancel`
  - file:///github/cofold/packages/agents/src/index.ts - `createTool`, `textOf` and the message helpers
  - code://test/example.test.ts#L90-L113 - the turn and the action ordering a backend is expected to keep
---

## Objective

A session created by `facioAgent` runs a facio agent: `begin` calls `run({ agent, session, input })`, each `RunEvent` becomes the `chat/*` action it means, the host tools the session was handed are offered to the model as facio tools, `cancel` reaches `RunHandle.cancel`, and the turn ends with the complete or cancelled action a client watching the chat expects.

## Files

- `CREATE: packages/agent-cofold/src/session.ts` - the `Session`, its state and its `begin`, `steer`, `cancel` and `ran`.
- `CREATE: packages/agent-cofold/src/mapping.ts` - `RunEvent` to `chat/*`, the one file a facio event change edits.
- `CREATE: packages/agent-cofold/src/tools.ts` - a `BoundTool` as a facio `Tool`, and its result as an AHP tool action.
- `CREATE: test/agent-cofold-turn.test.ts` - the cases below.

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

- `test/agent-cofold-turn.test.ts`, with a stub `ModelAdapter` and a memory store, driving the session through the host the way `test/example.test.ts` does:
  - one turn of text emits `chat/turnStarted`, a response part and deltas, and `chat/turnComplete`, in that order.
  - a reasoning delta arrives as `chat/reasoning` and not as response text.
  - a model that calls a host tool produces the three tool-call actions, and the tool's return value is what the model is given back.
  - two turns in one session keep one facio session and produce two complete turns.
  - `cancel` during a turn ends it as `chat/turnCancelled`.
  - a delta carries no event and no second turn is started by the mapping.
- `pnpm test` green, `pnpm typecheck` green.

## Resume

Done 2026-09-20.
`packages/agent-cofold/src/session.ts` holds `facioSession(options, start)` and `sessionIdOf(uri)`; `mapping.ts` holds `mapTurn`, the one place a `RunEvent` becomes `chat/*`; `tools.ts` holds `facioTool`/`facioTools`, a `BoundTool` as a facio `Tool` through `createTool`; `agent.ts`'s `create` returns the session; `index.ts` exports the session and the mapping.
`test/agent-cofold-turn.test.ts` is seven tests driving the real `createHost` with `@facio/agents/testing`'s fake model: text in the required order, a delta as a plain action, reasoning as `chat/reasoning`, a host tool called and its result returned to the model, two turns under one facio session, and a cancelled turn.
Verified: `pnpm test` 746 passed over 50 files, `pnpm typecheck` green, `pnpm boundary` green, `pnpm build` builds four packages.
`test/host.test.ts`'s `create-pr` cases flaked once in a full run and once alone, and passed on the next run and in the run after; the plugin and facio code does not touch that path, and the timing sensitivity is pre-existing.
What facio does not carry, found while mapping: `run.finished` has no duration, so the turn's duration is measured from `begin`; `tool.started` has no input, so the input is held from `tool.proposed`; `tool.denied` can arrive for a tool that was never proposed, which has no client row and is dropped; `RunOutcome.stopped` carries a reason with no AHP action, so it ends as complete; and `model.completed` carries the assembled reply, so an adapter with `features.streaming: false` would produce no text at all, which is left for a later task because the shipped `openaiCompat` streams by default.
Departures from the plan: `chat/turnStarted` is emitted from `begin` before `run()` rather than mapped from `run.started`, because the host has already dispatched the action and AHP requires it before any part or delta, so mapping it again would announce one turn twice; `model.completed` is ignored and usage rides `run.finished`'s outcome, because a per-step usage action would report a running total as the whole turn's; a `failed` outcome ends with `chat/error` rather than `chat/turnComplete`; and `tool.denied` closes a proposed call as failed rather than leaving it open.
Left for task 03: `approval.*`, `input.*`, `run.paused`, `run.resumed` and the `awaiting` outcome throw from `mapping.ts`, and `confirm`/`answer` throw, so a pause is loud rather than a silent turn end.
Left for task 04: `storeOf` is called per session, so two sessions of one backend do not share a store, and `list()`/`transcript()` will want one store created once in the `facioAgent` closure; `resume`, `forkPoint` and `endPoint` are absent.
