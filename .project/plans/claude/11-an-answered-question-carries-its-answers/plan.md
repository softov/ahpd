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
  - "[code://packages/agent-claude/src/session.ts#L1885-L1920](../../../../packages/agent-claude/src/session.ts#L1885-L1920) - AskUserQuestion becomes `chat/inputRequested`, questions keyed `q1`, `q2`"
  - "[code://packages/agent-claude/src/session.ts#L3560-L3588](../../../../packages/agent-claude/src/session.ts#L3560-L3588) - the answers settled as `updatedInput: { questions, answers }`, keyed by question text"
  - "[code://packages/agent-claude/src/input.ts](../../../../packages/agent-claude/src/input.ts) - `toolInputOf`"
  - "[code://packages/agent-claude/src/transcript.ts#L230-L350](../../../../packages/agent-claude/src/transcript.ts#L230-L350) - a replayed `tool_result`"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/claudeCanUseTool.ts#L278-L305 - VS Code hands the SDK `{ ...input, answers }`
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
| A completed AskUserQuestion's `toolInput` is the input the tool ran with: its questions plus `answers`, keyed by question text, a multi-select as an array, as the SDK is handed them | Softov, 2026-09-30, asked "Plan the answered-questions layout?": "claude/11 + ahpapp"; the shape is the SDK's and VS Code's `{ ...input, answers }` | 01, 02 |
| A replayed call takes the answers from the transcript's `toolUseResult.answers`; a call with none keeps its input as sent | (defaulted: the transcript is the only record after a restart) | 02 |
| A denied or cancelled question keeps its input as sent | (defaulted: nothing was answered) | 01 |
| [A restored AskUserQuestion is drawn as the answered question](../../../decisions/a-restored-question-is-drawn-answered.md): a restored turn carries the answered `inputRequest` part, built by the code the live question uses | Softov, 2026-09-30, asked "Should ahpd rebuild the answered question on restore?": "Rebuild it, in claude/11" | 03 |

## Proposed architecture

- **Data flow** - live: the settle at 3587 also sets the call's `toolInput` to `toolInputOf('AskUserQuestion', updatedInput)` and it reaches clients on the complete action; replay: `transcript.ts` merges `toolUseResult.answers` into the call's input.
- **Layer responsibilities** - agent-claude only.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts), [`code://packages/agent-claude/src/transcript.ts`](../../../../packages/agent-claude/src/transcript.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A live answered question carries its answers](task-01-a-live-answered-question-carries-its-answers.md) | todo | claude/08 |
| [02 - A replayed answered question carries its answers](task-02-a-replayed-answered-question-carries-its-answers.md) | todo | 01 |
| [03 - A restored question is drawn as the answered question](task-03-a-restored-question-is-drawn-answered.md) | todo | 02 |

## Risks and tradeoffs

- `toolInput` changes between the ready and the complete actions of one call; a client reads the latest, which the protocol's reducer keeps.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-a-live-answered-question-carries-its-answers.md](task-01-a-live-answered-question-carries-its-answers.md), after claude/08 is committed.
- **Open questions:** none.
- **Watch out for:** VS Code hides a completed AskUserQuestion row and draws only the `inputRequest` part, so tasks 01 and 02 alone change nothing in VS Code. ahpapp's chat/01 draws from this; keep the answer values as the SDK has them, strings and arrays of strings.

## Final verification checklist

- [ ] A live and a replayed answered AskUserQuestion carry the same `toolInput.answers` and the same answered `inputRequest` part.
- [ ] `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- [ ] `plans/index.md` updated.
