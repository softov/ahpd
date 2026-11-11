---
title: A stopped session's row lists its chats - implemented
date: 2026-11-11
refs:
  - "[code://packages/sdk/src/host/catalogue.ts](../../../../packages/sdk/src/host/catalogue.ts)"
  - "[code://packages/sdk/src/tools/session.ts](../../../../packages/sdk/src/tools/session.ts)"
---

A session nothing runs lists its chats in its row, from its record.
After a restart, a client finds a nested chat's link and archives it without starting the session.
A link finds its session by the id it carries, whatever agent it names.

## What was built

- [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts) - `storedChatsOf`, used by `registerListedSession` and `getSurfacedSessionSummary`.
- [`code://packages/sdk/src/tools/session.ts`](../../../../packages/sdk/src/tools/session.ts) - `archive_chat` falls back to the row's chats; `sessionMeant` matches a link by its id.
- [`code://packages/sdk/test/sessiontools.test.ts`](../../../../packages/sdk/test/sessiontools.test.ts) - the restart case, and the link of another agent.

## Verified

- The restart case: a second host lists the nested chat with the first host's link, archives it, and the session stays unarchived.
- The gates are in the PR.

## Departures from the plan

- `getSurfacedSessionSummary` also reads the record's chats. The listing rebuilds each stopped row there, field by field, and dropped them.
- One test covers tasks 01 and 02.

## Left for later

- none.
