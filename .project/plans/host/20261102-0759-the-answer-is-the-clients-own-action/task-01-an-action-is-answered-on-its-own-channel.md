---
title: An action is answered on its own channel
status: done
depends: []
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `answering` and the `owed` keys"
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts) - the channel check before any handler, and a session's flag"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - the rename and the config change on a chat's channel"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts) - `handed`, which looks the dispatch up on the channel the action belongs to"
---

## Objective

A dispatch is answered only by an action on the channel it was sent on.
A `chat/*` action off a chat's channel is refused.
A `session/*` action sent on a chat's channel of its session is answered on that chat's channel.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `answering` tests the channel and every name the client's action carries; `owed` is keyed by the dispatch's channel.
- `UPDATE: packages/sdk/src/host/actions.ts` - a `chat/*` action off a chat's channel is refused; a session's flag sent on a chat's channel is answered there.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - a rename and a config change sent on a chat's channel are answered there.
- `UPDATE: packages/sdk/src/host/spawn.ts` - `handed` looks for a session action's dispatch on the session's channel.
- `UPDATE: packages/sdk/test/echo-origin.test.ts` - a `chat/*` action on a session channel is refused, and a rename on a chat's channel is answered there.
- `UPDATE: packages/sdk/test/*.test.ts` - each test sends a chat action on the chat's channel.

## Steps

1. Match the current dispatch by its channel, its type, and each of `turnId`, `toolCallId`, `requestId` and `id` it carries.
2. Key `owed` by the channel the dispatch came on, and remove `chatAbout`.
3. Refuse a `chat/*` action whose channel is not an `ahp-chat:` URI.
4. Answer a session's rename, flag or config change sent on a chat's channel with the client's action on that channel.
5. Leave out a chat's moves for an action of another kind said on its channel.

## Validation

- `pnpm exec vitest run packages/sdk/test/echo-origin.test.ts` - passes; the new cases fail on c3c8c3e4.
