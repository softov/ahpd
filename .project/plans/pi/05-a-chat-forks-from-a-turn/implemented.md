---
title: A pi chat forks from a turn - implemented
date: 2026-10-02
refs:
  - "[code://packages/agent-pi/src/backend.ts](../../../../packages/agent-pi/src/backend.ts)"
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts)"
  - "[code://packages/agent-pi/src/agent.ts](../../../../packages/agent-pi/src/agent.ts)"
---

A client can fork a pi chat from one of its turns: the fork is a new pi session holding the conversation through that turn, answer included, and the source file is left as it was.

## What was built

- [`code://packages/agent-pi/src/backend.ts`](../../../../packages/agent-pi/src/backend.ts) - `forkAt` replaces the `fork` flag; `resumeOrCreate` opens the source and calls `createBranchedSession(forkAt)`, and refuses a fork with no source or a source pi has no file for.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - `forkPoint` answers the leaf recorded when the turn settled; a fork with a rewind is refused before pi is opened.
- [`code://packages/agent-pi/src/agent.ts`](../../../../packages/agent-pi/src/agent.ts) - `chats: { fork: true }`.
- `packages/agent-pi/README.md` - forking moved from what pi does not offer to what it does.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm test` 151 files and 2199 tests, `pnpm boundary` clean.
- `packages/agent-pi/test/agent-pi-fork.test.ts`: a fork through the host opens under a new id at the turn's leaf; fork with rewind is refused and writes no file.
- `packages/agent-pi/test/agent-pi.test.ts`: a real `SessionManager` branch keeps the first turn and not the second, and the source is byte-identical after the fork is appended to.

## Departures from the plan

- A turn read back from pi's file answers the end the file records, so it can be forked like a watched one.

## Left for later

- none.
