---
title: A pi session sends what the protocol declares - implemented
date: 2026-10-27
refs:
  - git://288ddab7
  - "[code://packages/agent-pi/src/mapping.ts](../../../../packages/agent-pi/src/mapping.ts)"
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts)"
---

A pi session's tool call parts have no `id`, and its snapshot holds the calls a client that watched built.
A completed call keeps its result's content, and a shell command keeps its line, its confirmation and its result.

## What was built

- [`code://packages/agent-pi/src/mapping.ts`](../../../../packages/agent-pi/src/mapping.ts) - `partOf` for a prose part, `callPartOf` for a call, and a call's end put onto the held call.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) and [`code://packages/agent-pi/src/replay.ts`](../../../../packages/agent-pi/src/replay.ts) - the lookups by the call's id, and the shell command's record.
- [`code://packages/agent-pi/test/agent-pi-declared.test.ts`](../../../../packages/agent-pi/test/agent-pi-declared.test.ts) - a call pi ran and a shell command, read through the host.

## Verified

- The case fails before this change with an assertion, and passes after it.
- The agent-pi suite passes 212 of 214, and the two others pass alone: they went past their budget under a parallel run.

## Departures from the plan

- none.

## Left for later

- none.
