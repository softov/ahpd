---
title: An AskUserQuestion shows each question's header, and an answer shows on every client at once with its typed text reaching the tool
domain: claude
status: planned
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/claude/11-an-answered-question-carries-its-answers/plan.md
refs:
  - "[code://packages/agent-claude/src/input.ts#L86-L117](../../../../packages/agent-claude/src/input.ts#L86-L117) - `questionRequest` builds each question without a `title`, and reads a top-level `input.header` that AskUserQuestion never has"
  - "[code://packages/agent-claude/src/session/asking.ts#L392-L443](../../../../packages/agent-claude/src/session/asking.ts#L392-L443) - `answer` reads each answer's `value` and drops its `freeformValues`"
  - "[code://packages/sdk/src/host/chatactions.ts#L936-L951](../../../../packages/sdk/src/host/chatactions.ts#L936-L951) - `chat/inputCompleted` on a lead chat calls `session.answer` and dispatches nothing back"
  - "[code://packages/sdk/src/host/chatactions.ts#L248-L255](../../../../packages/sdk/src/host/chatactions.ts#L248-L255) - `chat/draftChanged` is echoed so the other clients see it; the pattern task 01 mirrors"
  - "[code://packages/sdk/src/nested.ts#L907](../../../../packages/sdk/src/nested.ts#L907) - a worker chat does deliver `chat/inputCompleted`, so only the lead chat is missing it"
  - "[code://packages/agent-claude/test/agent-claude-tool-input.test.ts](../../../../packages/agent-claude/test/agent-claude-tool-input.test.ts) - where the question builder and the answer are tested"
  - "[code://packages/sdk/test/host-input.test.ts](../../../../packages/sdk/test/host-input.test.ts) - where a client's answer through the host is tested"
  - git://7516b04bc94 - VS Code `src/vs/platform/agentHost/node/claude/claudeInteractiveTools.ts` L105-L118 sets each question's `title` to its `header`, and L135-L153 joins a selection and its `freeformValues` into the answer the tool reads
  - git://7516b04bc94 - VS Code `src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts` L600-L645 sends typed text beside a choice as `freeformValues`, and typed text alone as a `text` answer
---

## Goal

A person answering an AskUserQuestion sees each question under its short header, sees the answer take effect the moment it is sent on every client watching the chat, and a choice with words of their own beside it reaches the agent whole.
Today the header is dropped, every request reads "The agent has a question", the answer shows on no client until the agent has moved on, and the words typed beside a choice are lost.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "header" packages/agent-claude/src/input.ts` - only the top-level `input.header` read at line 117.
- `rg "inputCompleted" packages/sdk/src packages/agent-claude/src` - the lead chat's case in `chatactions.ts` and the worker's `deliver` in `nested.ts`; nothing emits it for a lead chat.
- `rg "freeformValues" packages` - not read anywhere.

### Runtime path

```
client dispatches chat/inputCompleted -> host/chatactions.ts -> session.answer (agent-claude asking.ts)
  -> the SDK's canUseTool settles -> the tool call completes -> clients see the change only then
```

### Gaps

- No `title` on a question, though AskUserQuestion gives every question a `header`.
- `chat/inputCompleted` on a lead chat is not dispatched back, so no client's `chatReducer` records the response until the turn moves on, and the part's `response` is never set live.
- `freeformValues` on a `selected` or `selected-many` answer is dropped.

## Decisions locked in

No decision: every row below is a fix against the protocol or VS Code.

| What | Source | Task |
| --- | --- | --- |
| The host dispatches a lead chat's `chat/inputCompleted` back once the session has taken it, as it does `chat/draftChanged`. | Softov, 2026-10-06, answering "How should the ahpd side be handled (header to title, echoing chat/inputCompleted, reading freeformValues)?": "Plan for dsh"; found from ahpd-web, where Answer and Decline showed nothing until the agent moved on. | 01 |
| Each question's `title` is its `header`; the request's `message` stays the default line. | Same answer; VS Code `claudeInteractiveTools.ts` L110 and L118. | 02 |
| A selection's `freeformValues` are joined after its value with `, `, as VS Code does. | Same answer; VS Code `claudeInteractiveTools.ts` L135-L153. | 03 |

## Proposed architecture

- **Data flow** - a question goes out with `title` per question; an answer comes in, reaches `session.answer`, and is dispatched to every client of the chat.
- **Event flow** - `chat/inputCompleted` from a client -> `session.answer` -> `dispatch(channel, action, origin)`.
- **State flow** - every client's `chatReducer` sets the `inputRequest` part's `response` and answers from the echo; `session/inputNeededRemoved` still comes from `asking.ts`.
- **Layer responsibilities** - sdk: echo the action · agent-claude: build the question with its title, and read the whole answer.
- **Source-of-truth files** - [`code://packages/agent-claude/src/input.ts`](../../../../packages/agent-claude/src/input.ts), [`code://packages/agent-claude/src/session/asking.ts`](../../../../packages/agent-claude/src/session/asking.ts), [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - an answer is dispatched back to the chat](task-01-an-answer-is-dispatched-back.md) | todo | - |
| [02 - each question carries its header as its title](task-02-each-question-carries-its-header.md) | todo | - |
| [03 - text typed beside a choice reaches the tool](task-03-text-beside-a-choice-reaches-the-tool.md) | todo | - |

## Risks and tradeoffs

- An answer to a request the session is not waiting on would be echoed as a no-op - `chatReducer` ignores a request id it does not hold, so task 01 echoes only when `session.answer` took it, or states why echoing anyway is harmless.
- A worker chat already delivers `chat/inputCompleted` from `nested.ts`; task 01 must not make it arrive twice there.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-an-answer-is-dispatched-back.md](task-01-an-answer-is-dispatched-back.md).
- **Open questions:** none.
- **Watch out for:** `questionAnswers` in `input.ts` keys restored answers by the question's text; adding `title` must not change ids or that key.

## Final verification checklist

- [ ] A client sees `response` on the `inputRequest` part right after another client answers, with no tool call completed yet.
- [ ] A question built from an AskUserQuestion input has `title` equal to its `header`.
- [ ] An answer `{ kind: 'selected', value: 'Blue', freeformValues: ['teal'] }` reaches the tool as `Blue, teal`.
- [ ] `pnpm test` passes in `packages/sdk` and `packages/agent-claude`.
- [ ] `plans/index.md` updated.
