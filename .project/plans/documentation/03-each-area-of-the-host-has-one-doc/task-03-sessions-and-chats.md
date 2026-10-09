---
title: Sessions and chats have their own docs
status: implemented
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

`docs/SESSIONS.md` is written, 136 lines: what a session is and its terms; the life of one, from `createSession`'s order of work to `disposeSession`; whose it is and what it is charged to; the status bitset and the state a session reports; how `listSessions` pages; the config keys with each option, default and what changes; isolation and worktrees; the commands; the grants; and what to read next. Every claim was read in `packages/sdk/src/host/sessionmethods.ts`, `packages/sdk/src/host/sessionconfig.ts`, `packages/sdk/src/host/lifecycle.ts`, `packages/sdk/src/host/owners.ts`, `packages/sdk/src/host/machines.ts`, `packages/sdk/src/host/gate.ts`, `packages/sdk/src/host/state.ts`, `packages/sdk/src/scopes.ts`, `packages/sdk/src/catalog.ts` and `packages/sdk/src/sessions.ts`.

`docs/CHATS.md` is written, 108 lines: what a chat is and its terms; the first chat and how a chat is named; a chat made out of another (`fork` and `sideChat`); turns, senders, endings, pending messages and drafts; compaction and the rewind; attachments with their limits; subagents as worker chats; the commands; the grants; and what to read next. Read against `packages/sdk/src/host/sessionmethods.ts`, `packages/sdk/src/host/channels.ts`, `packages/sdk/src/host/spawn.ts`, `packages/sdk/src/host/state.ts`, `packages/sdk/src/host/routing.ts`, `packages/sdk/src/attachments.ts`, `packages/sdk/src/host/attachments.ts` and `packages/agent-claude/src/session/query.ts`.

Updated: `docs/AHP.md`'s "Behaviour worth knowing" now opens with one line naming the area doc for each thing it describes, so its rows stay wire rows and a reader who wants what a session *is* is sent to SESSIONS.md. `docs/DAEMON.md`'s `--sessions` row gained a link to SESSIONS.md.

No section moved in this task, so no link pointed at anything that left. The sweep found the same anchors as after task 02, all resolving.

Found, and written as the code does it, not as the old text did:

- A chat's write group and a session's are one: `holds` in `packages/sdk/src/users.ts:281` answers a `chat:` grant from `session:write`, so `member` needs no `chat:` grant of its own. SESSIONS.md's Grants section says so.
- `InputNeeded` is 24 and carries `InProgress` (8) - `packages/sdk/src/catalog.ts:18` says outright that anything testing activity has to test it first.
- `listSessions` has no page size unless a client asks for one, and the size this host chooses is the whole catalogue up to 1000 rows, because neither client that connects here reads `nextCursor` - `packages/sdk/src/host/sessionmethods.ts:62`.
