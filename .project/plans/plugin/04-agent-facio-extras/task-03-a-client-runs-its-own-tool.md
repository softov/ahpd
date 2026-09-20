---
title: A tool a client runs is offered, called, and waited for
status: todo
depends: []
layer: packages/agent-facio
refs:
  - code://packages/sdk/src/types/session.ts#L348-L367 - `toolCallOwner`, `completeToolCall` and `clientGone`
  - code://packages/sdk/src/types/session.ts#L236-L239 - the client tools the host puts in `SessionActiveClient`
  - code://packages/agent-facio/src/tools.ts - `facioTools`, which leaves an owner-bound tool out today
  - code://packages/agent-facio/src/session.ts - where the call would wait
  - code://packages/sdk/src/host.ts - how the host routes a call to its client and answers `completeToolCall`
  - code://test/agent-facio-turn.test.ts - the harness and the host-tool case to follow
---

## Objective

A `BoundTool` with an `owner` is offered to the model, its call is reported with the owner and the input, the facio run waits on it, the owning client's result is handed back as the tool's result, and a client that goes away fails the call rather than leaving the turn hanging.

## Files

- `UPDATE: packages/agent-facio/src/tools.ts` - wrap an owner-bound tool rather than leaving it out, with a `run` that goes through the session.
- `UPDATE: packages/agent-facio/src/session.ts` - the waiting calls, `toolCallOwner`, `completeToolCall` and `clientGone`.
- `CREATE: test/agent-facio-client-tool.test.ts` - the cases below.

## Steps

1. Give `facioTools` the session it belongs to, so an owner-bound tool's `execute` can hand its call over rather than throw or run locally.
2. Hold each owner-bound call by its `callId` with the input, the owner and a resolver, and have `execute` return the promise the resolver settles.
3. Report the call the way the protocol does for a client-run tool: the call's actions carry the owner, the model sees the call as running, and nothing on this host tries to execute it.
4. Implement `toolCallOwner(callId)` so the host can tell a client whether it may write into a call, and `completeToolCall(callId, clientId, result)` so only the owning client settles it - a result from another client is refused, not ignored.
5. Implement `clientGone(clientId)` by failing every call that client owned, with a result that says the client went, because a run waiting on a promise nothing can settle is a turn that hangs for ever.
6. Keep `facioTools`'s filter for a tool with neither an owner nor a `run`: that is a tool nobody can run, and it is still left out.
7. Write the test through the real host: a client announces a tool, the model calls it, the test answers with `completeToolCall` as the host would, and the model's next step receives the result.

## Validation

- `test/agent-facio-client-tool.test.ts`:
  - a client-owned tool is offered to the model, and a call to it reports the owner and does not run on this host.
  - the owning client's `completeToolCall` settles the call and the model's next step carries the result.
  - a `completeToolCall` from another client is refused and the call is still waiting.
  - `clientGone` fails the call with a message the model reads, and the turn finishes rather than hanging.
  - a tool with neither an owner nor a `run` is still not offered.
- `pnpm test` green, `pnpm typecheck` green.

## Resume

Empty until started.
