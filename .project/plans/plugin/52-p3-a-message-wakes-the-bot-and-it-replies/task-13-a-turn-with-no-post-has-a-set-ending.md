---
title: A turn with no post has a set ending
status: done
depends: [task-04-post-message-ends-the-main-turn.md]
layer: "packages/bot"
refs:
  - "[code://packages/bot/src/wake.ts#L289-L295](../../../../packages/bot/src/wake.ts#L289-L295) - `finished`, which ends the main turn with a notice"
  - "[code://packages/bot/src/plugin.ts#L264](../../../../packages/bot/src/plugin.ts#L264) - `turn_end` calls `finished`"
  - "[code://packages/bot/src/plugin.ts#L126](../../../../packages/bot/src/plugin.ts#L126) - the plugin options, the pattern for the new option"
---

## Objective

A back session can end its turn without a call to `post_message`.
The bot plugin's option `mainTurnPostMessageAbsent` says what the main turn does then.
The default is `post`, so the person always gets the back session's last words.

| Value | The main turn |
| --- | --- |
| `post` | Ends with the final text of the back session's turn as the reply. A turn with no text ends with nothing. |
| `notice` | Ends with the notice, as it does now. |
| `silence` | Ends with nothing. |
| `postNotice` | Ends with the final text as the reply. A turn with no text ends with the notice. |

## Files

- `UPDATE: packages/bot/src/plugin.ts` - read `mainTurnPostMessageAbsent`, and refuse a value that is not in the table.
- `UPDATE: packages/bot/src/wake.ts` - `finished` gets the final text and acts on the option.
- `UPDATE: packages/bot/test/bot-post.test.ts` - one test for each value.

## Steps

1. Read `mainTurnPostMessageAbsent` from the plugin options, with `post` as the default.
2. Report an unknown value through `host.problem` and use `post`.
3. Find the final text of the back session's turn that ended.
4. Give that text to `finished`.
5. Make `finished` end the main turn as the table says.
6. Change the plan's answer for task 04 to name the option.

## Validation

- `bot-post.test.ts`: test each value with a turn that has text and a turn that has none.
- `bot-post.test.ts`: test that a turn which called `post_message` is not answered twice.
- The gates pass: build, typecheck, boundary, schema and vitest.
