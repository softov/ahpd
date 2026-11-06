---
title: The bot picker lists readable bots
status: done
depends: []
layer: bot
refs:
  - "[code://packages/sdk/src/types/completions.ts#L21-L38](../../../../packages/sdk/src/types/completions.ts#L21-L38) - `SessionConfigAsk`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1664-L1685](../../../../packages/sdk/src/host/sessionmethods.ts#L1664-L1685) - where the host asks an answerer"
  - "[code://packages/sdk/src/host/spawn.ts#L1030-L1035](../../../../packages/sdk/src/host/spawn.ts#L1030-L1035) - where the host builds `Start`"
  - "[code://packages/bot/src/chat.ts#L1417-L1485](../../../../packages/bot/src/chat.ts#L1417-L1485) - the `bot` completion and `create`"
  - "[code://packages/bot/src/provider.ts#L316-L323](../../../../packages/bot/src/provider.ts#L316-L323) - `mayRead`"
---

## Objective

The `bot` picker offers only the bots its reader may read, and a new Bot chat with another bot is refused.

## Files

- `UPDATE: packages/sdk/src/types/completions.ts:21-38` - `SessionConfigAsk` gets `reader?: Principal`.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1664-1685` - the ask carries `connection.principal` when there is one.
- `UPDATE: packages/sdk/src/host/sessionconfig.ts` - the seed ask carries the reader where the caller has one.
- `UPDATE: packages/sdk/src/types/agent.ts` - `Start` gets `reader?: Principal`.
- `UPDATE: packages/sdk/src/host/spawn.ts:1030-1035` - the start carries `sender.principal` when a connection sent it.
- `UPDATE: packages/bot/src/chat.ts:1417-1424` - the completion filters with `mayRead` when the ask has a reader.
- `UPDATE: packages/bot/src/chat.ts:1472-1485` - `create` throws `There is no bot <slug>.` when the start has a reader that may not read the bot.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - cases for the picker and for `create`, with two users.

## Steps

1. Add `reader` to `SessionConfigAsk` and to `Start`, each with a comment that absent means no connection asked.
2. Pass `connection.principal` into the ask, and `sender.principal` into the start.
3. In the completion, keep a bot only when the ask has no reader or `mayRead(bot, reader)` is true.
4. In `create`, treat a bot the reader may not read as a bot that does not exist.
5. Add cases for users A and B: A sees only A's bots, and `create` refuses B's bot to A.

## Validation

- The new cases fail without the change and pass with it.
- `pnpm --filter @ahpd/sdk test` and `pnpm --filter @ahpd/bot test` pass, run one at a time.

## Resume

- **Done so far:** every step.
- **Found:** `chat.ts` now imports `mayRead` from `provider.ts`, which imports `CHAT_PROVIDER` from `chat.ts`. Both are read inside functions only, so the cycle is safe.
