---
title: Does the Claude stream report a round that ends with no text and no tool calls
date: 2026-09-19
refs:
  - code://packages/agent-claude/src/session.ts#L1839-L2011 - the message loop where a turn's SDK events become chat actions
  - code://packages/agent-claude/src/session.ts#L1027-L1137 - `streamed()`, where `message_start`, the content blocks and the transport's `message_stop` arrive
  - code://packages/agent-claude/src/kinds.ts - the one place an SDK event is already mapped to a well-known key
  - npm://@anthropic-ai/claude-agent-sdk@0.3.278 - `SDKMessage`, whose union has no round or empty-answer member
  - npm://@anthropic-ai/sdk@0.124.0 - `BetaRawMessageStreamEvent`, whose `message_stop` is a content-blind end of one API message
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L5223-L5241 - the Copilot signal the reference emits from, which keys on a `phase`, inside the clone
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L730-L731 - the reference Claude mapper returning nothing for `message_stop`, inside the clone
---

## Question

The reference host answers `responseRoundEnded` when a model response round ends with neither text nor tool calls, and its client settles an open thinking section on it.
Does the Claude Agent SDK expose an equivalent event, and at which point in `packages/agent-claude/src/session.ts` would it be seen?

## Why it matters

`packages/sdk/src/types/` has no way to say "the round ended empty", so a host that cannot see the event cannot emit the notification, and a client that reads it keeps an open reasoning section on a turn that produced nothing.
The pass that raised this is `.project/review/2026-09-19-upstream-pass-4.md`, where the item is Taken only if this question has an answer.

## Method

1. Read the installed SDK's event surface for a turn-complete or assistant-message event that can carry no content and no tool blocks.
2. Read the reference's Claude stream mapper for what it does with the same frames, and the Copilot emission it does not reproduce.
3. Probe the installed CLI with partial messages on, to see the frames one real round produces and in which order.
4. Compare the captured frames with what the reference emits at `copilotAgentSession.ts:5241`.

## Answer

No.
`@anthropic-ai/claude-agent-sdk@0.3.278` exposes no event that marks a model response round which ended with neither text nor tool calls, so task 01 is dropped and the client gap is recorded in [deferred.md](../plans/claude/02-round-ended/deferred.md) rather than faked.

### Why the event surface has nothing

- The `SDKMessage` union carries no round, response or empty-answer member (`sdk.d.ts:5025`).
- `SDKAssistantMessage` is emitted once per completed content block (`sdk.d.ts:3402-3405`), so a round that produced nothing produces no assistant frame at all; the `content: []` on `message_start` is the transport's placeholder and not a report about the round.
- `SDKResultMessage` closes the whole turn and not one round (`sdk.d.ts:5416-5481`), and the plan forbids it.
- `SDKStatusMessage` carries only `compacting` or `requesting` (`sdk.d.ts:5563-5575`).
- `SDKSessionStateChangedMessage` is session level, `idle`, `running` or `requires_action` (`sdk.d.ts:5532-5538`).
- No member has a `phase`, `final_answer` or `isLastMessageChunk` field, which is what the Copilot reference keys the notification on.
- The only per-round boundary in the stream is `message_stop`, the raw API event `{ type: 'message_stop' }` (`@anthropic-ai/sdk` 0.124.0, `messages.d.ts:3097-3100`); it is emitted for every round, carries no content or tool information, and so is not a signal that a round ended empty.
- The reference's own Claude mapper returns nothing for `message_stop` (`claudeMapSessionEvents.ts:730-731`), and its `responseRoundEnded` exists only on the Copilot path.

### Evidence from the live probe

- Ran `claude -p "Reply with exactly: ok" --output-format stream-json --include-partial-messages --verbose` against the installed CLI at `/home/softov/.local/bin/claude` (2.1.267).
- The frame order was `message_start` -> `content_block_start` -> `content_block_delta` -> `assistant` -> `content_block_stop` -> `message_delta` (stop_reason `end_turn`) -> `message_stop` -> `result`.
- `message_start` carried `"content":[]`, so a round that produced nothing would leave only `message_start`, `message_delta` and `message_stop`, a boundary that carries no content and no way to say the round was empty.
- The SDK is 0.3.278 and its bundled CLI identifies as 2.1.278; the probe used the system 2.1.267, and the frame vocabulary listed in `BetaRawMessageStreamEvent` is the same in both.

### What a client loses

A turn whose model round ends with neither text nor tool calls is not announced, so the reference client keeps its open reasoning section until the next part or the turn's `result` arrives.
When the empty round is followed by another round, the client draws the two thinking sections as one.
If the turn produces nothing else, the section stays open until the turn ends.
