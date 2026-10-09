---
title: Making a bot with no session starts one
status: done
depends: [task-01-the-bot-plugin-serves-bot-records.md, task-03-a-plugin-starts-a-session-as-an-owner.md]
layer: "bot"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L358](../../../../packages/sdk/src/types/plugin.ts#L358) - `startSession` on `PluginHost`, from task 03"
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

- **Built:** `packages/bot/src/start.ts` (new) - `sessionFor(bot)` builds the `SessionRequest`: `owner` is the record's owner, `provider` is `preset ?? harness` (absent lets the host pick), `workingDirectory` is the bot's workspace, `model` is `{ id: bot.model }` and is left out when a preset is set (the preset carries its own), `config` is `{ computer }` when the record names one, `prompt` is `instructions` when there are any, and `title` is the name. `provider.ts` gained a `BotSessions` seam (`owner(uri)`, `start(wanted)`) as a `BotOptions` member, built in `plugin.ts` over `host.sessionOwner` and `host.startSession`; `write` calls it on a make whose record has no `session`, before `store.put`, so a refused start leaves no record. `mkdirSync(workspace)` runs first where the record has no `computer`: inside a machine the plugin cannot make the folder, so it rides along as the session's working directory and the machine makes it.
- **sdk, beyond the task's file list:** `SessionRequest` gained `model?: unknown` (passed to the existing `StartSession.model`, read by `modelIn`) and `title?: string`; `StartSession` gained `title?: string`; `validate.ts` checks both and now accepts an absent `prompt` as "a session that opens silent" while still refusing a present-but-blank one; `beginSession` passes `title` to `openSession`'s pre-existing 8th parameter; `beginIn` returns before firing a turn when the text is blank.
- **Departure - the empty prompt:** task 03 wrote "an empty prompt is a mistake and not a quiet session". This task's validation asks for "a bot with none sends no turn", which cannot be built without narrowing that. It is narrowed rather than reversed: an *absent* `prompt` is now a silent session, and a *present and blank* one is still refused `-32602`, so the mistake task 03 named is still a mistake. `SessionRequest.prompt` is the plugin's optional field; `StartSession.text` (the automation road) still requires a non-blank line.
- **Departure - where the model goes:** the plan's decisions say "a preset wins over the bot's harness and model". The model is carried as `SessionRequest.model` and reaches the backend as the protocol's `ModelSelection` on the first turn, which is the only place a session has one; putting it in `config` would name a key no backend declares.
- **Not done:** `packages/bot/README.md` and the area docs are task 05.
- **Verified:** `npx vitest run packages/bot` - 39 passed (the task's eight cases and the earlier ones).

