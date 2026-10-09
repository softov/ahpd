---
title: A peer chat is its own conversation, and survives a restart
domain: host
status: built
priority: high
created: 2026-10-03
revalidated: 2026-10-04
requires: []
refs:
  - "[code://packages/sdk/src/host/state.ts#L12-L41](../../../../packages/sdk/src/host/state.ts#L12-L41) - `Held.chats`, in memory only"
  - "[code://packages/sdk/src/host/tooling.ts#L297-L308](../../../../packages/sdk/src/host/tooling.ts#L297-L308) - the internal `createChat`: a peer chat is `spawn(held.agent, <session uri>, ahp-chat:/<uuid>, ...)` with no resume and no id of its own"
  - "[code://packages/sdk/src/host/spawn.ts#L311-L320](../../../../packages/sdk/src/host/spawn.ts#L311-L320) - `spawn`, whose `Start.uri` is the session's URI for every chat"
  - "[code://packages/sdk/src/host/lifecycle.ts#L243-L330](../../../../packages/sdk/src/host/lifecycle.ts#L243-L330) - the in-process restart, which rebuilds only `held.defaultChat`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L413-L443](../../../../packages/sdk/src/host/lifecycle.ts#L413-L443) - `restartChat`: `{ resume: agentId(), seed: allTurns() }`, the respawn every rebuild here copies"
  - "[code://packages/sdk/src/host/chatactions.ts#L200-L203](../../../../packages/sdk/src/host/chatactions.ts#L200-L203) - resuming a listed session spawns only `chatUriFor(named)`"
  - "[code://packages/sdk/src/host/channels.ts#L109-L110](../../../../packages/sdk/src/host/channels.ts#L109-L110) - `chatUriFor`, the default chat's name"
  - "[code://packages/sdk/src/host/routing.ts#L124-L142](../../../../packages/sdk/src/host/routing.ts#L124-L142) - `chatOf`, which after a restart resolves `ahp-chat:/<uuid>` to a session named by that uuid and is refused"
  - "[code://packages/sdk/src/host/catalogue.ts#L308-L310](../../../../packages/sdk/src/host/catalogue.ts#L308-L310) - the catalogue skips a backend row whose id is `claimed`"
  - "[code://packages/sdk/src/types/sessions.ts#L50-L153](../../../../packages/sdk/src/types/sessions.ts#L50-L153) - `SessionStore`: flags, config, scope, owner, senders, provider, artifacts, pull requests, chat titles; no list of chats"
  - "[code://packages/sdk/src/sessions.ts#L39-L42](../../../../packages/sdk/src/sessions.ts#L39-L42) - `chatTitles`, the per-chat map the chat list sits beside"
  - "[code://packages/agent-claude/src/session.ts#L2308](../../../../packages/agent-claude/src/session.ts#L2308) - Claude asks for `sessionId: idOf(<session uri>)`, so a peer chat asks for the session's own id"
  - "[code://packages/agent-pi/src/session.ts#L659](../../../../packages/agent-pi/src/session.ts#L659) - pi takes `id: idFor(start.uri)`, the session's id, for every chat"
  - "[code://packages/agent-cofold/src/session.ts#L188-L194](../../../../packages/agent-cofold/src/session.ts#L188-L194) - cofold's `sessionIdOf(start.uri)`: every chat shares the session's stored conversation"
  - "[code://packages/agent-acp/src/session.ts#L1019-L1095](../../../../packages/agent-acp/src/session.ts#L1019-L1095) - ACP opens its own server-side session per chat and resumes it with `loadSession`"
  - "[code://packages/sdk/src/nested.ts#L372-L375](../../../../packages/sdk/src/nested.ts#L372-L375) - a nested host starts a fresh inner session each start and ignores `resume`"
---

## Goal

A chat opened beside a session's first one is a conversation of its own on every backend that can keep one, and it is still there, with its turns, after the daemon restarts.
Today a peer chat on Claude, pi or cofold runs under the session's own backend id, and no peer chat on any backend comes back after a restart.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "sessionId|id: idFor|sessionIdOf" packages/agent-*/src/session.ts` - Claude, pi and cofold derive the backend id from `Start.uri`, the session URI, so every chat of a session asks for one id; ACP gets an id from its server per chat.
- `rg -n "held.chats.set|spawn\(" packages/sdk/src/host` - the resume at `chatactions.ts:200` and the in-process restart at `lifecycle.ts:321-330` spawn only the default chat.
- `rg -n "^\s+[a-zA-Z]+\(" packages/sdk/src/types/sessions.ts` - nothing in the store names a session's chats.

### Runtime path

```
createChat -> spawn(session uri, ahp-chat:/<uuid>) -> backend id = the session's (Claude, pi, cofold)
restart -> resume session -> spawn(chatUriFor(session)) only -> peer chat gone; ahp-chat:/<uuid> refused
```

### Gaps

- Two chats of one Claude, pi or cofold session write to one backend conversation.
- A peer chat, its title aside, is forgotten at restart, and its URI then names nothing.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| A peer chat is handed the uuid of its `ahp-chat:/<uuid>` as `Start.chatId`; the default chat keeps the session's id | (defaulted: one name for one conversation, and the uuid is already minted for the URI) | 01 |
| The record holds the id the backend answers with, not the one it was asked for: a fork and a chat whose URI id is not a UUID run under an id the backend minted, which only the record keeps | the defect: `spawn` stored `chatId ?? idOf(uri)` and nothing wrote `agentId()` back, so a later process resumed a conversation that does not exist | 01 |
| The store records each session's chats: URI, backend id, title, origin, and which is the default | the defect: the store keeps no list of chats, so nothing can rebuild them | 02 |
| Resume and the in-process restart rebuild every recorded chat with `{ resume: <backend id>, seed: <its transcript> }`, as `restartChat` does | the defect: only the default chat is rebuilt (`lifecycle.ts:321-330`, `chatactions.ts:200`) | 03 |
| A resume starts the chat the record marks default, with its own backend id, rather than the chat URI the session is named by | the defect: disposing the first chat moves `default` to a peer chat, and the old resume spawned `chatUriFor(named)` with the closed conversation's id | 03 |
| Closing a chat keeps its conversation in the backend, hidden, unless the daemon is told to delete it | Softov, 2026-10-09: asked "host/50: when a client closes one chat of a session, what happens to that chat's conversation in the backend?" - "configurable with default to keep hidden" - [A closed chat's conversation is hidden by default, and deleted only when the daemon is told to](../../../decisions/a-closed-chat-is-hidden-or-deleted.md) | 03 |
| What closing a chat does is the daemon root-config key `closedChats`, valued `hidden` (the default) or `delete`, and it applies while the daemon runs | Softov, 2026-10-09: asked "host/50: where does the closed-chat setting (keep hidden or delete) live?" - "Daemon root config" - [What closing a chat does is a daemon key in root config](../../../decisions/the-closed-chat-setting-is-a-daemon-key.md) | 03 |
| Disposing a session deletes every recorded chat's conversation through `Agent.delete`, as the session's own id is deleted, and each id stays claimed until then | [`code://packages/sdk/src/host/lifecycle.ts#L343-L363`](../../../../packages/sdk/src/host/lifecycle.ts#L343-L363), the `deleted` call a disposed session goes through | 03 |
| A recorded peer chat's backend id is claimed, so the catalogue does not list it as a session of its own | [`code://packages/sdk/src/host/catalogue.ts#L308-L310`](../../../../packages/sdk/src/host/catalogue.ts#L308-L310), the existing `claimed` skip | 03 |
| A nested session's chats are recorded and not rebuilt, as its default chat is not resumed today | [`code://packages/sdk/src/nested.ts#L372-L375`](../../../../packages/sdk/src/nested.ts#L372-L375): a fresh inner session each start | 03 |
| Which session owns a chat the host is not holding is answered by a chat-to-session map, built in one pass when the host starts and kept current as chats are recorded and dropped | Softov, 2026-10-09: asked "when a client asks for a chat of a session that is not loaded, how does ahpd find which session owns that chat?" - "Map built at start" | 03 |
| The store answers the list that map is built from: `SessionStore.sessions()` names the ids it holds, on every store of the port, so the host reads every session's chats before anything has listed one | Softov, 2026-10-09: asked "host/50: how should ahpd learn which session owns a peer chat after a restart?" - "Add a list, build at start" | 03 |
| Opening a chat of a session that is not running is read only: the snapshot answers from the stored chat, and the session's agent process starts when somebody sends a turn | Softov, 2026-10-09: asked "when a client opens a chat of a session that is not running, should ahpd start the session's agent process?" - "Read only" | 03 |

## Proposed architecture

- **Data flow** - `createChat` -> `chatId = uuid of the chat URI` -> `Start.chatId` -> backend runs under it -> store `setChats(session, [...])`; start -> `sessions()` -> `chats(session)` -> the map; restart -> `chats(session)` -> spawn each with `resume` and `seed` -> claims.
- **Layer responsibilities** - sdk types: `Start.chatId`, `StoredChat` · sdk store: the list · sdk host: record, rebuild, claim · agent-claude, agent-pi, agent-cofold: use `chatId` · agent-acp, nested: unchanged.
- **Source-of-truth files** - [`code://packages/sdk/src/host/state.ts`](../../../../packages/sdk/src/host/state.ts), [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts), [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts), [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts), [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/sdk/src/host/routing.ts`](../../../../packages/sdk/src/host/routing.ts), [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts), [`code://packages/sdk/src/sessions.ts`](../../../../packages/sdk/src/sessions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A peer chat runs under its own backend id](task-01-a-peer-chat-runs-under-its-own-backend-id.md) | done | - |
| [02 - The store records a session's chats](task-02-the-store-records-a-sessions-chats.md) | done | - |
| [03 - A restart rebuilds every chat of a session](task-03-a-restart-rebuilds-every-chat.md) | done | 01, 02 |

## Risks and tradeoffs

- Peer chats opened before this lands share the session's backend conversation; they are not split after the fact, and the store has no record of them, so they are not rebuilt.
- host/48 splits `host.ts`; line numbers here are `main` at `1eb8c8f` and move with it.

## Resume state

- **Done so far:** all three tasks, implemented on `build/agents/830a472f` on 2026-10-09 and left uncommitted, and the review of the same day answered. `Start.chatId` and `chatIdFor` are in the sdk, `spawn` carries it, and Claude, pi and cofold read it. `chatIdOf` writes the backend's own `agentId()` into the record on every rebuild. `StoredChat`, `SessionStore.chats`, `setChats` and `SessionStore.sessions` are in the sdk, kept by both stores. `createChatRecord` builds the chat-to-session map in one pass when the host starts. A resume starts the chat the record marks default, not the URI the session was named by. A closed chat is hidden or deleted by the daemon key `closedChats`. Disposing a session deletes each recorded chat's conversation too.
- **Next action:** none. The plan is built; see [implemented.md](implemented.md).
- **Open questions:** none. All are answered in *Decisions locked in*: the map, the list it is built from, the read-only open, and the two on the closed chat.
- **Watch out for:** a fork already starts with `forkAt` and a new backend id on each backend. The record holds what `agentId()` answers rather than the id that was asked for, and every rebuild passes the recorded one on.

## Final verification checklist

- [x] Two chats of one Claude session write two transcripts.
- [x] A host restarted over the same store serves a peer chat's URI with its turns.
- [x] Closing a chat hides its conversation, and deletes it only when the daemon key says so.
- [x] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [x] `plans/index.md` updated.
