---
title: A malformed X-AHP-Meta from a root or session caller is ignored, not refused
status: open
date: 2026-11-03
severity: minor
blocks: []
refs:
  - "[code://packages/server/src/proxy/caller.ts#L109-L112](../../packages/server/src/proxy/caller.ts#L109-L112) - root and session callers return before the header is read"
  - "[code://packages/server/src/proxy/caller.ts#L144-L151](../../packages/server/src/proxy/caller.ts#L144-L151) - a key caller's bad header is refused with 400"
  - git://daa0fe8c - usage/20261029-2011 added the meta header
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
A session calls the proxy with `X-AHP-Meta: bad`.
The call is let through, and no 400 comes back.

## Cause

`callerOf` returns for the root token and for a session before it reads the header.
Only a caller with a key reaches the check.

## Impact

The plan's *Answers* row says a bad header is 400, and that holds for key callers only.
It fits the rule that only proxy records with a key carry meta.

## Workaround

None needed.

## Fix

- Narrow the *Answers* row to key callers.
- Or read and check the header for every caller.
