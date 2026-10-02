---
title: The docs say who sent what
status: todo
depends: [01, 02]
layer: "docs"
refs:
  - "[code://docs/AHP.md#L213-L246](../../../../docs/AHP.md#L213-L246) - the `chat/*` table, where `chat/turnStarted` and `chat/turnsLoaded` are described"
  - "[code://docs/AHP.md#L335-L344](../../../../docs/AHP.md#L335-L344) - `### Turns`, the table of what a client may assume about a turn"
  - "[code://docs/AHP.md#L613-L627](../../../../docs/AHP.md#L613-L627) - `### Sessions and the catalogue`, where `_meta.git` and `_meta.github` are said to be"
  - "[code://docs/LIBRARY.md#L73-L81](../../../../docs/LIBRARY.md#L73-L81) - the ports table, whose `users` row is what a host with no directory degrades to"
  - "[code://docs/DAEMON.md#L216-L222](../../../../docs/DAEMON.md#L216-L222) - the flags table, whose `--sessions` row says what the file is for"
---

## Objective

The wire documentation says what a client reads to name a turn's sender and a session's owner, and says what is absent when a host has nobody to name.
A client written against these three keys does not have to read the host's source to know they are optional, and a reader of the flags table knows a restart keeps them.

## Files

- `UPDATE: docs/AHP.md:217` - the `chat/turnStarted` row, which today mentions only `queuedMessageId`.
- `UPDATE: docs/AHP.md:246` - the `chat/turnsLoaded` row, so a client paging back knows the sender is still on the page.
- `UPDATE: docs/AHP.md:335-344` - a row in `### Turns` beside "a turn is said back" and "the running turn is `activeTurn`".
- `UPDATE: docs/AHP.md:613-627` - a row in `### Sessions and the catalogue` beside "read and archived" and "project and branch".
- `UPDATE: docs/LIBRARY.md:80` - the `users` row of the ports table.
- `UPDATE: docs/DAEMON.md:221` - the `--sessions` row.
- `docs/PLUGINS.md:280-281` already says `turn_start` and `turn_end` carry `sender`, which is where a plugin reads it. It is not touched here.

## Steps

1. `docs/AHP.md`, the `chat/turnStarted` row: the action carries `_meta.sender`, the typed reference the person who asked is named by - `user:<id>` for somebody who signed in and `root:<host>` for a session the deployment's own token started - and it carries it only when the host was given a users directory. A host with none sends the action as the protocol has it.
2. The same file, the `chat/turnsLoaded` row: the sender is not on the action, which declares no `_meta`, but on each turn's message, so a page of older turns reads the same as the tail window that came before it.
3. The same file, `### Turns`: one row saying that a turn says who sent it, that the live action and the stored turn put it in the `_meta` of the thing the client was handed rather than in one place, and that a turn sent before this was kept says nothing rather than guessing. Naming `origin` on a chat state as what it is not is worth a clause here: `startedBy` gives a chat `{ kind: 'user' }`, which says a person opened it and not which one.
4. The same file, `### Sessions and the catalogue`: `_meta.owner` on the row and on the session state, in the same typed references, beside the rows that already describe `_meta.git` and `_meta.github`. Say that it survives a restart because it is the session store's, not the transcript's, which is the sentence that tells a client it can rely on it after a daemon comes back.
5. `docs/LIBRARY.md`, the `users` row: leave the port out and no `_meta.owner` and no `_meta.sender` is sent, beside the gate that stays inert. This is the plan's third check, and it belongs in the table a reader of the ports goes to for exactly that.
6. `docs/DAEMON.md`, the `--sessions` row: the file holds whose a session is and who sent each of its turns as well as the read and archived bits, which is what makes `--sessions memory` mean a restart forgets them.

## Validation

- `npm run typecheck` - the docs are not typed, but this is the command that fails if a task above changed a name the documentation is quoting.
- Read by hand against a running host: with `users` given, a `chat/turnStarted` frame and a catalogue row from `pnpm wire -- <file>` between them show every claim in steps 1 and 4, and `npm run wire` reports no defect in them.
- Read by hand against a host without one: no `_meta.sender` and no `_meta.owner` anywhere in the same capture, which is what step 5 promises.
- Every other row in those two tables is unchanged, and `docs/PLUGINS.md` still reads as it does: a plugin and a client read the same sender from two different surfaces, and saying so once here is what stops the next reader from assuming they are one thing.

## Resume
