---
title: A dev container case waits for a Docker call that comes late
status: open
date: 2026-11-13
severity: minor
blocks: []
refs:
  - "[code://packages/computer/test/computer-devcontainer.test.ts#L590](../../packages/computer/test/computer-devcontainer.test.ts#L590) - \"offers the session folder's dev container, and not once one exists\""
  - git://74b138b73 - main when the problem was split out of `dev-container-cases-ask-before-the-first-listing.md`
---

## Symptom

In run 43026502133, `windows (1/4)` failed the case "offers the session folder's dev container, and not once one exists" with `the scripted docker never finished 3 calls ... 2 recorded`.
It passes on Linux.

## Cause

Unknown. The case waited the whole `WAIT_MS` for its third Docker call.
Three other cases of the same file asked for a machine before the first listing had answered. Plan container/20261113-2134 fixed those, and this case is not one of them.

## Impact

A Windows CI job can fail at random, and block a merge until it runs again.

## Workaround

None. Running the job again is not a fix.

## Fix

- Find which call is late: log each call the scripted Docker records, with its time, when the case fails.
