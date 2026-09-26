---
title: The host opens a subagent chat for a backend
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/agent.ts#L93](../../../../packages/sdk/src/types/agent.ts#L93) - `Start`"
  - "[code://packages/sdk/src/host.ts#L1142-L1165](../../../../packages/sdk/src/host.ts#L1142-L1165) - `chatUriFor` and `sessionOfChat`"
  - "[code://packages/sdk/src/host.ts#L774-L784](../../../../packages/sdk/src/host.ts#L774-L784) - `chatSummary`"
  - "[code://packages/sdk/src/host.ts#L6350](../../../../packages/sdk/src/host.ts#L6350) - `session/chatAdded` for a second chat"
---

## Objective

A backend can ask the host for a read-only subagent chat tied to one of its tool calls, write to it, and end its turn.

## Files

- `UPDATE: packages/sdk/src/types/agent.ts` - `Start.subagent?(toolCallId, { title, agentName?, description?, prompt?, parentToolCallId? })` returning `{ uri, emit(action), end(state) }`.
- `UPDATE: packages/sdk/src/host.ts` - the seam, the URI, the summary and the refusal.
- `CREATE: test/subagent-chat.test.ts`.

## Steps

1. Name the chat `ahp-chat://subagent/<base64url session>/<encodeURIComponent(toolCallId)>`, and teach `sessionOfChat` the `subagent` authority so a subscribe to it finds its session.
2. On the first call for a tool call id, dispatch `session/chatAdded` with `interactivity: 'read-only'` and `origin: { kind: 'tool', chat, toolCallId }`, where `chat` is the chat the call is in: the main chat, or the subagent chat of `parentToolCallId` when nested.
3. Dispatch `chat/turnStarted` on it with the prompt as the message.
4. Append `{ type: 'subagent', resource, title, agentName, description }` to the spawning call's content with `chat/toolCallContentChanged`, keeping what the call already had.
5. A second call for the same id returns the same chat without announcing it again.
6. Refuse a client's `chat/turnStarted` on a read-only chat.
7. Disposing the session removes its subagent chats.

## Validation

- A fake backend opening a subagent chat produces `chatAdded`, `turnStarted` and the content on the call, and all three validate against the protocol schema.
- Subscribing to the chat returns its state; a client turn on it is refused.
- A nested one's origin names the parent subagent chat.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.

## Resume

