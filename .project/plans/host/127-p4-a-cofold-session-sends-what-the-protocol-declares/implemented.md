---
title: A cofold session sends what the protocol declares - implemented
date: 2026-10-27
refs:
  - git://288ddab7
  - "[code://packages/agent-cofold/src/tools.ts](../../../../packages/agent-cofold/src/tools.ts)"
  - "[code://packages/agent-cofold/src/mapping.ts](../../../../packages/agent-cofold/src/mapping.ts)"
---

A cofold session's tool call parts and notices have no `id`, live and read back.
A decision finds its call by the call's own id.

## What was built

- [`code://packages/agent-cofold/src/tools.ts`](../../../../packages/agent-cofold/src/tools.ts), [`code://packages/agent-cofold/src/mapping.ts`](../../../../packages/agent-cofold/src/mapping.ts) and [`code://packages/agent-cofold/src/transcript.ts`](../../../../packages/agent-cofold/src/transcript.ts) - the parts and the notices have no `id`.
- [`code://packages/agent-cofold/src/pauses.ts`](../../../../packages/agent-cofold/src/pauses.ts) - a decision finds its call part by the call's `toolCallId`.
- [`code://packages/agent-cofold/test/agent-cofold-approval.test.ts`](../../../../packages/agent-cofold/test/agent-cofold-approval.test.ts) - two calls, read through the host.

## Verified

- The case and the compaction case fail before this change with an assertion, and pass after it.
- The agent-cofold and bot suites pass, 430 of 430.

## Departures from the plan

- none.

## Left for later

- none.
