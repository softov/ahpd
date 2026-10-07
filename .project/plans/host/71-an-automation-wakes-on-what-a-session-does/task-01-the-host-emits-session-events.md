---
title: The host emits session events
status: todo
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/automations.ts](../../../../packages/sdk/src/host/automations.ts) - the reader of the stream"
---

## Objective

The host turns chat actions into `SessionEvent`s on one stream that the automation code reads.

## Files

- `CREATE: packages/sdk/src/types/triggers.ts` - the types in the plan.
- `CREATE: packages/sdk/src/host/sessionevents.ts` - the stream, and the idle timer per session.
- `UPDATE: the host dispatch` - emit from each chat action the plan names.
- `CREATE: packages/sdk/test/session-events.test.ts` - the cases below.

## Steps

1. Emit `turnCompleted`, `turnFailed` and `turnCancelled` from the chat actions that end a turn.
2. Emit `toolFailed` and `toolCalled` from a completed tool call, with the tool name and a hash of its input.
3. Emit `messageQueued` when a message waits behind a running turn.
4. Emit `childFinished` when a subagent or a session this one started ends.
5. Keep `running`, `queued` and `turnToolCalls` per session, and put them on each event.
6. Emit `idle` once per quiet period: the configured minutes after the last turn ended, with no turn since.
7. Put `owner`, `provider` and `project` from the session on each event.

## Validation

- `it('emits turnCompleted, turnFailed and turnCancelled once per turn')`
- `it('emits toolFailed with the tool name and the input hash')`
- `it('emits messageQueued with the queue length while a turn runs')`
- `it('emits childFinished when a subagent ends')`
- `it('emits idle once after the quiet period, and not again until a turn runs')`
- `it('counts the tool calls of the running turn on each event')`
- Run the full gates from the plan. All pass.

## Resume

