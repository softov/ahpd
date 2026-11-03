---
title: A bot's failed turn ends as failed
status: done
depends: []
layer: bot
refs:
  - "[code://packages/bot/src/chat.ts#L694-L740](../../../../packages/bot/src/chat.ts#L694-L740) - `finish`, and the turn handle"
  - "[code://packages/bot/src/wake.ts#L483-L502](../../../../packages/bot/src/wake.ts#L483-L502) - `finished`"
  - "[code://packages/bot/src/plugin.ts#L583-L608](../../../../packages/bot/src/plugin.ts#L583-L608) - a back session's turn end"
---

## Objective

A bot's turn whose back session's turn failed ends with `chat/error`, carrying that turn's words.
The chat's log keeps the turn as failed.

## Files

- `UPDATE: packages/bot/src/chat.ts:150-170` - `TurnHandle.fail`.
- `UPDATE: packages/bot/src/chat.ts:694-740` - `finish` says a failed turn as `chat/error`.
- `UPDATE: packages/bot/src/wake.ts:170-180` - `finished` takes the failure's words.
- `UPDATE: packages/bot/src/wake.ts:483-502` - a failure fails the main turn.
- `UPDATE: packages/bot/src/plugin.ts:583-608` - the back session's failure goes to the wake.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - a turn ended as failed.
- `UPDATE: packages/bot/test/bot-post.test.ts` - the wake fails the main turn.
- `UPDATE: packages/bot/test/bot-wake.test.ts` - the handle the wake is given can fail.

## Steps

1. Add `fail` to the turn handle, ending the turn with an error part.
2. Say a failed turn as `chat/error` with its part and duration.
3. Hand the back session's failure to `finished`, and fail the main turn with it.
4. Add a case for the chat's failed turn and one for the wake.

## Validation

- `packages/bot/test/bot-chat.test.ts` and `packages/bot/test/bot-post.test.ts`: both cases fail on `89ebe4d5` and pass after.
- The bot test files pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-02.

- `fail` is optional on the handle, as `working` is; a handle without it ends the turn the way `finished` ended it before.
- On `89ebe4d5`'s sources both cases fail: no handle failed, and no `chat/error` was said.
