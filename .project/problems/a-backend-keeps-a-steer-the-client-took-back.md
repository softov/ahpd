---
title: A backend keeps a steering message that the client took back
status: open
date: 2026-11-03
severity: minor
blocks: []
refs:
  - "[code://packages/agent-claude/src/session/turns.ts#L756](../../packages/agent-claude/src/session/turns.ts#L756) - Claude `unqueue` ignores a steer"
  - "[code://packages/agent-cofold/src/turns.ts#L802](../../packages/agent-cofold/src/turns.ts#L802) - cofold `unqueue` ignores a steer"
  - "[code://packages/agent-pi/src/session.ts#L1546](../../packages/agent-pi/src/session.ts#L1546) - pi `unqueue` ignores a steer"
  - git://516bb2e6 - the client now gets a refusal while a turn runs
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
A client sets a steering message, then removes it.
With no turn running, the host echoes the removal.
The backend may still hold the steer and use it.

## Cause

The cofold, Claude and pi `unqueue` functions act on queued messages only.
While a turn runs, the host refuses the removal, so only the case with no turn is open.

## Impact

What the agent does next may follow a message the user took back.
Whether a backend holds a steer with no turn running is not known.

## Workaround

None.

## Fix

- Make each `unqueue` remove a steer it holds.
- Or refuse the removal of a steer that a backend was given.
