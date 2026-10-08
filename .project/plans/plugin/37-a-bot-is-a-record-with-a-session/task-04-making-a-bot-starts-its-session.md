---
title: Making a bot with no session starts one
status: todo
depends: [task-01-the-bot-plugin-serves-bot-records.md, task-03-a-plugin-starts-a-session-as-an-owner.md]
layer: "bot"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L317](../../../../packages/sdk/src/types/plugin.ts#L317) - `PluginHost`, with `startSession` from task 03"
---

## Objective

A bot made with no `session` gets one, owned by the bot's owner.
It runs the bot's preset, or its harness and model, in its `workspace` on this host or in its `computer`.
The session's first turn is the bot's instructions, and its title is the bot's name.

## Files

- `UPDATE: packages/bot/src/provider.ts` - a make with no `session` calls `host.startSession` and saves the URI on the record.
- `CREATE: packages/bot/src/start.ts` - the session request from the record: a preset wins over `harness` and `model`; with neither, the host's default harness and its default model.
- `UPDATE: packages/bot/test/bot-provider.test.ts` - the cases below.

## Steps

1. Write the tests.
2. Build the request in `start.ts`, with `workspace` as the working directory, and make the folder when it is not there. On a computer, make it inside the machine.
3. Call `startSession` on a make.
4. When the host refuses the start, refuse the make and save no record.

## Validation

- A test: a bot with a preset starts a session from that preset, also when it has a `harness`.
- A test: a bot with `harness` and `model` starts that harness with that model.
- A test: a bot with neither starts the host's default harness.
- A test: the session's working directory is the bot's `workspace`, and the folder exists.
- A test: a bot with `computer` starts its session in that computer, in the same path.
- A test: the first turn is the instructions, and a bot with none sends no turn.
- A test: a start the owner may not make leaves no record.
- `npx vitest run packages/bot` passes.

## Resume

