---
title: A forked chat says which chat and turn it came from
domain: host
status: planned
priority: medium
created: 2026-09-28
revalidated: 2026-09-28
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/host.ts#L782-L811](../../../../packages/sdk/src/host.ts#L782-L811) - `startedBy` and `chatSummary`: every chat is `{ kind: 'user' }`"
  - "[code://packages/sdk/src/host.ts#L3227](../../../../packages/sdk/src/host.ts#L3227) - `session/chatUpdated` resends `chatSummary`, so an origin set once would be overwritten"
  - "[code://packages/sdk/src/host.ts#L5302-L5303](../../../../packages/sdk/src/host.ts#L5302-L5303) - the live session snapshot's `chats`"
  - "[code://packages/sdk/src/host.ts#L5349](../../../../packages/sdk/src/host.ts#L5349) - the chat channel's own state, with `startedBy`"
  - "[code://packages/sdk/src/host.ts#L7226-L7311](../../../../packages/sdk/src/host.ts#L7226-L7311) - `createChat`, which reads `source` and keeps nothing of it"
  - "[code://packages/sdk/src/host.ts#L848-L866](../../../../packages/sdk/src/host.ts#L848-L866) - the worker chats' `tool` origin, the pattern: the origin kept beside the chat"
  - "[code://packages/sdk/src/host.ts#L1520-L1535](../../../../packages/sdk/src/host.ts#L1520-L1535) - `spelledFor` respells `origin.chat`, mapping any non-worker chat to the default chat"
  - "[code://packages/sdk/test/host.test.ts#L5489-L5521](../../../../packages/sdk/test/host.test.ts#L5489-L5521) - the fork and side-chat cases, which check no origin"
  - npm://@microsoft/agent-host-protocol@0.9.0 - `ChatOrigin` `{ kind: 'fork', chat, turnId }` and `{ kind: 'sideChat', chat, turnId, selection? }` on `ChatSummary` and `ChatState`
---

## Goal

A chat made by forking another shows as a fork of that chat at that turn, and a side chat as a side chat, in the session's chat list and in the chat's own state, for as long as the daemon holds the session.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "chatSummary|startedBy" packages/sdk/src/host.ts` - four callers of `chatSummary`: `chatUpdated`, the in-process `createChat`, the snapshot, and the RPC `createChat`.
- A restored session lists only its default chat and its workers (`host.ts:5435-5452`), so no forked chat exists to mark after a restart.

### Runtime path

```
createChat { source: { kind: 'fork', chat, turnId } } -> [new] origins.set(uri, { kind: 'fork', chat, turnId })
  -> session/chatAdded, session/chatUpdated, snapshot chats, chat state: origin from the map, else startedBy
```

### Gaps

- `startedBy` says `user` for every chat, forks included.
- The source is a local of `createChat` and is lost after it.
- `spelledFor` would respell a fork's `origin.chat` as the default chat even when the source was a secondary chat.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| A forked chat's origin is `{ kind: 'fork', chat, turnId }` on `session/chatAdded`, every `session/chatUpdated`, the session snapshot and the chat's state. | Softov, 2026-09-28: "when `createChat` had `source.kind === 'fork'`, set the protocol's `ChatOrigin` for a fork (source chat and turn) on `session/chatAdded` and in the snapshot". | 01 |
| A side chat gets `{ kind: 'sideChat', chat, turnId, selection }` the same way. | (defaulted: the same source and code; the protocol has the kind) | 01 |
| The origin lives for the life of the held session; nothing is persisted. | (defaulted: a restored session lists no chat but its default one and its workers) | - |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A forked or side chat carries its origin](task-01-a-forked-chat-carries-its-origin.md) | todo | - |

## Risks and tradeoffs

- The origin is lost when the daemon restarts, like the chat itself.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-forked-chat-carries-its-origin.md](task-01-a-forked-chat-carries-its-origin.md).
- **Open questions:** none.
- **Watch out for:** `chatSummary` is resent on every title, status or activity change, so the origin must come from a map it reads, not from the action that created the chat.

## Final verification checklist

- [ ] A fork's `session/chatAdded`, a later `session/chatUpdated`, the session snapshot and the chat's own state carry the fork origin, and validate against the protocol schema.
- [ ] VS Code or ahpapp shows the forked chat as a fork.
- [ ] `pnpm typecheck`, `pnpm boundary`, `pnpm test` green; `plans/index.md` updated.
