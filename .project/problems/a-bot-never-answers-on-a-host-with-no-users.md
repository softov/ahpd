---
title: A bot never answers on a host with no users
status: open
date: 2026-11-13
severity: major
blocks: []
refs:
  - "[code://packages/bot/src/wake.ts#L712-L716](../../packages/bot/src/wake.ts#L712-L716) - the wake refuses a Front session that has no owner"
  - "[code://packages/sdk/src/host/owners.ts#L75-L79](../../packages/sdk/src/host/owners.ts#L75-L79) - a host with no users directory records no owner"
  - git://878abb8a8 - main when the problem was read
---

## Symptom

Seen on 2026-11-13 on the test daemon, which has no `users` key in its config.
A message to a bot fails at once with `<session> is a session this host does not hold`.

## Cause

A host with no users directory records no owner for a session.
The wake reads the owner of the Front session and refuses a session without one.

## Impact

A bot does not answer on a single-person host, which is the default install.

## Workaround

Set `users` in the daemon config.

## Fix

- Let the wake take a session with no owner on a host with no users, and use the bot's owner for the context block.
- Add a case on a host with no users directory.
