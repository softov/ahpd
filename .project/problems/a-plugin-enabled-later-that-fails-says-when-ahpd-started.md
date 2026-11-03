---
title: A plugin enabled later that fails says it failed when ahpd started
status: open
date: 2026-11-03
severity: minor
blocks: []
refs:
  - "[code://packages/server/src/applyplugins.ts#L107-L111](../../packages/server/src/applyplugins.ts#L107-L111) - `eventFailed` says `when ahpd started` for every `listening` throw"
  - git://69d171b3 - plugin/20261101-1803 added the alert
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
The daemon runs, and the operator enables a plugin whose `listening` handler throws.
The plugin's row says "This plugin failed when ahpd started".

## Cause

`eventFailed` chooses the words from the event type only, and does not know when the plugin was enabled.

## Impact

The operator looks for a problem at start that did not happen there.
It is also not known whether a `stopping` alert stays on a plugin that is then unloaded.

## Workaround

None.

## Fix

- Say "when it was enabled" when the daemon is already listening.
- Or say "when it started", which is true in both cases.
