---
title: A Bot chat started from the new session form stops
status: open
date: 2026-11-04
severity: major
refs:
  - "[code://packages/bot/src/chat.ts#L1392-L1401](../../packages/bot/src/chat.ts#L1392-L1401) - the Bot chat's one setting, `bot`"
  - git://0004a9a6 - host/20261030-0618, which made the `bot` setting a picker
---

## Symptom

On 2026-11-04, Softov chose the Bot chat agent in the new session form, and picked a bot. The `Bot` picker listed each bot by its name. The form created a new session, and that session stopped.

## Cause

Unknown.

## Impact

A person cannot start a chat with a bot from the new session form. The section *The Bot chat offers its bots* of [session-picker-checks.md](../pending/session-picker-checks.md) cannot pass.

## Workaround

None known.

## Fix

Not looked at yet.
