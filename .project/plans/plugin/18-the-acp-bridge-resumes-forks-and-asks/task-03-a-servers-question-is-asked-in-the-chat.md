---
title: A server's question is asked in the chat
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/connection.ts#L162-L214](../../../../packages/agent-acp/src/connection.ts#L162-L214) - the client handlers and the capabilities the bridge advertises"
  - "[code://packages/agent-acp/src/session.ts#L806](../../../../packages/agent-acp/src/session.ts#L806) - `askPermission`, the pattern for a request the person answers"
  - "[code://packages/agent-acp/test/agent-acp.test.ts](../../../../packages/agent-acp/test/agent-acp.test.ts) - the scripted server"
  - https://github.com/microsoft/agent-host-protocol/blob/main/docs/guide/elicitation.md - `chat/inputRequested`, `chat/inputAnswerChanged` and `chat/inputCompleted`, and completing an `elicitation/create` from them
---

## Objective

An `elicitation/create` from an ACP server appears to the person as an input request in the chat, and their answer, decline or cancel is what the server receives.

## Files

- `UPDATE: packages/agent-acp/src/connection.ts:162-214` - advertise `elicitation` and wire `createElicitation` and the `elicitation/complete` notification.
- `UPDATE: packages/agent-acp/src/session.ts` - the handler, beside `askPermission`.
- `UPDATE: packages/agent-acp/src/mapping.ts` - an elicitation's form fields to the input request's questions, and the answers back.
- `UPDATE: packages/agent-acp/test/agent-acp.test.ts` - the cases below.

## Steps

1. Advertise `elicitation` in the client capabilities the bridge sends at `initialize`.
2. On `elicitation/create`, emit `chat/inputRequested` with a stable request id and one question per form field, and `session/inputNeededSet` as a permission does.
3. When the chat's `chat/inputCompleted` arrives, answer the elicitation with the same `accept`, `decline` or `cancel` and the answers as its content.
4. A URL elicitation carries its `url` on the request, and `elicitation/complete` from the server completes it.
5. A turn cancelled while an elicitation is open answers it `cancel`.

## Validation

- `packages/agent-acp/test/agent-acp.test.ts`: a form elicitation is answered from a client and the server receives the content; a decline and a cancel are passed through; a cancelled turn cancels the elicitation.
- `pnpm test`, `pnpm typecheck` green.

## Resume

