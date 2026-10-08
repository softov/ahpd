---
title: Sessions and chats have their own docs
status: todo
depends: []
layer: "docs"
refs:
  - "[code://packages/sdk/src/host/sessionconfig.ts](../../../../packages/sdk/src/host/sessionconfig.ts) - session config keys"
  - "[code://packages/sdk/src/host/sessionmethods.ts](../../../../packages/sdk/src/host/sessionmethods.ts) - session commands"
---

## Objective

`docs/SESSIONS.md` says what a session is: owner, lifecycle, every session-config key with each option, isolation and worktrees, listing. `docs/CHATS.md` says what a chat is within a session: turns, attachments, compaction, subagents.

## Files

- `CREATE: docs/SESSIONS.md`, `CREATE: docs/CHATS.md`.
- `UPDATE: docs/AHP.md` - "Behaviour worth knowing" entries about sessions and chats stay as wire rows and gain a link to the area doc.

## Steps

1. Read the sources in Files and the area's code; list its terms, config keys, commands and grants.
2. Write each doc in the plan's shape, checking every claim against its code.
3. Move the named sections; leave one line and a link where each was.
4. Run `rg -n "DAEMON.md#|USERS.md#|AHP.md#" .` and fix each link that moved.
5. Find the area's decisions with `rg -ln "code://packages/<area path>" .project/decisions/` and link the ones a reader needs for why.

## Validation

- Each claim names a file it was read in; read by hand against that file.
- Softov reads the diff before commit.

## Resume
