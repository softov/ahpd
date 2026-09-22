---
title: A transcript that answered nothing is read again - implemented
date: 2026-09-22
refs:
  - code://packages/sdk/src/host.ts
  - code://packages/agent-claude/src/transcript.ts
  - code://test/host.test.ts
---

A catalogue session whose transcript answered no turns is read again the next time it is opened, instead of serving that empty answer until the daemon restarts, and a transcript read that threw is attempted once more before it is drawn as an empty session.
A transcript that does have turns is still read once, which is the large read the cache exists for.

## What was built

- `code://packages/sdk/src/host.ts` - `past` stores a read in `history` only when it has turns; the empty answer is still served, so a row the catalogue vouches for opens, but it is not remembered.
- `code://packages/agent-claude/src/transcript.ts` - `turnsOf` reads once more when the first `getSessionMessages` throws and answers `[]` only when the second fails too, so one transient failure is not what a client is shown.
- `code://test/host.test.ts` - the SDK mock gains `throwOnce`, reset with the rest of it, and two cases join `a session read from its transcript`: an empty read is repeated and a read with turns is kept, and a read that failed once still draws its turn.

## Verified

- `test/host.test.ts` - 282 tests, two new. With both source fixes reverted and the tests left in place, both new cases fail and the other 280 pass, so each pins the behaviour it names.
- `pnpm test` green: 63 files, 851 tests, the schema check included.
- `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.

## Departures from the plan

- None in behaviour. The retry is two nested `try` blocks inside `turnsOf` rather than an extracted helper, because the read is three lines and a helper would only be a second name for `getSessionMessages`.

## Left for later

- The by-hand case: the failure was not reproducible in this sandbox, so checking that a session which showed empty recovers on the next open was not run.
- The failure is still silent. Making it visible needs the transcript port to carry a reporter, which the risks section of [plan.md](plan.md) deliberately leaves out.
