---
title: A session is listed under its provider's name, whatever a client created it as, so VS Code opens it - implemented
date: 2026-10-09
refs:
  - git://e1c4ccc
  - "[code://packages/sdk/src/host/sessionmethods.ts](../../../../packages/sdk/src/host/sessionmethods.ts)"
  - "[code://packages/sdk/src/host/routing.ts](../../../../packages/sdk/src/host/routing.ts)"
---

A session that a client creates is held under its provider's name, such as `claude:/<id>`, whatever scheme the client sent. The creating client is still answered in its own spelling. The VS Code Agents Window opens a Claude session that ahpapp or ahpc created, with its turns and its pending approval.

## What was built

- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - `createSession` holds the session under the provider's name; `createChat` and `disposeSession` take either name.
- [`code://packages/sdk/src/host/handshake.ts`](../../../../packages/sdk/src/host/handshake.ts) - `initialSubscriptions` and `reconnect` answer in the client's spelling.
- [`code://packages/sdk/src/host/routing.ts`](../../../../packages/sdk/src/host/routing.ts) - one respelling for snapshots and actions.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - the gate finds a session, a terminal and a changeset operation by what the host holds, not by scheme.
- A chat title written under the old name is read as a fallback.

## Verified

- `host-names.test.ts`, `subagent-chat.test.ts`, `host-snapshots.test.ts`, `session-provider.test.ts` and `users-gate.test.ts`, with the full suite on main.
- Softov checked by hand on 2026-10-09 with ahpapp, ahpc and the VS Code Agents Window. No wire capture was kept.

## Departures from the plan

- The review findings were fixed in host 64.
- Task 06's upstream report is kept as a proposal, not filed.
- The Resumes of tasks 07 to 10 use the grant names from before host 46. The code uses the current names.

## Left for later

- None.
