---
title: An ACP command and terminal say what they are - implemented
date: 2026-10-27
refs:
  - git://856fd305
  - "[code://packages/agent-acp/src/session/queue.ts](../../../../packages/agent-acp/src/session/queue.ts)"
  - "[code://packages/agent-acp/src/mapping.ts](../../../../packages/agent-acp/src/mapping.ts)"
---

An ACP `!` call names its terminal as soon as it opens, and a server's terminal block says `isPty` as its handle does.

## What was built

- [`code://packages/agent-acp/src/session/queue.ts`](../../../../packages/agent-acp/src/session/queue.ts) - the `!` call's early content and its completion's block.
- [`code://packages/agent-acp/src/types.ts`](../../../../packages/agent-acp/src/types.ts) and [`code://packages/agent-acp/src/session/turn.ts`](../../../../packages/agent-acp/src/session/turn.ts) - `isPty` on the reach, answered from the session's handle.
- [`code://packages/agent-acp/src/mapping.ts`](../../../../packages/agent-acp/src/mapping.ts) - a server's terminal block asks the reach, and a replayed turn's says nothing.
- [`code://packages/agent-acp/test/agent-acp-ports.test.ts`](../../../../packages/agent-acp/test/agent-acp-ports.test.ts) - a server's terminal and a command under a pseudoterminal, through the host.

## Verified

- The case fails before this change with an assertion, and passes after it.
- The ports and turn suites pass, 64 of 64; a server's terminal on pipes still says `isPty: false`.

## Departures from the plan

- none.

## Left for later

- none.
