---
title: An answered AskUserQuestion call carries its answers, live and after a restart
domain: claude
status: planned
priority: medium
created: 2026-09-30
revalidated: 2026-09-30
requires:
  - plans/claude/08-tool-input-is-the-whole-input/plan.md
refs:
  - "[code://packages/agent-claude/src/session.ts#L2052-L2086](../../../../packages/agent-claude/src/session.ts#L2052-L2086) - AskUserQuestion becomes `chat/inputRequested`, questions keyed `q1`, `q2`"
  - "[code://packages/agent-claude/src/session.ts#L3744-L3787](../../../../packages/agent-claude/src/session.ts#L3744-L3787) - the answers settled as `updatedInput: { questions, answers }`, keyed by question text"
  - "[code://packages/agent-claude/src/input.ts](../../../../packages/agent-claude/src/input.ts) - `toolInputOf`"
  - "[code://packages/agent-claude/src/transcript.ts#L230-L350](../../../../packages/agent-claude/src/transcript.ts#L230-L350) - a replayed `tool_result`"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/claudeCanUseTool.ts#L278-L305 - VS Code hands the SDK `{ ...input, answers }`
  - npm://@microsoft/agent-host-protocol@0.9.0 - `ChatToolCallCompleteAction` (`src/types/channels-chat/actions.ts#L336-L342`) carries only `result` and `requiresResultConfirmation` beside the base's `turnId`, `toolCallId` and `_meta`, so it cannot carry a new `toolInput`; `ToolCallResult.structuredContent` is a free record
---

## Goal

A client draws an answered AskUserQuestion as its questions and the answers given, from the call itself, the same live and after a restart, without parsing the result's sentence.

## Reconnaissance

The files read are the `refs` above.

### Searches performed

- `~/.claude/projects/-github-s2cmd/4d9edeb1-….jsonl` - the transcript's `tool_result` entry carries `toolUseResult: { questions, answers }`, answers keyed by question text, a multi-select as an array.

### Gaps

- The completed call's `toolInput` is the input the model sent, without the answers the tool ran with.
- The answers reach a client only as the result's text, `"Q"="A"`.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| A completed AskUserQuestion carries the input the tool ran with: its questions plus `answers`, keyed by question text, a multi-select as an array, as the SDK is handed them | Softov, 2026-09-30, asked "Plan the answered-questions layout?": "claude/11 + ahpapp"; the shape is the SDK's and VS Code's `{ ...input, answers }` | 01, 02 |
| The answered input `{ ...input, answers }` travels as the completed call's `result.structuredContent`, the protocol's own structured result; `toolInput` stays the input as sent | Softov, 2026-10-03, asked "claude/11: where do an answered AskUserQuestion's answers travel on the completed tool call (live and after a restart)?": "result.structuredContent" | 01, 02 |
| A replayed call takes the answers from the transcript's `toolUseResult.answers`; a call with none keeps its input as sent | (defaulted: the transcript is the only record after a restart) | 02 |
| A denied or cancelled question keeps its input as sent | (defaulted: nothing was answered) | 01 |
| [A restored AskUserQuestion is drawn as the answered question](../../../decisions/a-restored-question-is-drawn-answered.md): a restored turn carries the answered `inputRequest` part, built by the code the live question uses | Softov, 2026-09-30, asked "Should ahpd rebuild the answered question on restore?": "Rebuild it, in claude/11" | 03 |

## Proposed architecture

- **Data flow** - live: the settle at 3786 builds `{ ...input, answers }` and it reaches clients as the complete action's `result.structuredContent`; replay: `transcript.ts` reads `toolUseResult.answers` and puts them in the replayed call's `result.structuredContent`.
- **Layer responsibilities** - agent-claude only.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts), [`code://packages/agent-claude/src/transcript.ts`](../../../../packages/agent-claude/src/transcript.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A live answered question carries its answers](task-01-a-live-answered-question-carries-its-answers.md) | todo | claude/08 |
| [02 - A replayed answered question carries its answers](task-02-a-replayed-answered-question-carries-its-answers.md) | todo | 01 |
| [03 - A restored question is drawn as the answered question](task-03-a-restored-question-is-drawn-answered.md) | todo | 02 |

## Risks and tradeoffs

- The protocol's complete action has no `toolInput`, so the input sent on the ready action stays the call's `toolInput`; the answers travel in `result.structuredContent` (still so in 1.0.0).

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-live-answered-question-carries-its-answers.md](task-01-a-live-answered-question-carries-its-answers.md); claude/08 is committed (fd3295b).
- **Open questions:** none.
- **Watch out for:** VS Code hides a completed AskUserQuestion row and draws only the `inputRequest` part, so tasks 01 and 02 alone change nothing in VS Code. ahpapp's chat/01 draws from this; keep the answer values as the SDK has them, strings and arrays of strings.

## Final verification checklist

- [ ] A live and a replayed answered AskUserQuestion carry the same answers, in the place the open question settles, and the same answered `inputRequest` part.
- [ ] `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- [ ] `plans/index.md` updated.
