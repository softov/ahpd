---
title: The host emits session events
status: done
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/automations.ts](../../../../packages/sdk/src/host/automations.ts) - the reader of the stream"
---

## Objective

The host turns chat actions into `SessionEvent`s on one stream that the automation code reads.

## Files

- `CREATE: packages/sdk/src/types/triggers.ts` - the types in the plan.
- `CREATE: packages/sdk/src/host/sessionevents.ts` - the stream, and what each session is doing as the events arrive.
- `UPDATE: packages/sdk/src/host.ts` - read every action at the one dispatch funnel a client's action and a backend's both pass through.
- `UPDATE: packages/sdk/src/types/sessions.ts` - the parent link on the session's stored record.
- `UPDATE: packages/sdk/src/sessions.ts` - the parent link in both stores.
- `UPDATE: packages/sdk/src/host/tooling.ts` - record the parent when the `create` tool starts a session.
- `CREATE: packages/sdk/test/session-events.test.ts` - the cases below.

## Steps

1. Emit `turnCompleted`, `turnFailed` and `turnCancelled` from the chat actions that end a turn.
2. Emit `toolFailed` and `toolCalled` from a completed tool call, with the tool name and a hash of its input.
3. Emit `messageQueued` when a message waits behind a running turn.
4. Emit `childFinished` for a worker chat on its session, when its turn ends. Emit the same for a session the `create` tool started, on the session that started it. Say it when that child's last turn ends with nothing queued behind it. Say it again on every later turn that goes quiet, and when the host disposes of the child.
5. When the `create` tool starts a child, record the parent session there, so it outlives a restart.
6. Keep `running`, `queued` and `turnToolCalls` per session, and put them on each event.
7. Emit `idle` at once when the last turn ends and nothing waits behind it.
8. Put `owner`, `provider` and `project` on each event, with where the session works and whether a run made it.
9. Say a turn started on the session's own chat, and not on a worker's. It is a signal of its own and not an event kind. A rule times a long turn from it.

## Validation

- `it('emits turnCompleted, turnFailed and turnCancelled once per turn')`
- `it('emits toolFailed with the tool name and the input hash')`
- `it('emits messageQueued with the queue length while a turn runs')`
- `it('emits childFinished when a subagent ends')`
- `it('emits childFinished on the session that started a child, and keeps the parent link')`
- `it('emits childFinished when a child session goes quiet, and again on a later turn')`
- `it('records the parent of a session the create tool started')`
- `it('reads the session of every chat that moves, and says nothing else about it')`
- `it('stops holding what a chat that is gone was doing')`
- `it('emits idle when the last turn ends and nothing is queued')`
- `it('counts the tool calls of the running turn on each event')`
- `it('says where the session works and whether a run made it, on every event')`
- `it('says a turn started, which is what a rule about a long turn is measured from')`
- Run the full gates from the plan. All pass.

## Resume

Built `types/triggers.ts`, `host/sessionevents.ts`, the parent link on the session store in both implementations, and the wiring at the one funnel in `host.ts`. `session-events.test.ts` has thirteen cases and passes.

`SessionAbout` is what everything the stream says about a session says, and `SessionEvent` and `SessionTurn` are both built on it. Softov added two facts here on 2026-10-07 and both are settled. `folders` is the lead chat's own `workingDirectories()`, which is what the catalogue publishes for the session. `automated` is whether the host has an origin recorded for it, the same map its loop guard reads. `turns` is a second reader beside `watch`, and `moved` is a third. `moved` is what a session does that no event carries, such as a delta or a reasoning chunk. A tool call starting, taking its input or streaming itself does the same. Those are what a rule about a turn that has gone quiet is kept from firing on. Softov settled `childFinished` for a `create`-tool child on 2026-10-07. The child going idle says it, which is that child's last turn ending with nothing queued behind it. Every later turn that goes quiet says it again, and a worker chat keeps saying it when its turn ends. A turn start is said for the session's default chat only, because a worker's turn is the session calling something rather than the session answering. `forget` is what a chat that is gone takes with it. The open turn, the queue and the half-run calls are all keyed by a channel nothing will dispatch on again.

