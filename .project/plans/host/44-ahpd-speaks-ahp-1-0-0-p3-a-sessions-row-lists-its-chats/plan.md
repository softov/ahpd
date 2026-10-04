---
title: A session's row lists its chats with their status, and a chat is read or archived on its own
domain: host
status: planned
priority: high
created: 2026-10-03
revalidated: 2026-10-04
requires:
  - plans/host/44-ahpd-speaks-ahp-1-0-0/plan.md
  - plans/host/44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md
refs:
  - "[code://packages/sdk/src/host/catalogue.ts#L55-L65](../../../../packages/sdk/src/host/catalogue.ts#L55-L65) - `chatSummary`, a chat's row with the backend's status and no client flags"
  - "[code://packages/sdk/src/host/catalogue.ts#L68-L76](../../../../packages/sdk/src/host/catalogue.ts#L68-L76) - `subagentSummary`, a worker chat's row"
  - "[code://packages/sdk/src/host/catalogue.ts#L173-L191](../../../../packages/sdk/src/host/catalogue.ts#L173-L191) - `summaryOf`, the catalogue row, with no `chats` and no `defaultChat`"
  - "[code://packages/sdk/src/host/catalogue.ts#L219-L240](../../../../packages/sdk/src/host/catalogue.ts#L219-L240) - `summaryMoved`, every mutable field on each `root/sessionSummaryChanged`"
  - "[code://packages/sdk/src/host/spawn.ts#L165](../../../../packages/sdk/src/host/spawn.ts#L165) - a worker chat's `session/chatUpdated`"
  - "[code://packages/sdk/src/host/spawn.ts#L590-L605](../../../../packages/sdk/src/host/spawn.ts#L590-L605) - a chat's `session/chatUpdated` on a status change, then `summaryMoved`"
  - "[code://packages/sdk/src/host/snapshots.ts#L230-L245](../../../../packages/sdk/src/host/snapshots.ts#L230-L245) - the session state's `chats`: peer chats, live workers, restored workers"
  - "[code://packages/sdk/src/host/actions.ts#L511-L528](../../../../packages/sdk/src/host/actions.ts#L511-L528) - `session/isReadChanged` and `session/isArchivedChanged`, the pattern a chat's flags mirror"
  - "[code://packages/sdk/src/host/chatactions.ts#L1126-L1127](../../../../packages/sdk/src/host/chatactions.ts#L1126-L1127) - `not served yet`, where `chat/isReadChanged` lands today"
  - "[code://packages/sdk/src/types/sessions.ts#L136-L145](../../../../packages/sdk/src/types/sessions.ts#L136-L145) - `chatTitle`, a per-chat value in the session store, keyed by the chat URI"
  - "[code://packages/sdk/test/host.test.ts#L2388-L2390](../../../../packages/sdk/test/host.test.ts#L2388-L2390) - a session marked read through `dispatchAction`"
  - "[code://packages/sdk/test/conformance.test.ts](../../../../packages/sdk/test/conformance.test.ts) - every emitted action replayed through the protocol's reducers"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `SessionChatUpdatedAction`: when `changes.status` changes the host MUST project it into `SessionChatSummary.status` and publish the catalogue through `root/sessionSummaryChanged` (`channels-session/actions.ts:87-89`); `SessionSummary.chats`, `defaultChat` and `SessionChatSummary` (`channels-session/state.ts:521-568`); a `chats` in `changes` replaces the whole catalogue (`channels-root/notifications.ts:140-147`); `chat/isReadChanged`, `chat/isArchivedChanged`, client-dispatchable, changing only the addressed chat (`channels-chat/actions.ts:859-894`); the chat reducer sets the flag on `ChatState.status` (`channels-chat/reducer.ts:964-968`)"
---

## Goal

A session's catalogue row carries its chats, each with the status a client would read in the session, and names its default chat, so a client watching only the list can draw every chat and the 1.0.0 MUST on `session/chatUpdated` is met.
A client can mark one chat read, unread, archived or restored without touching its session or the other chats, and every client sees it.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "session/chatUpdated" packages/sdk/src/host` - `spawn.ts:165` (workers), `spawn.ts:595` (a chat's title, status or activity moved), `tooling.ts:211` (a rename); each is followed by `summaryMoved`, so the notification already goes out and only `chats` is missing from it.
- `rg -n "session/chatAdded|session/chatRemoved|session/defaultChatChanged" packages/sdk/src/host` - `spawn.ts:211`, `lifecycle.ts:121`, `tooling.ts:305`, `sessionmethods.ts:676`, `sessionmethods.ts:714`, `sessionmethods.ts:717`; whether each is followed by `summaryMoved` is checked in task 01.
- `rg -n "IS_CLIENT_DISPATCHABLE" packages/sdk/src/host` - a client action is gated by the package's table, which in 1.0.0 marks both chat flags dispatchable, so after p1 they reach `not served yet`.

### Gaps

- `summaryOf` has no `chats` and no `defaultChat`.
- A chat's status carries no `IsRead` or `IsArchived`; the session store keeps flags per session only.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| A running session's row carries `chats` and `defaultChat`, and every `root/sessionSummaryChanged` carries the whole `chats` list | AHP 1.0.0 `SessionChatUpdatedAction` MUST; `SessionSummaryChangedParams.changes`: "When `chats` is present, it replaces the complete compact chat catalog" | 01 |
| `SessionSummary.chats` is built from the same list as `SessionState.chats`, in the same order, cut to `SessionChatSummary`'s fields | (defaulted: one list, so the row and the state cannot disagree about a chat) | 01 |
| A row read from a transcript, with no session running, carries no `chats` | (defaulted: absent is "not provided", and a catalogue of chats nobody has opened is a read this host does not make for a list) | 01 |
| `chat/isReadChanged` and `chat/isArchivedChanged` change the addressed chat only, and the host updates `ChatState.status`, `ChatSummary.status` and `SessionChatSummary.status` | AHP 1.0.0 `ChatIsReadChangedAction` | 02 |
| A chat's flags are kept in the session store per chat URI, persisted like a chat's title, and forgotten with the session | (defaulted: mirrors `chatTitle`, the store's one other per-chat value) | 02 |
| `chat/isArchivedChanged` on a session's default chat archives or restores the session: it sets the session's `IsArchived` as `session/isArchivedChanged` does, and the chat's own bit is left alone | Softov, 2026-10-03, asked "If a client archives the default (first) chat, does that archive the whole session?": "Archives the session"; AHP 1.0.0 `ChatIsArchivedChangedAction`: archiving the default chat "is equivalent to archiving the session" | 02 |

## Proposed architecture

- **Data flow** - a chat moves -> `session/chatUpdated` -> `summaryMoved` -> `root/sessionSummaryChanged` with `chats` from `chatCatalogOf(session)`; `chat/isReadChanged` -> session store chat flags -> the action on the chat channel, `session/chatUpdated` with the new `status`, `summaryMoved`.
- **Layer responsibilities** - sdk host: the catalogue and the dispatch · sdk session store: per-chat flags.
- **Source-of-truth files** - [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts), [`code://packages/sdk/src/host/snapshots.ts`](../../../../packages/sdk/src/host/snapshots.ts), [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/sdk/src/sessions.ts`](../../../../packages/sdk/src/sessions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A session's row lists its chats and its default chat](task-01-a-sessions-row-lists-its-chats.md) | todo | - |
| [02 - A chat is marked read or archived on its own](task-02-a-chat-is-marked-read-or-archived-on-its-own.md) | todo | 01 |

## Risks and tradeoffs

- Every `root/sessionSummaryChanged` grows by the chat list, sent on each turn start and end; a session has a handful of chats, and the notification is already sent on every chat change.
- A client on 0.9.0 receives `chats` and `defaultChat` too; 1.0.0 registers nothing for summary fields by version, and an older reducer spreads them onto the row harmlessly.

## Resume state

- **Done so far:** nothing.
- **Next action:** p1 first; then [task-01-a-sessions-row-lists-its-chats.md](task-01-a-sessions-row-lists-its-chats.md).
- **Open questions:** none.
- **Watch out for:** `IsRead` and `IsArchived` are orthogonal to the activity bits; a chat's status is its activity bits from the backend OR its flags, never the session's flags.

## Final verification checklist

- [ ] A turn in a peer chat sends `session/chatUpdated` and a `root/sessionSummaryChanged` whose `chats` entry for that chat carries the same `status`.
- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [ ] `plans/index.md` updated.
