---
title: A cofold write lands on the file its check allowed, and not on one that changed since it was read - implemented
date: 2026-10-09
refs:
  - git://d39935f
---

A cofold write now re-checks the file it opened, and refuses a write to a file that changed since the tool read it.
ahpd runs on that cofold through plugin 40.

## What was built

- Task 01 chose how cofold's tools close the window between the check and the write.
- Tasks 02 and 03 are in cofold `d39935f`: a write re-checks the file it opened, and a stale write is refused.
- Task 04 moved to [plugin 40 task 07](../40-ahpd-runs-on-the-current-cofold/task-07-a-test-reads-before-it-writes.md), which is built.

## Verified

- cofold's own tests at `d39935f`, and plugin 40's gates in ahpd.

## Departures from the plan

- Task 04 was dropped here and built in plugin 40.

## Left for later

- A parent folder swapped for a link before a new file is opened is still followed, because Node's `fs` has no `openat`.
- After a restart, a file is read again before it is written.
- It is tested on Linux only.
