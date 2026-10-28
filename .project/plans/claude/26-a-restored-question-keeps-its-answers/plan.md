---
title: A restored question keeps its answers
domain: claude
status: built
priority: medium
created: 2026-10-27
revalidated: 2026-10-27
requires:
  - plans/claude/11-an-answered-question-carries-its-answers/plan.md
refs:
  - "[code://packages/agent-claude/src/transcript.ts#L287](../../../../packages/agent-claude/src/transcript.ts#L287) - the answers of a restored question, read from the `tool_result` block"
  - "[code://packages/agent-claude/src/transcript.ts#L47-L60](../../../../packages/agent-claude/src/transcript.ts#L47-L60) - `turnsOf`, which reads a session through the SDK's `getSessionMessages`"
  - "[code://packages/agent-claude/src/transcript.ts#L72-L94](../../../../packages/agent-claude/src/transcript.ts#L72-L94) - `sessionFiles` and `readJsonl`, which find and read the CLI's own files"
  - "[code://packages/agent-claude/src/transcript.ts#L166](../../../../packages/agent-claude/src/transcript.ts#L166) - the turns of a subagent, built from the entries of its own file"
  - "[code://packages/agent-claude/test/agent-claude-tool-input.test.ts#L592-L598](../../../../packages/agent-claude/test/agent-claude-tool-input.test.ts#L592-L598) - the restored cases, which put `toolUseResult` on the block"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.301 - `SessionMessage` has no field for the `toolUseResult` of an entry, and `getSessionMessages` does not copy it; 0.3.311 is the same
  - https://nodejs.org/api/readline.html#example-read-file-stream-line-by-line - how Node reads a file one line at a time
---

## Goal

A question that a person answered in a Claude session shows its answers after a restart, as it shows them live.
Today a restored question shows no answers, in the session and in the chat of a subagent that asked it.
With this plan, the restored call carries the questions and the answers, and the turn carries the answered request.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- Claude Code writes `toolUseResult` on the transcript entry that holds a `tool_result`, not on the block.
  In 7068 entries of real transcripts, no block holds it.
- In 6049 entries with a `tool_result`, none holds more than one, so the `toolUseResult` of an entry belongs to its one result.
- `getSessionMessages` of SDK 0.3.301 maps an entry to a `SessionMessage` with no `toolUseResult`, and SDK 0.3.311 does the same.
- The restored cases pass only because their fixture puts `toolUseResult` on the block, where the CLI never writes it.
- The file of a long session can be longer than the 536,870,888 characters that one string holds under Node 24.

### Runtime path

```
turnsOf -> getSessionMessages (no toolUseResult) -> buildTurns reads block.toolUseResult -> no answers
subagentsOf -> readJsonl (toolUseResult on the entry) -> buildTurns reads block.toolUseResult -> no answers
```

### Gaps

- `buildTurns` reads the answers from the block, and the CLI writes them on the entry.
- `getSessionMessages` gives no entry field for them, so the main session needs its own file.

## Answers

| What | Source | Task |
| --- | --- | --- |
| `buildTurns` reads the answers from the `toolUseResult` of the entry that holds the result. | Claude Code's transcripts, where the field is on the entry | 01 |
| `turnsOf` reads the file of the session for the entries whose `toolUseResult` has answers, and puts that field on the message with the same `uuid`. | The module reads the CLI's own files where the SDK's reader gives nothing, [code://packages/agent-claude/src/transcript.ts#L72-L94](../../../../packages/agent-claude/src/transcript.ts#L72-L94) | 01 |
| The file is read one line at a time with `node:readline`, and only a line that names `answers` is parsed. | https://nodejs.org/api/readline.html#example-read-file-stream-line-by-line, and the length limit of one string under Node | 01 |
| The file is read only when the messages hold the result of an `AskUserQuestion` call, and only as far as the last such entry. | (defaulted: a full read of a 128 MB file added about 0.8 s to its restore) | 01 |
| The fixture writes `toolUseResult` on the entry, and the mocked `getSessionMessages` leaves it out, as the SDK does. | The SDK's `SessionMessage` in npm://@anthropic-ai/claude-agent-sdk@0.3.301 | 01 |

## Proposed architecture

- **Data flow** - the answers come from the entry that holds the result, for the session and for a subagent.
- **Event flow** - no change.
- **State flow** - no change.
- **Layer responsibilities** - `@ahpd/agent-claude`: the transcript module reads the answers where the CLI writes them.
- **Source-of-truth files** - [`code://packages/agent-claude/src/transcript.ts`](../../../../packages/agent-claude/src/transcript.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The answers come from the entry](task-01-the-answers-come-from-the-entry.md) | done | - |

## Risks and tradeoffs

- A restore of a session with an answered question reads its file a second time, after the SDK.
  The read stops at the last such entry, and it took about 6 ms for each megabyte it read here.

## Resume state

- **Done so far:** planned and built 2026-10-27; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** a fixture must put `toolUseResult` where the CLI writes it, or the old code passes.

## Final verification checklist

- [x] The restored cases fail on the module before this change.
- [x] `pnpm boundary`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- [x] `plans/index.md` updated.
