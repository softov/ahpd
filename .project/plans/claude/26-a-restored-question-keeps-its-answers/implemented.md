---
title: A restored question keeps its answers - implemented
date: 2026-10-27
refs:
  - git://b7d1f99c
  - "[code://packages/agent-claude/src/transcript.ts#L48-L124](../../../../packages/agent-claude/src/transcript.ts#L48-L124)"
  - "[code://packages/agent-claude/test/agent-claude-tool-input.test.ts](../../../../packages/agent-claude/test/agent-claude-tool-input.test.ts)"
  - "[code://packages/agent-claude/test/agent-claude-subagent-restore.test.ts](../../../../packages/agent-claude/test/agent-claude-subagent-restore.test.ts)"
---

An answered question in a Claude session reads back answered after a restart, in the session and in the chat of a subagent.
The restored call carries the questions and the answers, and its turn carries the answered request, as the live call does.

## What was built

- [`code://packages/agent-claude/src/transcript.ts#L48-L66`](../../../../packages/agent-claude/src/transcript.ts#L48-L66) - `turnsOf` puts the answered `toolUseResult` of an entry on the message with its `uuid`.
- [`code://packages/agent-claude/src/transcript.ts#L68-L124`](../../../../packages/agent-claude/src/transcript.ts#L68-L124) - `askedIn` finds the entries with the result of a question.
  `answeredIn` reads the file of the session as far as the last of them.
- [`code://packages/agent-claude/src/transcript.ts#L352`](../../../../packages/agent-claude/src/transcript.ts#L352) - `buildTurns` reads the answers from the entry.
- [`code://packages/agent-claude/README.md#L188`](../../../../packages/agent-claude/README.md#L188) - "What it does" says where a restored question finds its answers.

## Verified

- `agent-claude-tool-input.test.ts`, 36 of 36, and `agent-claude-subagent-restore.test.ts`, with the case for a subagent's question; the five restored cases fail before this change.
- A real Claude Code transcript of 2.3 MB, through SDK 0.3.301, restores 3 questions.
  Before this change none has answers, and after it all 3 have their answers and their requests.
- A real transcript of 128 MB with no question restores in about 0.7 to 0.9 s before and after.
- `pnpm boundary`, `pnpm typecheck` and `pnpm build` pass.
- The agent-claude, conformance and wire suites pass 408 of 409 in one run, and the wire suite alone passes 17 of 17.
  The other case starts a process, and it went past its 5 s budget under the load of a parallel run.

## Departures from the plan

- The file is read only when the messages hold the result of a question, and only as far as the last such entry.
  A full read of a 128 MB file added about 0.8 s to each restore.

## Left for later

- none.
