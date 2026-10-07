---
title: A client's call is recognised when the agent reports it
status: done
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/mapping.ts#L88-L113](../../../../packages/agent-acp/src/mapping.ts#L88-L113) - `callOf`, where the row is opened"
  - "[code://packages/agent-acp/src/mapping.ts#L410-L447](../../../../packages/agent-acp/src/mapping.ts#L410-L447) - `tool_call` and `tool_call_update`"
  - "[code://packages/agent-acp/src/types.ts](../../../../packages/agent-acp/src/types.ts) - `AcpTurn` and `AcpCall`, which gain the owner"
  - "[code://packages/agent-pi/src/mapping.ts#L120-L140](../../../../packages/agent-pi/src/mapping.ts#L120-L140) - pi's `ownerOf` on the turn, the shape to mirror"
---

## Objective

A `tool_call` the agent reports for a client's tool opens with `contributor: { kind: 'client', clientId }`.
The contributor is on `chat/toolCallStart`, `chat/toolCallReady` and the snapshot row.
The running ready opens the call in the sdk holder.

## Files

- `UPDATE: packages/agent-acp/src/types.ts` - `AcpTurn.ownerOf(name, title)`, `AcpTurn.onRunning(call)` and `AcpCall.owner`.
- `UPDATE: packages/agent-acp/src/mapping.ts:88-113, 410-447` - recognise by name, then title; the contributor on start, ready and part; a hook when an owned call's ready goes out running.
- `CREATE: packages/agent-acp/src/session/clientcalls.ts` - the session's `ownerOf` over the tools it may offer, the open, and the holder; the rest of the area is task 03's.
- `UPDATE: packages/agent-acp/src/session.ts`, `packages/agent-acp/src/session/{context,turn,handlers}.ts` - the area wired in, `ownerOf`/`onRunning` on the mapping, and the approval-side open.
- `UPDATE: packages/agent-acp/test/agent-acp-turn.test.ts` - the cases below.
- `UPDATE: packages/agent-acp/test/fixtures/acp-server.mjs` - the `client` script's pending, announced-and-finished and named/title-only shapes.

## Steps

1. Write the cases first and see them fail on the missing contributor.
2. Give the turn the owner lookup from the session's current tools.
3. Match the ACP `name` first, then the `title`.
4. Match each against `<clientId>__<name>`, whole or after `mcp__ahp__`.
5. Treat anything else as no client's call.
6. Put the contributor on the start, and repeat it on the ready as the protocol allows.
7. Call the session's `open` when an owned call's ready goes out running.

## Validation

- `packages/agent-acp/test/agent-acp-turn.test.ts`, written first:
  - a `tool_call` named `mcp__ahp__a__openFile`, and one with only that `title`, opens with client `a` on the start.
  - two clients providing `openFile`: `a__openFile` is `a`'s and `b__openFile` is `b`'s.
  - a `name` that is not a client tool's wins over a `title` that is: the call carries no contributor.
  - a host tool and an agent's own tool carry no contributor.
  - every emitted action passes the protocol's reducers with the contributor kept.

## Resume

- **Done:** `packages/agent-acp/src/types.ts` has `AcpCall.owner`, `AcpTurn.ownerOf(name, title)` and `AcpTurn.onRunning(call)`.
  `mapping.ts` reads the ACP `name` before the `title`, and asks the turn's `ownerOf` once per reported call.
  It puts `contributor: { kind: 'client', clientId }` on the part, the start and the ready.
  A new `running(turn, call, input)` wraps the ready, so an owned call's ready that says the call runs calls `onRunning` first.
  `packages/agent-acp/src/session/clientcalls.ts` is new: the holder from `@ahpd/sdk` over the session's chat, its own `emit`, `start.clientToolTimeoutMs` and a `providers` read from `ctx.offering`.
  `offered(said)` matches a reported name, whole or after `mcp__ahp__`, against a tool the session may offer that has an owner.
  `ownerOf` is the name-then-title lookup.
  `openCall` opens the call under the name the client announced, with the `<clientId>__` stripped.
  `setTools` replaces the offering.
  That area is wired into the session (`Object.assign(ctx, createClientCalls(ctx))`).
  `turn.ts` hands the mapping `ownerOf: ctx.ownerOf` and `onRunning: (call) => ctx.openCall(call, turnId)`.
  `handlers.ts`'s `askPermission` computes the owner from the request's own name and title.
  It puts the contributor on the row and on the emitted `chat/toolCallStart`.
  `confirm` opens an owned call when the approval says yes.
- **Failed first:** the nine new cases in `packages/agent-acp/test/agent-acp-turn.test.ts` were seen to fail before the code answered them.
  Each was then proved to bite by breaking the finished implementation deliberately in three places.
  Title-before-name in `ownerOf`: the precedence case failed with `expected { kind: 'client', clientId: 'a' } to be undefined`.
  `onRunning` called from `callOf` rather than from the running ready: the pending case failed with `expected [ 'session/activeClientSet', …(10) ] to not include 'session/inputNeededSet'`.
  The `finished` guard dropped from `running`: the announced-and-finished case failed the same way, an entry raised for a call the agent had already completed.
  All three breaks were reverted.
- **The task's step 4 was not enough on its own.**
  A call a person is asked about has `asked` set, and `mayReady` holds its ready back for ever.
  So an owned call behind a permission request would never have been opened.
  The client would never have been asked to run it.
  The open is also made from `confirm` when the approval says yes.
  The owner is computed in `askPermission` from the request's own `name` and `title`.
  That is the same name-then-title rule, which is why `ownerOf` is on the area rather than private to the open.
  The plan's second table gains a row for it (source: the code).
  The ACP `hold` case pins it.
- **One member of task 03 landed here, in its smallest form:** `setTools` on the area, which replaces `ctx.offering` whole and returns `true`.
  It is not a second `setTools` - task 03's endpoint and `toolsChanged` work extends this one, and task 03's Files line says so.
  It is here because the lookup a reported call is recognised by is what the offering is.
  A client that arrives after the session opened has to be able to own its calls.
  Because it assigns synchronously before any await, the host's fire-and-forget `retool` is enough for the next turn to see the client's tools.
- **Three cases beyond the task's list:** two clients a and b each own their call.
  The entry at the running ready has the shape the protocol requires.
  That shape is `kind: 'toolClientExecution'`, the chat, the turn, the client, and a `toolCall`.
  The `toolCall` is named as the client announced it, not `a__openFile`.
  No entry is raised while the agent is only holding the call, or for one it announced and finished in one update.
  The fixture's `client` script gained the markers those need - `cstatus=pending` and `cdone` - and `ctool=<name>` on the `hold` script.
- **Written rather than assumed:** the test harness reads the chat from the `subscribe` reply instead of hard-coding it.
  A client that addresses a session by the host's own name is never respelled.
  So the entry's `chat` is the held spelling.
  A case that hard-coded one would be testing a spelling, rather than the lookup every client does.
- **Verification:** `npx vitest run packages/agent-acp/test/agent-acp-turn.test.ts` green, 31 cases; `npx tsc -b` green; `pnpm boundary` green (`@ahpd/agent-acp: 2 declared, none undeclared`).
  The whole `packages/agent-acp` suite is 181 passed and one failure.
  The failure is `agent-acp-machine.test.ts > reaches a disposable machine`.
  It times out at the default 5 s in a file this task does not touch, and passes with `--testTimeout=120000`.
  That is recorded in `implemented.md`.
- **Next action:** [task-02-the-mcp-request-is-paired-to-its-call.md](task-02-the-mcp-request-is-paired-to-its-call.md).
  It extends `clientcalls.ts` with the pairing, the own-row fallback and the runner.
  It extends the fixture with a turn that calls the `ahp` server over HTTP.
