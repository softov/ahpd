---
title: "A replayed Claude exchange is one turn, as it was live - implemented"
date: 2026-09-28
refs:
  - git://373253e
  - "[code://packages/agent-claude/src/transcript.ts](../../../../packages/agent-claude/src/transcript.ts) - `buildTurns`, `isCliEcho`"
---

A Claude session read back after a restart shows each prompt and everything done for it as one turn, as it looked live, with its usage counted once per message.

## What was built

- [`code://packages/agent-claude/src/transcript.ts`](../../../../packages/agent-claude/src/transcript.ts) - `buildTurns` appends every assistant round to the current turn and sums usage per `message.id`; a CLI echo or a compact summary opens no turn.

## Verified

- `agent-claude-transcript.test.ts` (new, 10 cases) and `agent-claude-subagent-restore.test.ts`; the new cases failed first with 2 to 6 turns where 1 was expected.
- `pnpm typecheck`, `pnpm boundary` clean; full `pnpm test` 1539 of 1539.

## Departures from the plan

- none.

## Left for later

- By hand: a restored session in ahpapp.
