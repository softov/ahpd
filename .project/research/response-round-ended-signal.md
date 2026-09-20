---
title: Does the Claude stream report a round that ends with no text and no tool calls
date: 2026-09-19
refs:
  - code://packages/agent-claude/src/session.ts - where a turn's SDK events become chat actions
  - code://packages/agent-claude/src/kinds.ts - the one place an SDK event is already mapped to a well-known key
  - src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L5223-L5241 - the Copilot signal the reference emits from, inside the clone
---

## Question

The reference host answers `responseRoundEnded` when a model response round ends with neither text nor tool calls, and its client settles an open thinking section on it.
Does the Claude Agent SDK expose an equivalent event, and at which point in `packages/agent-claude/src/session.ts` would it be seen?

## Why it matters

`packages/sdk/src/types/` has no way to say "the round ended empty", so a host that cannot see the event cannot emit the notification, and a client that reads it keeps an open reasoning section on a turn that produced nothing.
The pass that raised this is `.project/review/2026-09-19-upstream-pass-4.md`, where the item is Taken only if this question has an answer.

## Method

1. Read the SDK's event surface for a turn-complete or assistant-message event that can carry no content and no tool blocks.
2. Drive one session through the daemon with a prompt that produces an empty round, and capture it with `ahpd --wire <file>`.
3. Compare the captured frames with what the reference emits at `copilotAgentSession.ts:5241`.

## Answer

Empty until the investigation is run.
A "no such event" answer is a result too: the item then leaves the review's Taken list and the client gap is recorded rather than fixed.
