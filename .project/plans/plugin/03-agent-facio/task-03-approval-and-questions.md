---
title: Approval and questions pause the run and are answered back into it
status: todo
depends:
  - task-02-a-turn-becomes-the-chat-actions.md
layer: packages/agent-facio
refs:
  - code://packages/sdk/src/types/session.ts#L322 - `confirm(toolCallId, approved)`, the answer to a tool confirmation
  - code://packages/sdk/src/types/session.ts#L369 - `answer(requestId, accepted, answers)`, the answer to a question
  - file:///github/facio/packages/agents/src/types/command.ts - `RunCommand`, the approve, deny, answer and steer a run accepts
  - file:///github/facio/packages/agents/src/types/event.ts - `approval.requested`, `input.requested`, `run.paused` and their resolutions
  - file:///github/facio/packages/agents/src/types/ask.ts - the questions and answers a request carries
  - file:///github/facio/packages/agents/src/types/agent.ts#L36-L51 - `Policy`, whose `ask` is what raises an approval
  - code://packages/agent-claude/src/session.ts#L1490-L1500 - the `toolConfirmation` entry a client already draws
  - code://packages/agent-claude/src/session.ts#L2691-L2725 - `confirm`, which finds the open call by id and settles it
---

## Objective

A facio run that pauses for an approval or a question becomes a `session/inputNeededSet` a client already knows, the client's `confirm` or `answer` reaches `RunHandle.submit`, the paused run continues, and nothing about the turn is reported as finished while it waits.

## Files

- `UPDATE: packages/agent-facio/src/session.ts` - the pending requests, `confirm`, `answer`, and the settlement.
- `UPDATE: packages/agent-facio/src/mapping.ts` - the four pause and resolution events.
- `CREATE: test/agent-facio-approval.test.ts` - the cases below.

## Steps

1. Track the open requests in the session by `requestId`, each with the kind, the call id when there is one, and the entry id a client was told, so two open requests are two rows and not one.
2. Map `approval.requested` to the tool-call action a client draws and a `session/inputNeededSet` whose entry is `kind: 'toolConfirmation'` with the call id, the tool name, the input, the status and the prompt, under an id derived from the request, matching the shape `agent-claude` already emits.
3. Map `input.requested` to a `session/inputNeededSet` whose entry is `kind: 'chatInput'` under the request, carrying the questions and their options, so the ask tool's questions reach the composer.
4. Wait here: a paused run emits nothing further, and `run.paused` is what says so, so a turn that pauses is not also reported complete.
5. Write `confirm(toolCallId, approved)`: find the open approval by call id, remove its entry with the removal action, emit the confirmed action with the call id and the decision, and `submit({ type: approved ? 'approve' : 'deny', requestId, ...(approved ? {} : { reason }) })`.
6. Write `answer(requestId, accepted, answers)`: find the open question, remove its entry, and `submit(accepted ? { type: 'answer', requestId, answers } : { type: 'deny', requestId })`, so a declined question is a decline and not an empty answer.
7. Map `approval.resolved`, `input.resolved`, `input.declined` and `run.resumed` to the removal of the entry and the continuation of the turn, and map the tool actions that follow, so an approved call is drawn as running and a denied one as cancelled with the reason.
8. Pass an AHP-aware policy into `createAgent` when the plugin's options ask for one, and carry `alwaysApprove` through when a client's answer means always: the default is facio's, which asks for a destructive tool and allows the rest, and this bridge does not invent a second default.
9. Do not lose a pause across a restart: the request is in the facio store through `requests.create`, so task 04's resume re-raises it rather than dropping it.

## Validation

- `test/agent-facio-approval.test.ts`, with a stub model that proposes a destructive tool and a store in memory:
  - a proposed tool that the policy asks about produces one `toolConfirmation` entry and the tool-call action, and no completion.
  - `confirm(callId, true)` submits an approve, the tool runs, the entry is removed, and the turn finishes.
  - `confirm(callId, false)` submits a deny, the tool result carries the reason, and the entry is removed.
  - two open approvals are each answered by their own call id, and answering one does not settle the other.
  - `input.requested` produces a `chatInput` entry, and `answer` submits the answers; a declined question submits a deny.
  - a run that pauses emits no `chat/turnComplete` until it is answered.
- `pnpm test` green, `pnpm typecheck` green.

## Resume

Empty until started.
