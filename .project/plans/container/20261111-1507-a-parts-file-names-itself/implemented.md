---
title: A parts file names itself in its errors - implemented
date: 2026-11-11
refs:
  - git://1780c81fc
  - "[code://packages/computer/src/parts.ts](../../../../packages/computer/src/parts.ts) - `said` takes the file, and `entryOf` takes the path"
  - "[code://packages/computer/test/computer-parts.test.ts](../../../../packages/computer/test/computer-parts.test.ts) - the cases"
---

An error about an entry of a parts file names the file that `readParts` read.
It names the shipped `versions.json` only when that file was read.

## What was built

- [`code://packages/computer/src/parts.ts`](../../../../packages/computer/src/parts.ts) - `said(file, problem)`, and `entryOf(value, where, path)` with a local `refuse`. The message of `exact` names `path`.
- [`code://packages/computer/test/computer-parts.test.ts`](../../../../packages/computer/test/computer-parts.test.ts) - a case for an entry error from a temp file. Three version cases now expect the temp file, not the shipped one.

## Verified

- `pnpm typecheck` is clean.
- `npx vitest run packages/computer` under the shared lock: 600 passed, 1 skipped, 1 failed. The failure is `computer-spawn.test.ts` "fails a turn on a session whose CLI is gone".
HANDOFF records that it fails on main on this machine and passes on CI.

## Departures from the plan

- A third case, the Claude part's refused range, also expected the shipped path, and now expects the temp file.

## Left for later

- None.
