---
title: A fork copies the conversation through the chosen turn - implemented
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/types/session.ts](../../../../packages/sdk/src/types/session.ts)"
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts)"
  - "[code://packages/agent-cofold/src/session.ts](../../../../packages/agent-cofold/src/session.ts)"
---

A fork now continues with the chosen turn whole, its answer included, on Claude and cofold, so the model in the new chat has seen the answer the person sees there.

## What was built

- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - `forkPoint` names the last entry a turn left behind; `endPoint` stays beside it.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - the fork path's comment; the path itself was already right.
- [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - `forkPoint` answers from `ends`; `cuts` became the `reported` set, because `onTurnRecorded` still needs to fire once per turn.
- [`code://packages/agent-cofold/src/session.ts`](../../../../packages/agent-cofold/src/session.ts) - one id per turn, the run's `lastMessageId`, answers both cuts.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm test` 151 files and 2199 tests, `pnpm boundary` clean.
- `packages/sdk/test/host.test.ts`: a Claude fork resumes at the chosen turn's answer.
- `packages/agent-cofold/test/agent-cofold-fork.test.ts`: the fork holds the chosen turn's question and answer and nothing after.

## Departures from the plan

- `cuts` was kept as a set rather than deleted, since the turn-recorded callback reads it.

## Left for later

- The ACP bridge's fork in `plugin/18` must name the turn's end under this contract when it is built.
