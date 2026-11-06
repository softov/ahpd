---
title: A rules walk visits a folder once - implemented
date: 2026-11-05
refs:
  - git://42fc7667 - the merge of #225
  - "[code://packages/agent-claude/src/session/disk.ts](../../../../packages/agent-claude/src/session/disk.ts) - `markdownUnder`, which keeps the real path of each folder it walked"
---

A symlink loop in `.claude/rules` no longer makes the daemon walk the same folders again and again. The walk keeps the real path of each folder it saw.

## What was built

- [`code://packages/agent-claude/src/session/disk.ts`](../../../../packages/agent-claude/src/session/disk.ts) - `markdownUnder` with a set of real paths for one walk.

## Verified

- The loop case in `disk.test.ts` fails in 0.3 s without the change.
- CI on main after #242 passed every check.

## Departures from the plan

- Without the change the loop case did not hang: `RULE_MOST` stopped the walk, and the case failed on duplicate rules.

## Left for later

- none
