---
title: JSON files are read and written through one helper, and the session store keeps one row per session - implemented
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/jsonfile.ts](../../../../packages/sdk/src/jsonfile.ts)"
  - "[code://packages/sdk/src/sessions.ts](../../../../packages/sdk/src/sessions.ts)"
---

The sdk has one JSON reader and one atomic writer, and every JSON file the sdk, the daemon and computer keep goes through them. A read says why a file gave no value: missing, unreadable, not JSON or not an object. A write goes to a scratch file and replaces the old one by rename. The session store keeps one row per session instead of one map per field.

## What was built

- [`code://packages/sdk/src/jsonfile.ts`](../../../../packages/sdk/src/jsonfile.ts) - `readJson`, `readJsonObject`, `writeJsonAtomic` and their result types, exported from the sdk.
- [`code://packages/sdk/src/policies.ts`](../../../../packages/sdk/src/policies.ts), [`code://packages/sdk/src/scheduled.ts`](../../../../packages/sdk/src/scheduled.ts) and [`code://packages/sdk/src/users.ts`](../../../../packages/sdk/src/users.ts) - read and write through the helper.
- [`code://packages/server/src/vault.ts`](../../../../packages/server/src/vault.ts), [`code://packages/server/src/install.ts`](../../../../packages/server/src/install.ts) and [`code://packages/server/src/daemon.ts`](../../../../packages/server/src/daemon.ts) - the daemon's files read and write through the helper; the vault's refusals still quote no parser text.
- [`code://packages/computer/src/owners.ts`](../../../../packages/computer/src/owners.ts) - the owner file reads and writes through the helper.
- [`code://packages/sdk/src/sessions.ts`](../../../../packages/sdk/src/sessions.ts) - `memorySessions` keeps one `Map<string, Row>`, and `fileSessions` reads and writes that row.

## Verified

- `packages/sdk/test/jsonfile.test.ts` is new, and `packages/sdk/test/sessions.test.ts` and `packages/server/test/vault-file.test.ts` gained cases.
- The gates passed on main after host 59 tasks 01-06: 260 test files, 4531 tests, typecheck, boundary and build.
- `renameSync` is left only in `jsonfile.ts`, the daemon log rotation, the session migration and the wire log rotation.
- The wire log rotation in `packages/server/src/wire.ts` is not in the plan's list, and it writes no JSON.

## Departures from the plan

- The `missing` result carries Node's error, so a session file that goes between the listing and the read logs the same text as before.
- `readJsonObject` uses `isRecord` from host 59's `values.ts`.
- `writeEntry` writes by rename, so a symlinked plugin config becomes a plain file at `0o600`. Softov accepted this on 2026-10-09.
- `migrateSessions` makes no folder when it has no sessions to move, and it logs a file it could not read. `nestedSessions` lists sessions in the order their rows were made.

## Left for later

- None.
