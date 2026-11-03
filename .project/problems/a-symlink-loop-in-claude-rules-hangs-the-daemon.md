---
title: A symlink loop in .claude/rules hangs the daemon
status: open
date: 2026-11-03
severity: major
blocks: []
refs:
  - "[code://packages/agent-claude/src/session/disk.ts#L201-L214](../../packages/agent-claude/src/session/disk.ts#L201-L214) - `markdownUnder` follows a symlinked folder and keeps no visited set"
  - "[code://packages/agent-claude/src/session/disk.ts#L49-L52](../../packages/agent-claude/src/session/disk.ts#L49-L52) - `RULE_DEPTH` is 32, and `RULE_MOST` counts only `.md` files"
  - git://23430fa7 - claude/20261031-0228 added the rules walk
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
A repository's `.claude/rules` holds two symlinks to `.` and no `.md` file.
A Claude session opens in it, and the daemon stops answering.

## Cause

`markdownUnder` uses `statSync`, which follows links, and goes into each folder.
Two links to the same folder double the walk at each level, up to depth 32.
That is about 2^33 synchronous `readdir` calls on the daemon's thread.

## Impact

Any repository a user opens can stop the whole daemon for every user.

## Workaround

None.

## Fix

- Skip symlinked folders with `lstatSync`.
- Or keep the real path of each folder walked, and skip one seen before.
- Or cap the number of folders walked, not only the `.md` files found.
