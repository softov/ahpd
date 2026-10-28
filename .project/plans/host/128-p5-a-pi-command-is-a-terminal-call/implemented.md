---
title: A pi command is a terminal call - implemented
date: 2026-10-27
refs:
  - git://856fd305
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts)"
---

A pi `!` call is a `terminal` call shown as `Terminal`, and it names its terminal as soon as it opens.
It completes with the terminal block and then the output.

## What was built

- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - the call's start and ready, the early content and the completion's content.
- [`code://packages/agent-pi/test/agent-pi-declared.test.ts`](../../../../packages/agent-pi/test/agent-pi-declared.test.ts) - a command under a pseudoterminal, read by a watching client and by two late ones.

## Verified

- The case fails before this change with an assertion, and passes after it.
- The pi declared, mapping and main suites pass, 83 of 83.

## Departures from the plan

- none.

## Left for later

- none.
