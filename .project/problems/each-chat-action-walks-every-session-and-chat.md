---
title: Each chat action walks every session and chat
status: open
date: 2026-11-03
severity: minor
blocks: []
refs:
  - "[code://packages/sdk/src/host.ts#L1106-L1110](../../packages/sdk/src/host.ts#L1106-L1110) - every `chat/` action runs `chatMoved`"
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
Each chat action that is not a streamed delta runs `chatMoved`, then `summaryMoved`, then `factsMoved`, and the active count.

## Cause

What a chat moved is told to its session on each action.
Nothing batches or throttles the work, and it diffs JSON and walks every session and chat.

## Impact

The cost of one action grows with the number of sessions and chats the host holds.
A busy host with many chats may spend most of its time here.

## Workaround

None.

## Fix

- Run the walk once per tick for all the chats that moved.
- Or update the summary and facts only for the session that moved.
