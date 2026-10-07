---
title: A running Claude turn is lost while the CLI keeps working
status: open
date: 2026-10-07
severity: major
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L346](../../packages/agent-claude/src/session/query.ts#L346) - `consume`, which reads the CLI's messages into turns"
---

On 2026-10-07 a prompt sent to session `f0c62ad5` at 20:11 UTC was missing from the session's history: no user row and no turn.
The CLI's own transcript shows the CLI working on that prompt without a break until 20:43, with auto-compactions at 20:13, 20:19, 20:26 and 20:35.
The `ahpc prompt` client that sent it exited at 20:26 with no end line, and a client showed the session as stopped.
A slash command sent next became a new turn, and the remaining output of the lost turn was drawn under it.
The daemon did not restart.
Cause unknown; the 20:26 compaction is a guess. Softov could not reproduce it.
