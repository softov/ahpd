---
title: A push device hears a session by its client id, with no owner check
status: open
date: 2026-11-08
severity: minor
blocks: []
refs:
  - "[code://packages/push/src/plugin.ts#L213-L224](../../packages/push/src/plugin.ts#L213-L224) - `audience` takes a device by its client alone"
  - git://910a9067d - a device hears the sessions its client opened
  - git://83efef0ca - the audit branch's head when the problem was read
  - git://598b5d35b - main when the problem was read again, on 2026-11-11
---

## Symptom

Read from the code in the security review of 2026-11-08, and not reproduced.
On a host with users, a device registered with the client id of another person's client gets notifications for that person's sessions.

## Cause

At `e388d12f5` the audience dropped every device whose owner was not the session's owner.
Main adds a match by client id, and that match has no owner check.
A connection declares its own client id.

## Impact

A person who learns or reuses another person's client id gets their session notifications, with titles and messages.

## Workaround

None.

## Fix

- Check `device.owner` against the session's owner for the client match too, on a host with users.
