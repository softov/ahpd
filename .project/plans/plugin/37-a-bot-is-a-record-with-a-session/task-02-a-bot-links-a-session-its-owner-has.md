---
title: A bot links a session its owner has
status: implemented
depends: [task-01-the-bot-plugin-serves-bot-records.md]
layer: "bot"
refs:
  - "[code://packages/sdk/src/types/sessions.ts#L100-L102](../../../../packages/sdk/src/types/sessions.ts#L100-L102) - a session's owner"
---

## Objective

A make or an edit can set `session` to a session URI.
The link is kept only when that session exists and belongs to the bot's owner.

## Files

- `UPDATE: packages/bot/src/provider.ts` - the write checks `session` against the session's owner.
- `UPDATE: packages/bot/test/bot-provider.test.ts` - the cases below.

## Steps

1. Write the tests.
2. Read the session's owner through the host, and refuse a session that is not there or has another owner.
3. An edit that sets `session` to `null` removes the link.

## Validation

- A test: the record keeps a link to a session of the bot's owner, and a read gives it back.
- A test: the plugin refuses a link to a session of another person.
- A test: the plugin refuses a link to a session that is not there.
- A test: the make form offers every field a write takes, `session` among them.
- `npx vitest run packages/bot` passes.

## Resume

- **Built:** `packages/bot/src/provider.ts` checks a `session` a body names against the session's owner, `packages/bot/src/record.ts` reads `session` through a new `link` helper, and `packages/bot/test/bot-provider.test.ts` has the four cases. The host read the step asks for is a new `PluginHost.sessionOwner(uri)`, mirroring `sessionKept`: it reads the live `sessions` store by the id inside the URI and answers whose the session is, or nothing where this host has none. That took three files beyond this task's list - `packages/sdk/src/types/plugin.ts`, `packages/sdk/src/plugins.ts` and `packages/sdk/test/plugin-host.test.ts` - the way task 03's own sdk additions did.
- **Departure (a code the plan does not name):** a link to a session this host does not have is refused `-32602`, the code the file already uses for a body naming something that cannot be (`workspaceFor`'s clash); a link to somebody else's session is `-32009`, the code `notYours` uses. The two read differently on purpose.
- **Departure (a body key):** `record.ts` now tells three answers apart for `session`: a URI is the link, `null` is the link taken away, and leaving the key out keeps the link as it was. `line()` could not say this, since it read `null` as a mistake and `''` as nothing said. A blank string is treated as `null`.
- **Also:** the provider takes a `sessions` seam (`BotSessions.owner`), wired in `plugin.ts` from `host.sessionOwner`, and the test's `made()` now builds the host over a `memorySessions()` store so a link has something to be checked against. MANIFEST gained `session` and `owner`: a body may carry either, and a form that does not offer what the check takes is one no client can fill in. `policy-scheme.test.ts` holds its own scheme to that, and a new case here does the same for this one.

