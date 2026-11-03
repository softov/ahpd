---
title: A chat state held from the record misses its config schema after a wake
status: open
date: 2026-11-03
severity: minor
blocks: []
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L1886-L1890](../../packages/sdk/src/host/spawn.ts#L1886-L1890) - a chat state opens only when none is held"
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
A session's chat state is opened from its record, and the session then wakes.
The `_meta` of the session is repaired, and the config schema and the customizations are not sent again.

## Cause

The wake opens a chat state only when none is held.
A state already held keeps what the record seeded, and `chatMoved` repairs only `_meta`.

## Impact

A client can show a stale config form and stale customizations after a wake.
No test covers it.

## Workaround

None.

## Fix

- Send the config schema and the customizations again when a held state wakes.
- Add a test that wakes a session whose state was seeded from its record.
