---
title: A bot shows in the session picker between isolation and branch
status: open
date: 2026-11-09
severity: minor
refs:
  - "[code://packages/bot/src/chat.ts#L1292-L1302](../../packages/bot/src/chat.ts#L1292-L1302) - the bot chat's schema, whose one key is `bot`"
  - "[code://packages/sdk/src/host/common.ts#L99-L103](../../packages/sdk/src/host/common.ts#L99-L103) - `isolation` and `branch`, keys the host adds to a session's schema"
  - "[code://packages/sdk/src/host/owners.ts#L305-L310](../../packages/sdk/src/host/owners.ts#L305-L310) - the host merges its own properties with the backend's"
  - git://18ab9642d - the last commit that holds `pending/host-103-drawing-checks.md`, the check where this showed
---

## Symptom

Softov saw this on 2026-11-09, during the checks of plan host/103.
The picker of a new session showed a bot between the isolation chip and the branch chip.
Which client and which agent were not recorded.

## Cause

Unknown.
The `bot` key is in the schema of the bot chat provider only.
The host merges `isolation` and `branch` with the backend's properties, so the order of the merge may put `bot` between them.
Not checked: whether the picker was for a bot chat, or whether `bot` reaches the schema of another agent.

## Impact

A person sees a choice in the picker that may not belong to the agent.

## Workaround

None.

## Fix

No fix is chosen. Start a session in VS Code and in ahpw, for a bot chat and for another agent, and read the schema the host sends.

- If `bot` shows for another agent, keep it to the bot chat's schema.
- If it shows only for a bot chat, put the host's keys before or after the backend's, as VS Code's picker orders them.
