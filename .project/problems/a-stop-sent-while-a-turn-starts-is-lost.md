---
title: A stop sent while a turn is starting is echoed, and the turn runs
status: open
date: 2026-11-03
severity: minor
blocks: []
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1402-L1406](../../packages/sdk/src/host/chatactions.ts#L1402-L1406) - a stop with no held turn is echoed as a no-op"
  - git://b12462af - the stop is no longer refused
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
A client sends a message, then sends `chat/turnCancelled` before the backend begins the turn.
The stop is answered, and the turn then runs to its end.

## Cause

While the turn starts, `activeHeld` is still empty.
The host echoes the stop as a no-op and keeps nothing of it.

## Impact

A user who stops at once still waits for the turn and pays for it.

## Workaround

Send the stop again once the turn shows.

## Fix

- Keep a stop that comes while a turn starts, and cancel the turn when it begins.
