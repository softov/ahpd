---
title: A peer chat is its own conversation, and survives a restart
domain: host
status: planned
priority: high
created: 2026-10-03
revalidated: 2026-10-03
requires: []
refs:
  - "[code://packages/sdk/src/host.ts#L950-L978](../../../../packages/sdk/src/host.ts#L950-L978) - `Held.chats`, in memory only"
  - "[code://packages/sdk/src/host.ts#L6119-L6130](../../../../packages/sdk/src/host.ts#L6119-L6130) - the internal `createChat`: a peer chat is `spawn(held.agent, <session uri>, ahp-chat:/<uuid>, ...)` with no resume and no id of its own"
  - "[code://packages/sdk/src/host.ts#L3688-L3700](../../../../packages/sdk/src/host.ts#L3688-L3700) - `spawn`, whose `Start.uri` is the session's URI for every chat"
  - "[code://packages/sdk/src/host.ts#L5287-L5347](../../../../packages/sdk/src/host.ts#L5287-L5347) - the in-process restart, which rebuilds only `held.defaultChat`"
  - "[code://packages/sdk/src/host.ts#L5440-L5462](../../../../packages/sdk/src/host.ts#L5440-L5462) - `restartChat`: `{ resume: agentId(), seed: allTurns() }`, the respawn every rebuild here copies"
  - "[code://packages/sdk/src/host.ts#L10540-L10552](../../../../packages/sdk/src/host.ts#L10540-L10552) - resuming a listed session spawns only `chatUriFor(named)`"
  - "[code://packages/sdk/src/host.ts#L1512-L1513](../../../../packages/sdk/src/host.ts#L1512-L1513) - `chatUriFor`, the default chat's name"
  - "[code://packages/sdk/src/host.ts#L1597](../../../../packages/sdk/src/host.ts#L1597) - `chatOf`, which after a restart resolves `ahp-chat:/<uuid>` to a session named by that uuid and is refused"
  - "[code://packages/sdk/src/host.ts#L4228-L4235](../../../../packages/sdk/src/host.ts#L4228-L4235) - the catalogue skips a backend row whose id is `claimed`"
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
- `rg -n "held.chats.set|spawn\(" packages/sdk/src/host.ts` - the resume at :10549 and the in-process restart at :5287-5347 spawn only the default chat.
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
| A peer chat's backend id is the uuid of its `ahp-chat:/<uuid>`, handed to the backend as `Start.chatId`; the default chat keeps the session's id | (defaulted: one name for one conversation, and the uuid is already minted for the URI) | 01 |
| The store records each session's chats: URI, backend id, title, origin, and which is the default | the defect: the store keeps no list of chats, so nothing can rebuild them | 02 |
| Resume and the in-process restart rebuild every recorded chat with `{ resume: <backend id>, seed: <its transcript> }`, as `restartChat` does | the defect: only the default chat is rebuilt (`host.ts:5287-5347`, `:10549`) | 03 |
| A recorded peer chat's backend id is claimed, so the catalogue does not list it as a session of its own | [`code://packages/sdk/src/host.ts#L4228-L4235`](../../../../packages/sdk/src/host.ts#L4228-L4235), the existing `claimed` skip | 03 |
| A nested session's chats are recorded and not rebuilt, as its default chat is not resumed today | [`code://packages/sdk/src/nested.ts#L372-L375`](../../../../packages/sdk/src/nested.ts#L372-L375): a fresh inner session each start | 03 |

## Proposed architecture

- **Data flow** - `createChat` -> `chatId = uuid of the chat URI` -> `Start.chatId` -> backend runs under it -> store `setChats(session, [...])`; restart -> `chats(session)` -> spawn each with `resume` and `seed` -> claims.
- **Layer responsibilities** - sdk types: `Start.chatId`, `StoredChat` · sdk store: the list · sdk host: record, rebuild, claim · agent-claude, agent-pi, agent-cofold: use `chatId` · agent-acp, nested: unchanged.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/sdk/src/sessions.ts`](../../../../packages/sdk/src/sessions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A peer chat runs under its own backend id](task-01-a-peer-chat-runs-under-its-own-backend-id.md) | todo | - |
| [02 - The store records a session's chats](task-02-the-store-records-a-sessions-chats.md) | todo | - |
| [03 - A restart rebuilds every chat of a session](task-03-a-restart-rebuilds-every-chat.md) | todo | 01, 02 |

## Risks and tradeoffs

- Peer chats opened before this lands share the session's backend conversation; they are not split after the fact, and the store has no record of them, so they are not rebuilt.
- host/48 splits `host.ts`; line numbers here are `main` at `1eb8c8f` and move with it.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-peer-chat-runs-under-its-own-backend-id.md](task-01-a-peer-chat-runs-under-its-own-backend-id.md) and [task-02-the-store-records-a-sessions-chats.md](task-02-the-store-records-a-sessions-chats.md), independent.
- **Open questions:** none.
- **Watch out for:** a fork (`source.kind: 'fork'`) already starts with `forkAt` and a new backend id on each backend; it must take `chatId` as that new id rather than minting another.

## Final verification checklist

- [ ] Two chats of one Claude session write two transcripts.
- [ ] A host restarted over the same store serves a peer chat's URI with its turns.
- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [ ] `plans/index.md` updated.
