---
title: A stop cancels the back turn
status: done
depends: []
layer: bot
refs:
  - "[code://packages/bot/src/chat.ts#L1053-L1066](../../../../packages/bot/src/chat.ts#L1053-L1066) - a bot's stop"
  - "[code://packages/bot/src/plugin.ts#L506-L523](../../../../packages/bot/src/plugin.ts#L506-L523) - the plugin's `look`"
  - git://020669b1 - the change, built for an earlier round
---

## Objective

A client's stop of a bot's turn cancels the running turn of each back session answering it, with the bot's time for that turn.

## Files

- `UPDATE: packages/bot/src/chat.ts` - `TurnHandle.onStop`, set by `botChatAgent` and called by `cancel`.
- `UPDATE: packages/bot/src/wake.ts` - `Looked.turn`, a clock per back turn begun, and `stopped`.
- `UPDATE: packages/bot/src/plugin.ts` - `look` reads the running turn's id, and a stop goes to the wake.
- `UPDATE: packages/bot/test/bot-wake.test.ts` - a stopped main turn cancels the back session's turn.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - a stop reaches the handle's holder.

## Steps

1. Apply `020669b1` to upstream main.
2. Compare its changed lines with the original's.
3. Run its two cases on main's sources, and with the change.

## Validation

- The two cases fail on `a8eff676` and pass after.
- The changed lines are `020669b1`'s.

## Resume

Built 2026-11-03 in `cccdb02b`.

- `020669b1` applied to upstream main with no conflict, and its 141 changed lines are the same.
- The patch ids differ for the context alone, which the plans commit before it moved.
- On `a8eff676`'s sources both cases fail: the wake has no `stopped`, and the handle's holder is never told.
