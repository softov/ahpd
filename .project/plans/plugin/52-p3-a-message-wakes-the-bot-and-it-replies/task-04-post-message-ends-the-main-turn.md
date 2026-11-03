---
title: post_message ends the main turn
status: done
depends: [task-03-a-message-wakes-a-back-session.md]
layer: "packages/bot"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L664](../../../../packages/sdk/src/types/plugin.ts#L664) - `registerTool`"
  - "[code://packages/sdk/src/types/host.ts#L676-L680](../../../../packages/sdk/src/types/host.ts#L676-L680) - `HostTool.run(input, at)`, where `at.session` is the caller"
  - "[code://packages/sdk/src/types/events.ts#L221](../../../../packages/sdk/src/types/events.ts#L221) - the `turn_end` event"
---

## Objective

A back session calls `post_message` with a text, and the text is the response of the open main turn.
A back session whose turn ends with no post ends the main turn with a notice.

## Files

- `CREATE: packages/bot/src/post.ts` - the `post_message` tool.
- `UPDATE: packages/bot/src/plugin.ts` - register the tool, and listen to `turn_end`.
- `CREATE: packages/bot/test/bot-post.test.ts` - the tests of the post.

## Steps

1. Register `post_message` with one input, `text`.
2. Find the main turn from `at.session` in the map of task 03, and never from an input.
3. Refuse the call when `at.session` is not a back session, or when its main turn has ended.
4. End the main turn with `reply(text)` of task 02.
5. Listen to `turn_end`, and end the main turn with a notice when the back session ends with the turn open.
6. Write the notice as "<bot name> finished without a reply".

## Validation

- `bot-post.test.ts`: test that a post ends the main turn with its text.
- `bot-post.test.ts`: test that the tool refuses a session that is not a back session.
- `bot-post.test.ts`: test that a turn end with no post gives the notice.
- `pnpm -s exec vitest run packages/bot` passes.
