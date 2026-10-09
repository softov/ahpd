---
title: A restart rebuilds every chat of a session
status: done
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

- `CREATE: packages/sdk/src/host/chatrecord.ts` - the chat-to-session map: the chats the store records for a session, and the backend ids those chats claim.
- `UPDATE: packages/sdk/src/types/sessions.ts`, `packages/sdk/src/sessions.ts` - the port lists the ids a store holds, and both stores answer it.
- `UPDATE: packages/sdk/src/validate.ts`, `packages/sdk/test/plugin-validate.test.ts` - the member a contributed store must have, and the case that refuses one without it.
- `UPDATE: packages/sdk/src/host/context.ts`, `packages/sdk/src/host.ts` - the area is built with the host, before the routing.
- `UPDATE: packages/sdk/src/host/spawn.ts` - every chat is recorded where it starts, and a renamed one again.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts`, `packages/sdk/src/host/lifecycle.ts` - a chat leaves the record when it is disposed, and a session's when it is torn down.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - a session resumed from a listed chat rebuilds its other chats, then answers on the chat the client named.
- `UPDATE: packages/sdk/src/host/snapshots.ts` - a chat served read-only is answered from its own transcript, and its session lists every recorded chat.
- `UPDATE: packages/sdk/src/host/routing.ts` - `chatOf` resolves a recorded `ahp-chat:/<uuid>` to itself, so the session it belongs to is found without starting anything.
- `UPDATE: packages/sdk/src/host/catalogue.ts` - a peer chat's backend id is claimed, so it is never listed as a session of its own.
- `UPDATE: packages/sdk/src/host/actions.ts` - the `closedChats` key applied to a host that is already running.
- `UPDATE: packages/server/src/rootconfig.ts`, `packages/server/src/commands/options.ts`, `packages/server/src/commands/run.ts` - the daemon key, its values and what a start announces.
- `UPDATE: packages/sdk/test/host-chats.test.ts`, `packages/sdk/test/sessions.test.ts`, `packages/server/test/server-root-config.test.ts`, `packages/server/test/config-check.test.ts` - the cases below.
- `UPDATE: docs/HOST.md`, `docs/DAEMON.md`, `docs/CHATS.md`, `docs/PLUGINS.md` - the daemon key and what closing a chat does.

## Steps

1. Record each chat with the backend id it runs under, and the default one as `{ uri: chatUriFor(session), backendId: <session id>, default: true }`.
2. On resume, start the chat the record marks default with its own backend id, then the rest in order.
3. Claim the backend ids, so a listing skips them.
4. Build the map when the host starts, from the ids `sessions()` names and their chats.
5. Delete a closed chat's conversation only when the daemon key says so, and each one when its session goes.

## Validation

- `packages/sdk/test/host-chats.test.ts`, in `more than one chat in a session`: a session with a peer chat, closed and served by a new host over the same file store, lists one session, and subscribing to the peer chat's URI answers a snapshot whose turns came from `transcript(<its backend id>)` and whose `Start` had that `resume`; the session snapshot lists both chats; a host that lists nothing finds the peer chat before any listing; a disposed peer chat is not rebuilt; the in-process restart (a config change that restarts the backend) rebuilds both chats; a nested agent's peer chat is not rebuilt and its URI is refused as today; a forked peer chat restarts over the same file store with its turns, under the id its backend minted rather than the one it was asked for; closing the first chat and restarting brings the remaining chat's turns back and not the closed one's, because the record's default took over; and a closed chat's conversation is deleted only when the daemon tells it to.
- `packages/sdk/test/sessions.test.ts`: `sessions()` names every id a store holds, on both stores, and no id it was merely asked about.
- `pnpm test` passes.

## Resume

Built on `build/agents/830a472f` on 2026-10-09 and left uncommitted.

`createChatRecord` in `packages/sdk/src/host/chatrecord.ts` is the chat-to-session map: the session each recorded chat belongs to, and the backend ids those chats claim.
`host.ts` builds it before the routing, which is where a chat URI is resolved.
`SessionStore.sessions()` answers the ids a store holds, and both stores have it.
The memory store keeps a row per session, and the file store composes on it over the folder it read at construction.
`createChatRecord` builds the whole map in one pass on the way up, from those ids and the `chats(id)` of each.
A peer chat is therefore placed before this host has listed a session and before any agent has run.
The map stays current as `spawn` records a chat and `disposeChat` drops one, and a read remembers what it saw.
`catalogue.ts`'s listing still reads the store for every row a backend offered, which keeps the map current for a session recorded since this host started.
A session inside a machine is left out of that pass, as it is out of the resume and of a browsed session's chat list.
`spawn` writes the record through `keepChat`, in the one place every road to a running backend goes through.
`disposeChat` drops a chat, and keeps the one that takes over the default.
`lifecycle.ts` calls `forgetChats` at both places a session's record is dropped.

The three rebuilds the task names are in.
`restart` respawns every chat of `held.chats` but the default one, from the session in memory, as `restartChat` respawns one chat.
It reads the held chat's turns rather than awaiting its transcript.
That is the reconciliation the answers left open.
The store is written by `spawn` as it goes, so the live conversation is the better source.
The resume in `chatactions.ts` spawns the recorded chats after the default one, each with its transcript awaited.
The turn is answered on the chat the client named.
`snapshots.ts` serves a recorded peer chat read-only from `transcript(<its backend id>)`, and lists the recorded chats on a session it browsed.
`routing.ts` resolves a recorded `ahp-chat:/<uuid>` to itself in `chatOf`.
`sessionFor` reads the map, so the uuid in a peer chat's URI is never read as a session id.

One departure the full suite found.
The browsed snapshot resolved its channel through `sessionFor` for every chat, which renamed a session a client asked about under its own spelling.
It reads the map only for a channel the map knows, so every other channel keeps the base64 it arrived with.
That is what `packages/agent-claude/test/agent-claude-subagent-restore.test.ts` asserts about worker links.

Five cases in `packages/sdk/test/host-chats.test.ts`, in `more than one chat in a session`.
The backend is `examples/echo/agent.ts` with `start.chatId` handed on as its `resume`.
That is what makes it keep one conversation per chat, and the store is `fileSessions` so a second host reads what the first wrote.
The fifth is a second host over a store the first wrote, and it lists nothing at all.
The peer chat is found by the pass that builds the map.
Each of the three rebuilds and that pass was reverted in turn, and the cases fail without it.

The review of the same day answered five things here.
The record now holds the id the backend answers with, not the one it was asked for.
`spawn` writes `agentId()` into the row when a turn of that chat ends.
`chatIdOf` passes it on every rebuild, so a fork is resumed by what the row holds.
A chat named something that is not a UUID runs under the backend's own name too.
A resume starts the chat the record marks default, not the URI the session is named by.
Disposing the first chat moves `default` to a peer chat, and the old resume spawned the closed conversation.
`snapshots.ts` reads the same mark for the chat it serves read-only.
Closing a chat keeps its conversation hidden by default.
It is deleted only under the daemon key `closedChats` - decisions [A closed chat's conversation is hidden by default, and deleted only when the daemon is told to](../../../decisions/a-closed-chat-is-hidden-or-deleted.md) and [What closing a chat does is a daemon key in root config](../../../decisions/the-closed-chat-setting-is-a-daemon-key.md).
Disposing a session deletes each recorded chat's conversation through the same `deleted` call the session's own id goes through.
`sessionFor` answers a session URI rather than a bare id, so a session that is not held here is still spelt the way this host names it.
