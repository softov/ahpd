---
title: A Claude command shows its terminal - implemented
date: 2026-10-27
refs:
  - git://856fd305
  - "[code://packages/agent-claude/src/session/turns.ts](../../../../packages/agent-claude/src/session/turns.ts)"
---

A Claude `!` call names its terminal as soon as it opens, and its terminal block says `isPty` as the terminal does.

## What was built

- [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts) - `terminalOf`, the early content onto the call and into `chat/toolCallContentChanged`, and the completion's block.
- [`code://packages/sdk/test/host-terminals.test.ts`](../../../../packages/sdk/test/host-terminals.test.ts) - a command under a pseudoterminal, read by a watching client and by two late ones.

## Verified

- The case fails before this change with an assertion, and passes after it.
- The host terminal suite passes, 28 of 28.

## Departures from the plan

- none.

## Left for later

- none.
