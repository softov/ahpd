---
title: An unreadable session file is kept - implemented
date: 2026-11-05
refs:
  - git://43069d13 - the merge of #227
  - "[code://packages/sdk/src/sessions/sessions.ts](../../../../packages/sdk/src/sessions/sessions.ts) - a session file this build cannot read, moved aside"
---

A session file that this build cannot read is moved aside at load, so a later write for its id never replaces it.

## What was built

- [`code://packages/sdk/src/sessions/sessions.ts`](../../../../packages/sdk/src/sessions/sessions.ts) - the move of a file that is not JSON, or that a newer ahpd wrote.

## Verified

- The new cases in `sessions.test.ts` fail without the change.
- CI on main after #242 passed every check.

## Departures from the plan

- The log line for a file that is not JSON no longer quotes the parser's error, which quoted the file.

## Left for later

- none
