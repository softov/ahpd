---
title: chat/inputRequested carries only its request
status: done
depends: []
layer: "agent-claude, examples"
refs:
  - "[code://packages/agent-claude/src/session/asking.ts#L206](../../../../packages/agent-claude/src/session/asking.ts#L206) - `emitOn(scope, { type: 'chat/inputRequested', request })`"
  - "[code://examples/notes/agent.ts#L271](../../../../examples/notes/agent.ts#L271) - the same action in the notes example"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `ChatInputRequestedAction` is `type` and `request` (`channels-chat/actions.ts:908-912`)"
---

## Objective

No `chat/inputRequested` ahpd sends carries `turnId`, live or replayed in a `reconnect`.

## Files

- `UPDATE: packages/agent-claude/src/session/asking.ts:206` - the action is `{ type, request }`.
- `UPDATE: examples/notes/agent.ts:271` - the same.
- `UPDATE: packages/sdk/test/wire.test.ts` - the `ChatInputRequestedAction` `turnId`, `ActionEnvelope /action` `turnId` and `ReconnectResult` `turnId` lines leave `KNOWN`.

## Steps

1. Drop `turnId` at both sites.
2. `rg -n "inputRequested" packages/*/test examples` and fix any assertion on `turnId`.

## Validation

- `packages/sdk/test/wire.test.ts` passes with the three `turnId` lines gone from `KNOWN`; its traffic includes an `AskUserQuestion` call that raises `chat/inputRequested`, so the action is checked live and in the `reconnect` replay.
- `pnpm test` passes.

## Resume
