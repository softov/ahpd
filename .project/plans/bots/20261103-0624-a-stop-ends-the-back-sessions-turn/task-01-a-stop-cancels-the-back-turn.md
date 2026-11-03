---
title: A stop cancels the back turn
status: done
depends: []
layer: bot
refs:
  - "[code://packages/bot/src/chat.ts#L1098-L1105](../../../../packages/bot/src/chat.ts#L1098-L1105) - a bot's stop, which tells the handle's holder"
  - "[code://packages/bot/src/plugin.ts#L506-L530](../../../../packages/bot/src/plugin.ts#L506-L530) - the plugin's `look`, which reads the running turn's id"
  - git://020669b1 - the change, which upstream merged
---

## Objective

A client's stop of a bot's turn cancels the running turn of each back session answering it, with the bot's time for that turn.

## Files

- `UPDATE: packages/bot/src/chat.ts` - `TurnHandle.onStop`, set by `botChatAgent` and called by `cancel`.
- `UPDATE: packages/bot/src/wake.ts` - `Looked.turn`, a clock per back turn begun, and `stopped`.
- `UPDATE: packages/bot/src/plugin.ts` - `look` reads the running turn's id, and a stop goes to the wake.

## Steps

1. Read the cancel in upstream main, which carries it.
2. Check the two cases it brought pass there.
3. Leave the code as it stands, and build task 02 on it.

## Validation

- `packages/bot/test/bot-wake.test.ts` and `bot-chat.test.ts` pass.
- A stopped main turn cancels the back session's turn, and the stop reaches the handle's holder.

## Resume

Nothing to build: upstream merged this change as part of `#195`.

- It was built for an earlier round as `020669b1`, on a branch upstream had already merged.
- Carried onto `a8eff676` as `cccdb02b`, whose 141 changed lines were the same.
- Upstream then merged round 2's union, so main holds it and the carry is dropped.
- Task 02 corrects what that change forgot.
