---
title: The session store is one file per session, and rows whose session is gone are pruned
status: accepted
date: 2026-09-30
refs:
  - "[code://packages/sdk/src/sessions.ts#L109-L207](../../packages/sdk/src/sessions.ts#L109-L207) - `fileSessions`: one `sessions.json`, rewritten whole on every change"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/sessionDataService.ts#L72-L195 - a directory per session, deleted with it, and an orphan cleanup
---

## Context

`sessions.json` holds one row per session ever touched and is rewritten whole on every change; on 2026-09-30 it held 324 rows.
No row is removed unless its live session is disposed, so a transcript deleted outside ahpd leaves its row forever.

## Decision

The store keeps `sessions/<id>.json`, one file per session, each written with a temporary file and a rename; `forget` removes the file.
After a full catalogue listing, the store drops every row whose session no backend lists.
An existing `sessions.json` is split once and renamed `sessions.json.migrated`.

Source: Softov, 2026-09-30: "we need to see about storing session info in multiple files when files.. because that json can't grow forever"; asked the layout: "One file per session"; asked how gone sessions leave: "Prune after a listing".

## Consequences

A write costs one row, and the store's size follows the sessions that exist.
The id becomes a file name, so it is made safe for one.
The `SessionStore` port gains `prune(known)`; an embedder's store implements it or keeps everything.

## Options

- **An index plus per-session files**: two write paths, and the index still grows by a row per session.
- **An append log with compaction**: cheap writes, but one file again, and replay code.
