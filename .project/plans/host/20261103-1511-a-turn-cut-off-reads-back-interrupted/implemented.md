---
title: A turn cut off reads back interrupted - implemented
date: 2026-11-03
refs:
  - git://bbe2fc07 - the change
  - "[code://packages/agent-pi/src/replay.ts](../../../../packages/agent-pi/src/replay.ts)"
  - "[code://packages/agent-acp/src/transcript.ts](../../../../packages/agent-acp/src/transcript.ts)"
---

A pi file or an ACP replay that ends while its last turn's request still ran reads that turn back in error.
Its last part is VS Code's `executionInterrupted` error, after the parts the transcript made, a call still open cancelled as skipped.
pi marks the error resumable, and a resume asks the model again from where the file ends.
ACP's error is not resumable, since ahpd resumes no ACP turn.
Claude's reader stays as VS Code's Claude reader reads.

## What was built

- [`code://packages/agent-pi/src/replay.ts`](../../../../packages/agent-pi/src/replay.ts) - the last turn read back interrupted when its last answer asked for tools or it has none.
- [`code://packages/agent-pi/src/backend.ts`](../../../../packages/agent-pi/src/backend.ts) - `resumePoint` in the place of `failedReply`, and `resume` from a cut-off request too.
  `resumePoint` keeps the case of a reply an earlier resume dropped.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - the words of a resume with nothing to continue from.
- [`code://packages/agent-acp/src/transcript.ts`](../../../../packages/agent-acp/src/transcript.ts), [`code://packages/agent-acp/src/types.ts`](../../../../packages/agent-acp/src/types.ts) - `WatchedTurn.interrupted` on the last replayed turn, and its part in `turnsOf`.
- [`code://packages/agent-pi/test/agent-pi-disk.test.ts`](../../../../packages/agent-pi/test/agent-pi-disk.test.ts), [`code://packages/agent-acp/test/agent-acp-catalog.test.ts`](../../../../packages/agent-acp/test/agent-acp-catalog.test.ts) - the cases.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the `chat/turnResume` row.

## Verified

- On `fa9afa9a`'s sources six new cases fail: three pi files cut off, `resumePoint`, and two ACP replays cut off.
- The case of a reply an earlier resume dropped, which now reads `resumePoint`, fails there too.
- Two cases pass on those sources and after: an earlier pi turn cut off, and an answered ACP turn.
- With the change, the pi disk and ACP catalogue test files pass, one file at a time.
- `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.

## Departures from the plan

- None.
