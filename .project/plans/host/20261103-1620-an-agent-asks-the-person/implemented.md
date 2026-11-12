---
title: An agent asks the person - implemented
date: 2026-11-04
refs:
  - git://c6caff5e
  - "[code://packages/sdk/src/tools/askuser.ts](../../../../packages/sdk/src/tools/askuser.ts)"
  - "[code://packages/sdk/src/host/tooling.ts](../../../../packages/sdk/src/host/tooling.ts)"
---

An agent asks the person questions in the chat with the host's `ask_user` tool, and waits for the answers.

## What was built

- [`code://packages/sdk/src/tools/askuser.ts`](../../../../packages/sdk/src/tools/askuser.ts) - the tool, its schema and its answer as text.
- [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts) - `toolContext` builds `ask` on the host's held requests.

## Verified

- #210 merged with CI green, on Linux and Windows.
- Softov ran the *ask_user* section of `host-1620-terminal-tool-checks.md` on Linux on 2026-11-04, and it passed.

## Departures from the plan

- None.

## Left for later

- The same check passed on Windows on 2026-11-12. macOS was not run, and the check closed on 2026-11-12 on Softov's word.
