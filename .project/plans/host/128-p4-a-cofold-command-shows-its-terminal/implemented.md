---
title: A cofold command shows its terminal - implemented
date: 2026-10-27
refs:
  - git://856fd305
  - "[code://packages/agent-cofold/src/turns.ts](../../../../packages/agent-cofold/src/turns.ts)"
---

A cofold `!` call is the reference's terminal call, held as a watching client holds it.
It names its terminal as soon as the terminal opens.

## What was built

- [`code://packages/agent-cofold/src/turns.ts`](../../../../packages/agent-cofold/src/turns.ts) - the command as the intention, the ready onto the held call, the early content and the completion's block.
- [`code://packages/agent-cofold/test/agent-cofold-turn.test.ts`](../../../../packages/agent-cofold/test/agent-cofold-turn.test.ts) - a command under a pseudoterminal, read by a watching client and by two late ones.

## Verified

- The case fails before this change with an assertion, and passes after it.
- The cofold turn suite passes, 28 of 28.

## Departures from the plan

- The case is in the turn suite, beside the other `!` command case, and not in the approval suite.

## Left for later

- none.
