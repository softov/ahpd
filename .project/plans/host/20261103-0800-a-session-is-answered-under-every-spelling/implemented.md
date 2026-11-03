---
title: A session is answered under every spelling - implemented
date: 2026-11-03
refs:
  - git://6a653766 - the change
  - "[code://packages/sdk/src/host/routing.ts](../../../../packages/sdk/src/host/routing.ts)"
---

Every spelling of a session's id names that session: the name its row carries, `ahp-session:/<id>`, and the scheme of a provider this host serves.
A client is answered under the name it used, through the alias the connection keeps, and the state is the session's own.
A scheme no agent here serves names no session, whatever id it carries.

## What was built

- [`code://packages/sdk/src/host/routing.ts`](../../../../packages/sdk/src/host/routing.ts) - `meantBy`, `sessionOfChat` and `shownToOlder` read the id; `heldElsewhere` goes.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - a config change, a draft and a turn reach the session.
- [`code://packages/sdk/src/host/sleep.ts`](../../../../packages/sdk/src/host/sleep.ts) - a wake reaches the session.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - a session's names.

## Verified

- On `cde4dd6c`'s sources all four changed cases fail: another spelling is no session there.
- With the change the names file passes 38 of 38, the session gate 17 of 17, and worker chats 28 of 28.
- The chats file passes 62 of 62, snapshots 48 of 48, the catalogue 73 of 73, and the name gate 17 of 17.
- Sessions pass 61 of 61, sleep 14 of 14, input needed 6 of 6, and the nested proxy 66 of 66.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- The read flag sent under another spelling moves the session's sole counted chat, which the case reads: the chat's own action and its row follow.
