---
title: A restart rebuilds every chat of a session
status: todo
depends: [task-01-a-peer-chat-runs-under-its-own-backend-id.md, task-02-the-store-records-a-sessions-chats.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/tooling.ts#L297-L308](../../../../packages/sdk/src/host/tooling.ts#L297-L308) - `createChat`, where a chat is recorded"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L689-L718](../../../../packages/sdk/src/host/sessionmethods.ts#L689-L718) - `disposeChat`, where one is dropped"
  - "[code://packages/sdk/src/host/lifecycle.ts#L243-L330](../../../../packages/sdk/src/host/lifecycle.ts#L243-L330) - the in-process restart"
  - "[code://packages/sdk/src/host/lifecycle.ts#L413-L443](../../../../packages/sdk/src/host/lifecycle.ts#L413-L443) - `restartChat`, the respawn to copy"
  - "[code://packages/sdk/src/host/chatactions.ts#L200-L203](../../../../packages/sdk/src/host/chatactions.ts#L200-L203) - resuming a listed session"
  - "[code://packages/sdk/src/host/routing.ts#L124-L142](../../../../packages/sdk/src/host/routing.ts#L124-L142) - `chatOf`"
  - "[code://packages/sdk/src/host/catalogue.ts#L308-L310](../../../../packages/sdk/src/host/catalogue.ts#L308-L310) - the catalogue's `claimed` skip"
---

## Objective

Every chat the store records for a session is rebuilt when the session is resumed or restarted, under its own URI and with its turns; a recorded peer chat's URI resolves to its session before and after a restart; its backend id is never listed as a session of its own.

## Files

- `UPDATE: packages/sdk/src/host/tooling.ts`, `packages/sdk/src/host/sessionmethods.ts`, `packages/sdk/src/host/chatactions.ts`, `packages/sdk/src/host/lifecycle.ts`, `packages/sdk/src/host/routing.ts` - record on `createChat`, a title change and the first spawn of a session; drop on `disposeChat`; rebuild after the default chat on resume (`chatactions.ts:200`) and restart (`lifecycle.ts:321-330`) with `{ resume: backendId, seed: <Agent.transcript(backendId)> }`; claim each peer backend id; `chatOf` asks the store for an `ahp-chat:/<uuid>` it does not hold and resumes the owning session.
- `UPDATE: packages/sdk/test/host.test.ts` - the cases below, on a fake agent with `list`, `transcript` and a recorded `Start`, and a file store in a temp directory.

## Steps

1. Record the default chat as `{ uri: chatUriFor(session), backendId: <session id>, default: true }` when a session first spawns, and each peer chat with its `chatId`.
2. On resume, spawn the recorded peer chats after the default chat, in order; a nested agent's chats are skipped, as its default chat is not resumed today.
3. Claim the backend ids so `listSessions` skips them.

## Validation

- `packages/sdk/test/host.test.ts`: a session with a peer chat, closed and served by a new host over the same file store, lists one session, and subscribing to the peer chat's URI answers a snapshot whose turns came from `transcript(<its backend id>)` and whose `Start` had that `resume`; the session snapshot lists both chats; a disposed peer chat is not rebuilt; the in-process restart (a config change that restarts the backend) rebuilds both chats; a nested agent's peer chat is not rebuilt and its URI is refused as today.
- `pnpm test` passes.

## Resume
