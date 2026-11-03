---
title: A bot's data is one folder
status: implemented
depends: [task-02-the-persona-is-read-from-agents-md.md]
layer: "packages/sdk, packages/server, packages/bot"
refs:
  - "[code://packages/sdk/src/plugins/plugins.ts#L1367-L1395](../../../../packages/sdk/src/plugins/plugins.ts#L1367-L1395) - `records` takes a path of slugs and a `file`, and the claim is on the first slug"
  - "[code://packages/bot/src/provider.ts#L118-L123](../../../../packages/bot/src/provider.ts#L118-L123) - `chats`, one bot's main chat rows in `bots/<slug>/chats`"
  - "[code://packages/bot/src/names.ts#L30-L38](../../../../packages/bot/src/names.ts#L30-L38) - `chatsOf`, `sessionsOf` and `logsOf`, one path per bot"
  - "[code://packages/bot/src/chat.ts#L216-L231](../../../../packages/bot/src/chat.ts#L216-L231) - `logDirs`, every bot's `logs/` folder read at once"
  - "[code://packages/server/src/records.ts#L115-L125](../../../../packages/server/src/records.ts#L115-L125) - `fileRecords`, which keeps record `<id>` at `<name>/<id>.md`"
  - "[code://packages/server/src/records.ts#L30](../../../../packages/server/src/records.ts#L30) - the reserved collection names"
  - "[code://packages/sdk/src/types/records.ts#L31-L40](../../../../packages/sdk/src/types/records.ts#L31-L40) - `CollectionOptions`, which has only `body`"
---

## Objective

All the data of one bot is in `<configDir>/bots/<slug>/`: its record, its main chat rows, its back session rows and its chat logs.
A delete of the bot removes that folder.
The bot's work folder, such as `~/.bots/<slug>`, stays after a delete.

The record is `bots/<slug>/bot.md`, because the `bots` collection keeps each record in a folder of its own.
The main chat rows are the collection `bots/<slug>/chats`, and the back session rows are the collection `bots/<slug>/sessions`.
A collection name can be a path of slugs, and the plugin that opened the first slug owns every path under it.
The chat logs are plain files in `bots/<slug>/logs/`.

## Files

- `UPDATE: packages/sdk/src/types/records.ts` - add `file?: string` to `CollectionOptions`, where record `<id>` is the file `<id>/<file>.md`, and say that a name can be a path of slugs.
- `UPDATE: packages/sdk/src/resources/records.ts` - add `isRecordPath`, and make `memoryRecords` take a path and `file`.
- `UPDATE: packages/sdk/src/plugins/plugins.ts` - `records` takes a path of slugs and `file`, and the claim is on the first slug.
- `UPDATE: packages/server/src/records.ts` - `fileRecords` takes a path, and keeps and watches a `file` collection as one folder for each record.
- `UPDATE: packages/server/test/records.test.ts` - the tests of a path and of a `file` collection.
- `UPDATE: packages/bot/src/plugin.ts` - open `bots` with `file: 'bot'`, open each bot's two collections, and move the data at load.
- `UPDATE: packages/bot/src/provider.ts` - the main chat rows in `bots/<slug>/chats`, and a delete that removes `bots/<slug>/`.
- `UPDATE: packages/bot/src/names.ts` - the back session rows in `bots/<slug>/sessions`.
- `UPDATE: packages/bot/src/chat.ts` - the chat logs in `bots/<slug>/logs/`.
- `UPDATE: packages/bot/test/bot-provider.test.ts` - the tests of the folder, the move and the delete.

## Steps

1. Accept a collection name of one to three slugs joined by `/`, in `memoryRecords`, `fileRecords` and the plugin `records` call.
2. Keep the plugin claim on the first slug, so a path under `bots` belongs to the plugin that opened `bots`.
3. Refuse a path whose first slug is a reserved collection name.
4. Add the `file` option, and keep record `<id>` of such a collection at `<name>/<id>/<file>.md`.
5. List a `file` collection from the subfolders that hold `<file>.md`, and ignore every other subfolder.
6. Watch each subfolder of a `file` collection, so a change to a record file is a change.
7. Open `bots` with `file: 'bot'` and `body: 'instructions'`.
8. Open the collections `bots/<slug>/chats` and `bots/<slug>/sessions` for each bot when the plugin first needs them.
9. Write the chat logs to `bots/<slug>/logs/`.
10. At load, move each `bots/<slug>.md` to `bots/<slug>/bot.md`.
11. At load, move each row and log in `bot-chats/` and `bot-sessions/` into the folder of its bot.
12. Remove the rows and logs of a bot that has a tombstone in `bots-gone/`.
13. Leave a file that the move cannot place, and report it as a problem.
14. Make a delete write the tombstone first, and then remove `bots/<slug>/`.

## Validation

- `records.test.ts`: test that a `file` collection keeps a record at `<id>/<file>.md` and lists it after a restart.
- `records.test.ts`: test that an edit of `<id>/<file>.md` by hand is a change.
- `records.test.ts`: test that a path of slugs opens a collection in that subfolder.
- `bot-provider.test.ts`: test that a new bot, its chat row, its back session row and its log are all in `bots/<slug>/`.
- `bot-provider.test.ts`: test that a load moves an older layout, and keeps the instructions in the record body.
- `bot-provider.test.ts`: test that a delete removes `bots/<slug>/` and keeps the work folder.
- The gates pass: build, typecheck, boundary, schema and vitest.
