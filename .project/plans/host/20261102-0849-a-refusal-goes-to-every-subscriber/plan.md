---
title: A refusal goes to every subscriber
domain: host
status: built
priority: high
created: 2026-11-02
revalidated: 2026-11-02
requires:
  - plans/host/20261102-0606-every-accepted-action-goes-to-every-subscriber/plan.md
refs:
  - git://839080c4 - the commit this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/subscriptions.md#L140-L143 - an action goes to all clients subscribed to its channel"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/lifecycle.md#L109 - a reconnect replays the envelopes a client missed"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/session-channel.md#L162 - an invalid action is echoed back with a `rejectionReason`"
  - "https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/platform/agentHost/node/protocolServerHandler.ts#L766 - the reference host records and broadcasts a rejection as it does an action"
  - "https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4183-L4210 - the replay buffer and the broadcast to every relevant client"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `refuse` and `emit`"
  - "[code://docs/sdk/AHP.md](../../../../docs/sdk/AHP.md) - the section on a refusal"
---

## Goal

A refusal is an action envelope like any other.
It takes the next `serverSeq`, is held for replay, and goes to every client subscribed to its channel.
The client that sent the action is told even where it watches no such channel.
No state takes a refusal.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "const refuse" packages/sdk/src/host.ts` - a refusal goes to its sender alone and is not held for replay.
- `rg -n "sender alone|not buffered" docs/sdk/AHP.md` - two passages say the same.

### Runtime path

```
client A dispatchAction -> refuse -> A alone; client B on the channel hears nothing
client A reconnects -> the refusal is not in the replay
```

### Gaps

- A second subscriber does not hear a refusal on its channel.
- A reconnect does not replay a refusal.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A refusal goes to every subscriber of its channel, sequenced and held for replay | subscriptions.md L140-L143; lifecycle.md L109; VS Code protocolServerHandler.ts L766, L4183-L4210 | 01 |
| The sender hears it where it watches no such channel | session-channel.md L162 | 01 |
| No state takes a refusal | VS Code agentHostStateManager.ts L2754-L2775 runs no reducer on one | 01 |

## Proposed architecture

- **Data flow** - `refuse` sends through `emit` with the reason; `emit` skips the reducers and the observers for a refusal.
- **Layer responsibilities** - sdk host: `host.ts`.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a refusal goes to every subscriber](task-01-a-refusal-goes-to-every-subscriber.md) | done | - |

## Risks and tradeoffs

- This replaces the refusal row of plan 0606, which kept a refusal with its sender, unbuffered.

## Resume state

- **Done so far:** task 01, 2026-11-02; [implemented.md](implemented.md) says what was verified.
- **Next action:** none in this plan.
- **Open questions:** none.
- **Watch out for:** a refusal held for replay must not reach a channel's state.

## Final verification checklist

- [x] The new case fails on 839080c4 and passes after the change.
- [x] `pnpm run typecheck` reports no errors.
