---
title: A read-only chat can be resumed
status: open
date: 2026-11-13
severity: minor
blocks: []
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1795](../../packages/sdk/src/host/chatactions.ts#L1795) - the resume check compares `interactivity` with `readOnly`"
  - "[code://packages/sdk/src/host/spawn.ts#L684](../../packages/sdk/src/host/spawn.ts#L684) - the host writes a worker chat as `read-only`"
  - https://github.com/microsoft/agent-host-protocol/blob/2c37a04f/types/channels-chat/state.ts - `ChatInteractivity.ReadOnly` is `read-only`
  - git://6418b8521 - main when the problem was read
---

## Symptom

Read from the code on 2026-11-13, and not reproduced.
The `chat/turnResume` check in `chatactions.ts` refuses a chat whose `interactivity` is `readOnly`.

## Cause

The protocol value is `read-only`, and the host writes `read-only`, so the check never matches.

## Impact

A resume that reaches this check in a `read-only` chat is not refused by it.
A worker chat is still refused earlier, at `chatactions.ts:492`, so the gap shows only for a `read-only` chat that is not a worker.

## Workaround

None.

## Fix

- Compare with `read-only`, and add a test that resumes an errored turn in a `read-only` chat.
