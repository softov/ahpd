---
title: An answer is held to the validation rows
domain: host
status: planned
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://cde4dd6c - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L356-L358 - the validation rows for an answer and a completion"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L583-L650 - the answer value kinds, `@nonexhaustive`, and each kind's payload"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L865-L895 - the reducer records the request's answers with the completion's laid over them"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1913-L1919 - the reference host hands a completion on unchecked"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L642-L692 - its client sends every answer as submitted"
  - "[code://packages/sdk/src/host/chatactions.ts#L1852-L1875](../../../../packages/sdk/src/host/chatactions.ts#L1852-L1875) - an acceptance's check, which takes a draft"
  - "[code://packages/sdk/src/host/chatactions.ts#L2085-L2106](../../../../packages/sdk/src/host/chatactions.ts#L2085-L2106) - an answer's check, which refuses a kind the protocol does not list"
  - "[code://packages/sdk/test/host-input-needed.test.ts#L117-L146](../../../../packages/sdk/test/host-input-needed.test.ts#L117-L146) - the cases of both checks"
---

## Goal

An acceptance is refused where a required question has no submitted answer: a draft and a skip are not one.
An answer of a kind the protocol does not list is taken.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "is required and has no answer" packages/sdk/src` - the acceptance's check refuses only an absent or skipped answer.
- `rg -n "has no .*value" packages/sdk/src/host/chatactions.ts` - the answer's check refuses any kind but the five.
- VS Code at `a4e689ae`: its host checks neither, and its client builds each answer as `ChatInputAnswerState.Submitted`.

### Runtime path

```
chat/inputCompleted accept -> chatactions.ts -> the request's answers and the completion's -> a required one not submitted is refused
chat/inputAnswerChanged -> chatactions.ts -> the value, held to its kind's payload where the kind is listed
```

### Gaps

- A required question answered only by a draft lets the acceptance through.
- An answer of a kind the protocol does not list is refused.

## Answers

| What | Source | Task |
| --- | --- | --- |
| No VS Code client can tell either check: its host hands a completion on unchecked, and its client sends each answer as submitted | [agentSideEffects.ts#L1913-L1919](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1913-L1919); [agentHostSessionHandler.ts#L642-L692](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L642-L692) | 01 |
| So the specification's text decides: "`response` is `'accept'` but required questions do not have submitted answers", Server SHOULD reject | [chat-channel.md#L358](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L358) | 01 |
| The answers checked are the request's synced ones with the completion's laid over them, `{ ...(part.request.answers ?? {}), ...(action.answers ?? {}) }`, and only a `submitted` one answers | [reducer.ts#L874](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L874); [state.ts#L638-L669](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L638-L669) | 01 |
| An answer is refused where "`answer.state` requires a value but `answer.value` is absent, or `answer.value.kind` is missing the matching payload field" | [chat-channel.md#L356](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L356) | 01 |
| The value kinds are `@nonexhaustive`, so a kind the protocol does not list names no payload to check, and is taken | [state.ts#L583-L595](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L583-L595) | 01 |

## Proposed architecture

- **State flow** - unchanged; the two checks run before an answer or a completion reaches the backend.
- **Layer responsibilities** - sdk: the `chat/inputCompleted` and `chat/inputAnswerChanged` cases.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The answers are held to the rows](task-01-the-answers-are-held-to-the-rows.md) | todo | - |

## Risks and tradeoffs

- A client that accepts with drafts and no submitted answers is refused, where a host that hands the answer on would take it.

## Resume state

- **Done so far:** nothing.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** a value naming no kind names no payload either, and is taken.

## Final verification checklist

- [ ] The new cases fail on `cde4dd6c` for the reasons they name, and pass after the change.
- [ ] The input-needed test file passes.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
