---
title: A bot's folder has its AGENTS.md
status: done
depends: [task-03-a-message-wakes-a-back-session.md]
layer: "packages/sdk, packages/bot"
refs:
  - "[code://packages/bot/src/provider.ts](../../../../packages/bot/src/provider.ts) - the make road, where `workspaceFor` gives the folder"
  - "[code://packages/bot/src/wake.ts](../../../../packages/bot/src/wake.ts) - `sessionFor`, the back session's request"
  - "[code://packages/agent-claude/src/session/query.ts#L320](../../../../packages/agent-claude/src/session/query.ts#L320) - Claude loads `CLAUDE.md` only from a trusted folder"
  - "[code://packages/sdk/src/host/spawn.ts#L655-L664](../../../../packages/sdk/src/host/spawn.ts#L655-L664) - `trustedBy`, which answers false for a start with no sender"
  - "[code://packages/sdk/src/plugins/validate.ts](../../../../packages/sdk/src/plugins/validate.ts) - `checkSessionRequest`, which reads the request"
---

## Objective

A bot's folder holds `AGENTS.md`, which is the bot's rules, and a `CLAUDE.md` that holds `@AGENTS.md`.
Each harness reads `AGENTS.md` itself, and the bot rewrites it when it needs to.
The record's `instructions` field is only the seed of the first `AGENTS.md`.
The plugin never writes over a file that is in the folder.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts` - add `trusted?: boolean` to `SessionRequest`.
- `UPDATE: packages/sdk/src/types/automations.ts` - add `trusted?: boolean` to `StartSession`.
- `UPDATE: packages/sdk/src/access/users.ts` and `docs/sdk/USERS.md` - add the grant `session:trust` to the operations table and the page that documents it.
- `UPDATE: packages/sdk/src/plugins/validate.ts` - read `trusted` as a boolean, or nothing.
- `UPDATE: packages/sdk/src/types/sessions.ts` - add the trusted folder of a session to the store.
- `UPDATE: packages/sdk/src/sessions/sessions.ts` - keep the trusted folder in memory and on disk.
- `UPDATE: packages/sdk/src/host/automations.ts` - refuse `trusted` from a plugin with no `session:trust` grant, and record the folder.
- `UPDATE: packages/sdk/src/host/spawn.ts` - answer `trusted` true for the folder that the store holds for the session.
- `CREATE: packages/sdk/test/session-trust.test.ts` - the tests of the trust flag and its grant.
- `CREATE: packages/bot/src/folder.ts` - write `AGENTS.md` and `CLAUDE.md` when they are absent.
- `UPDATE: packages/bot/src/wake.ts` - prepare the folder and ask for `trusted` before a back session starts.
- `CREATE: packages/bot/test/bot-folder.test.ts` - the tests of the folder.
- `UPDATE: packages/bot/test/bot-wake.test.ts`, `packages/bot/test/bot-post.test.ts` - the request now asks for trust, and the bot works in a folder the wake can write.

## Steps

1. Add `trusted?: boolean` to `SessionRequest` and `StartSession`.
2. Read `trusted` in `checkSessionRequest` as a boolean, or nothing.
3. Add `session:trust` to the plugin grants.
4. Refuse a start with `trusted` when the plugin entry has no `session:trust` grant, and name the grant in the error.
5. Record the request's `workingDirectory` as the session's trusted folder in the store.
6. Make `trustedBy` answer true when the session's folder is the trusted folder that the store holds.
7. Keep every other folder untrusted for that session.
8. Keep the trusted folder across a restart, as the store keeps the opt-in tool names.
9. Before a back session starts, create the bot's folder when it is absent.
10. Write `CLAUDE.md` with the line `@AGENTS.md` when the file is absent.
11. Write `AGENTS.md` from the record's `instructions` when the file is absent and the record has `instructions`.
12. Leave `AGENTS.md` absent when the record has no `instructions`, because task 11 writes it.
13. Never write over a file that is there.
14. Send `trusted: true` in `sessionFor`.

## Validation

- `bot-folder.test.ts`: test that an empty folder gets `CLAUDE.md` and an `AGENTS.md` from `instructions`.
- `bot-folder.test.ts`: test that a file a person wrote stays as it is.
- `bot-folder.test.ts`: test that a bot with no `instructions` gets `CLAUDE.md` and no `AGENTS.md`.
- `session-trust.test.ts`: test that a plugin with `session:trust` gets a trusted start in its folder only.
- `session-trust.test.ts`: test that the host refuses a plugin without the grant, with an error that names `session:trust`.
- `session-trust.test.ts`: test that a restart reads back the trusted folder.
- The gates pass: build, typecheck, boundary, schema and vitest.
