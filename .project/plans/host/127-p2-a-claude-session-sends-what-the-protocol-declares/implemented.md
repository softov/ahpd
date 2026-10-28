---
title: A Claude session sends what the protocol declares - implemented
date: 2026-10-27
refs:
  - git://288ddab7
  - "[code://packages/agent-claude/src/session/stream.ts](../../../../packages/agent-claude/src/session/stream.ts)"
  - "[code://packages/sdk/test/wire.test.ts](../../../../packages/sdk/test/wire.test.ts)"
---

Every tool call part of a Claude session is its kind and its call, live, asked about first, from a shell command and read back.
A compaction notice is its kind and its content.
The wire suite reads the chat after its turn, so the strict schema reads the parts a late client reads.

## What was built

- [`code://packages/agent-claude/src/session/stream.ts`](../../../../packages/agent-claude/src/session/stream.ts), `asking.ts`, `turns.ts` and [`code://packages/agent-claude/src/transcript.ts`](../../../../packages/agent-claude/src/transcript.ts) - the five tool call parts have no `id`.
- [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts) - the compaction notice has no `id`.
- [`code://packages/sdk/test/wire.test.ts`](../../../../packages/sdk/test/wire.test.ts) - the chat asked for again after the turn, and `toolKind` on the call in the `_meta` census.
- [`code://packages/sdk/test/host-turn.test.ts`](../../../../packages/sdk/test/host-turn.test.ts) - a case through the host, and the compaction case reads its frames with the schema.

## Verified

- The tool input case, the host case, the compaction case and the wire case fail before this change with an assertion.
- The wire suite finds the `id` and nothing else, and its census finds `toolKind` on the call, which `docs/sdk/AHP.md` documents.

## Departures from the plan

- none.

## Left for later

- none.
