---
title: Posts add to the open main turn
status: implemented
depends: []
layer: bot
refs:
  - "[code://packages/bot/src/wake.ts#L539-L580](../../../../packages/bot/src/wake.ts#L539-L580) - `posted` and `finished`"
  - "[code://packages/bot/src/chat.ts#L799-L820](../../../../packages/bot/src/chat.ts#L799-L820) - `reply` and `end` on the handle"
  - "[code://packages/bot/test/bot-post.test.ts](../../../../packages/bot/test/bot-post.test.ts) - the post cases, which hold one post per turn today"
---

## Objective

Each `post_message` call adds its text to the open main turn.
The main turn ends when the back turn ends, and the subagent call completes when the back session posted.

## Files

- `UPDATE: packages/bot/src/chat.ts` - `say` on `TurnHandle`, a count of posts on `OpenTurn`, and `end` that completes the call of a turn that has posts.
- `UPDATE: packages/bot/src/wake.ts` - `posted` keeps the entry and calls `say`; `finished` ends a posted turn with `end`; `woken` keeps `posted` on a steer.
- `UPDATE: packages/bot/src/post.ts` - `POST_INSTRUCTION`, the tool description and the header comment say that each call posts.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - a case for two posts in one turn, through the protocol's reducer.
- `UPDATE: packages/bot/test/bot-post.test.ts` - the stub handle records posts; the cases for two posts, a post and then the turn's end, and a steer after a post.
- `UPDATE: packages/bot/test/bot-wake.test.ts` - the stub handle has `say`; the cases that post assert a post, not a reply.
- `UPDATE: packages/bot/test/bot-context.test.ts` - the stub handle has `say`.
- `UPDATE: docs/plugins/BOTS.md` - the main turn ends with the back turn, and each post adds to it.
- `UPDATE: packages/bot/README.md` - the same, in one sentence.

## Steps

1. Add `say(text)` to `TurnHandle`: it adds one markdown part to the open turn and keeps the turn open.
2. Give each part the id `<turn>:reply`, then `<turn>:reply2` and on, and emit `chat/responsePart` for it.
3. Make `reply` use the next free id, so a reply after a post does not reuse `<turn>:reply`.
4. Make `end` complete the subagent call when the open turn has a post.
5. Add `posted?: boolean` to `Answering`.
6. Make `posted` set `posted`, call `say`, and keep the entry in `answering`.
7. Make `finished` call `end` for an entry with `posted`, unless the back turn failed.
8. Make `woken` keep `posted` when it writes the entry for a steer into the same main turn.
9. Change `POST_INSTRUCTION` and the tool description: each call posts, and the reply ends when the session's turn ends.
10. Update the stub handles and the cases in the bot tests.
11. Update `docs/plugins/BOTS.md` and `packages/bot/README.md`.

## Validation

- `bot-post.test.ts`: two posts in one turn both reach the handle, and the turn's end then ends the main turn once.
- `bot-post.test.ts`: a steer after a post keeps the post, and the turn's end does not add the last words.
- `bot-chat.test.ts`: two `say` calls and an `end` give one complete turn with two markdown parts and a completed subagent call.
- `pnpm --filter @ahpd/bot test` passes, run alone.
- `pnpm typecheck` and `pnpm boundary` pass.

## Resume

- **Done so far:** every step. `say` is on `TurnHandle`, `posted` keeps the entry, `finished` ends a posted turn with `end`, and `woken` keeps `posted` on a steer. The bot package passes 230 tests.
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** `bot-chat.test.ts` needs `tools/ahp.strict.schema.json`, which `pnpm schema` writes. A fresh worktree does not have it.
