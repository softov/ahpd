---
title: A background task's end is a notice turn - implemented
date: 2026-11-04
refs:
  - git://86df87d3
  - git://976497fd
  - git://b1e39166
  - "[code://packages/agent-claude/src/session/parts.ts](../../../../packages/agent-claude/src/session/parts.ts) - the pending summary a turn opens with"
  - "[code://packages/agent-claude/src/transcript.ts](../../../../packages/agent-claude/src/transcript.ts) - the restored notice turn"
  - "[code://packages/sdk/src/host/localturns.ts](../../../../packages/sdk/src/host/localturns.ts) - the notice turn kept out of the fold"
---

The turn a background task's end starts in a Claude session is one notice turn, live and after a restart. Its message has origin `systemNotification` and the task's summary as its text, so ahpw draws it as one muted line, as it draws the end of ahpd's own async command.

## What was built

- [`code://packages/agent-claude/src/session/workers.ts`](../../../../packages/agent-claude/src/session/workers.ts) - the session context holds one `pendingSummary` beside `background`.
- [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts) - a terminal `task_notification` sets the pending summary only when no main-scope turn is open; one that arrives inside a turn sets nothing.
- [`code://packages/agent-claude/src/session/parts.ts`](../../../../packages/agent-claude/src/session/parts.ts) - `openTurn` gives a main-scope turn without an opening the pending summary as a `systemNotification` message, and clears it for every main-scope turn that opens. A turn with neither keeps the empty `agent` message.
- [`code://packages/agent-claude/src/transcript.ts`](../../../../packages/agent-claude/src/transcript.ts) - a user frame with `origin.kind` `task-notification` restores as a `systemNotification` turn whose text is the trimmed `<summary>`, or the whole text when the frame has none.
- [`code://packages/sdk/src/host/localturns.ts`](../../../../packages/sdk/src/host/localturns.ts) - `asBegun` keeps a turn whose message origin is `systemNotification` out of the join, as it keeps a local turn.

## Verified

- `pnpm build` passed.
- `pnpm typecheck` passed.
- `pnpm boundary` passed: 13 packages, none undeclared.
- The sdk suite passed: 225 files, 4213 tests passed, 4 skipped.
- The agent-claude suite passed: 57 files, 551 tests passed.
- `packages/agent-claude/test/agent-claude-background-work.test.ts`: 19 passed, including the notice turn and the notification that arrives inside one.
- `packages/agent-claude/test/agent-claude-transcript.test.ts`: 19 passed, including a notice frame with a `<summary>` and one without.
- `packages/sdk/test/host-local-turns.test.ts`: 29 passed, including a notice turn after a recorded turn.
- `packages/agent-claude/test/agent-claude-late-steer.test.ts`: 21 passed, replaying `claude-folded-steer.jsonl` whose `task_notification` arrives inside a running turn.
- Softov ran the notice turn check of `claude-1150-origin-and-notice-checks.md` on 2026-11-04, and it passed: the notice is one muted line, live and after a restart.

## Departures from the plan

- The pending summary starts as a plain field returned by `createWorkers` and is written on the context; nothing in `workers.ts` reads it after construction, so the first write on the context is the one that counts.
- A restored `<summary>` element that is empty after trimming falls back to the frame's whole text, as a frame without one does. The Answers table names only a frame without a `<summary>`, and the reason it gives is that a turn never opens on an empty message.

## Left for later

- none
