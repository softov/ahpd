---
title: The bot plugin serves bot: records a person makes, edits and deletes
status: todo
depends: []
layer: "bot"
refs:
  - "[code://packages/computer/package.json](../../../../packages/computer/package.json) - the plugin manifest to copy"
  - "[code://packages/computer/src/plugin.ts#L1053](../../../../packages/computer/src/plugin.ts#L1053) - where a plugin registers its scheme"
  - "[code://packages/computer/src/provider.ts#L85-L92](../../../../packages/computer/src/provider.ts#L85-L92) - the provider shape"
  - "[code://packages/sdk/src/policies.ts#L277](../../../../packages/sdk/src/policies.ts#L277) - a JSON file store"
  - "[code://packages/sdk/src/types/resources.ts#L226-L245](../../../../packages/sdk/src/types/resources.ts#L226-L245) - `SchemeDescription` and its `manifest`"
---

## Objective

`@ahpd/bot` registers `bot:`.
A write to `bot:/<slug>` with `createOnly` makes a bot, and a write with `ifMatch` edits it.
`resourceDelete` removes a bot, and `resourceList` on `bot:/` lists the bots the reader may see.

## Files

- `CREATE: packages/bot/package.json`, `tsconfig.json`, `README.md` - a plugin package like `@ahpd/computer`.
- `CREATE: packages/bot/src/record.ts` - `BotRecord`: `id`, `name`, `labels`, `description?`, `body`, `color`, `instructions?`, `harness?`, `model?`, `preset?`, `workspace`, `computer?`, `session?`, `owner`, `createdAt`, `updatedAt`; `BOT_BODIES` and `BOT_COLORS`; `checkRecord`.
- `CREATE: packages/bot/src/store.ts` - one JSON file per bot under `<configDir>/bots/`, and a tombstone file per deleted slug.
- `CREATE: packages/bot/src/provider.ts` - `read`, `list`, `resolve`, `write`, `remove`, `describe` with a `manifest`, and `authorize` for the owner.
- `CREATE: packages/bot/src/plugin.ts` - registers the provider, and the `root` option with the default `~/.bots`.
- `CREATE: packages/bot/test/bot-record.test.ts` and `bot-provider.test.ts` - the cases below.

## Steps

1. Write the tests.
2. A slug is lowercase letters, digits and `-`, 1 to 40 characters, starting with a letter. The slug is the URI path; refuse a body that names another `id`.
3. Give a make with no `body` one at random from `BOT_BODIES`. Refuse a `body` or `color` outside its list.
4. The owner is the writer's `user:`, or a `team:` or `project:` the writer is a member of. A root connection may name any owner.
5. An edit keeps `id`, `owner` and `createdAt`. A delete writes the tombstone. Refuse a make on a tombstoned slug with `-32010`.
6. Give a make with no `workspace` the folder `<root>/<slug>`. Refuse a `workspace` that another bot owns. An edit keeps `workspace`.
7. Let the owner read, list and edit the bot. A member of the owning team or project, and a holder of the matching `bot:` grant, can too.

## Validation

- A test: a make with a name only gets a body, a colour, the writer as owner and both times.
- A test: the plugin refuses a second make of the same slug with `-32010`.
- A test: the plugin refuses a slug with an upper-case letter or a `/`.
- A test: the plugin refuses a body or colour outside the lists.
- A test: a make with no `workspace` gets `<root>/<slug>`, and the plugin refuses a second bot on that folder.
- A test: the plugin refuses an edit that changes `id` or `owner`; an edit of `name` keeps the slug.
- A test: after a delete the list does not show the slug, and the plugin refuses a make on it.
- A test: a person who is not the owner and has no `bot:get` does not see the bot.
- `pnpm build`, `pnpm typecheck` and `npx vitest run packages/bot` pass.

## Resume

