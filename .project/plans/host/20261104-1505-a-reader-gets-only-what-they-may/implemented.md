---
title: A reader gets only what they may - implemented
date: 2026-11-05
refs:
  - git://c1b9b792 - the merge of #228
  - "[code://packages/sdk/src/access/users.ts](../../../../packages/sdk/src/access/users.ts) - a team key minted only with `proxy:call`, and a removed team's keys revoked"
---

A caller no longer gets a credential, a value or a name its grants do not cover. A team key needs `proxy:call`, and a removed team takes its keys. A `writeOnly` connector field is masked, and the bot picker lists only the bots a person may read.

## What was built

- [`code://packages/sdk/src/access/users.ts`](../../../../packages/sdk/src/access/users.ts) - the grant check on a team key, and the keys of a removed team.
- [`code://packages/sdk/src/connectors/channel.ts`](../../../../packages/sdk/src/connectors/channel.ts) - a `writeOnly` field masked on a row.
- [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - the bot picker's readable bots.

## Verified

- Six new cases fail without the change, in `users-tokens.test.ts`, `token-methods.test.ts`, `connectors-channel.test.ts`, `schema-gaps.test.ts`, `bot-chat.test.ts` and `token-command.test.ts`.
- CI on main after #242 passed every check.

## Departures from the plan

- `boundTeam` also guards a team key's listing and its revoking. Only minting asks `proxy:call`, so a user administrator without it can still revoke a key.

## Left for later

- none
