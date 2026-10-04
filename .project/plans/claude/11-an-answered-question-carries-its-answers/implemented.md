---
title: An answered AskUserQuestion call carries its answers, live and after a restart - implemented
---

## What exists

- An answered and allowed AskUserQuestion completes with `result.structuredContent` = `{ questions, answers }`, the object the SDK is handed back, answers keyed by question text and a multi-select as an array; a denied or cancelled one carries none, and `toolInput` stays the input as sent.
- A restored call whose transcript result has `toolUseResult.answers` carries the same object, built the same way whatever else its input held.
- A restored turn carries the answered `inputRequest` part, built by `questionRequest` and `questionAnswers` (`packages/agent-claude/src/input.ts`), the builder the live question uses.

## Verified

- `agent-claude-tool-input.test.ts`: live answered and unanswered, replayed answered and unanswered, a replayed input holding more than its questions, and the restored part matching the live part put through the protocol's reducer.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (176 files, 2707 tests) pass on main at `9a3127f`.

## Departures

- The replayed `structuredContent` is `{ questions, answers }` rather than the whole input with answers, so it is the same object the live call carries.
- Two questions with the same text share one answer key, as the SDK keys answers by text.
