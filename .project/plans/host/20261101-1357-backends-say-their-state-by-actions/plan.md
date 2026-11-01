---
title: Backends say their state by actions
domain: host
status: active
priority: high
created: 2026-11-01
revalidated: 2026-11-01
requires:
  - plans/host/20261101-0329-the-hosts-state-is-the-reducers-output/plan.md
refs:
  - git://c7899eff - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/actions.md#L3 - actions are the sole mutation mechanism for subscribable state"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L759-L767 - a chat's persisted history refreshed by `chat/truncated` and `chat/turnsLoaded`"
  - "[code://examples/echo/agent.ts](../../../../examples/echo/agent.ts) - the example backend, whose turn message left the attachments it was handed out"
  - "[code://packages/agent-cofold/src/runs.ts](../../../../packages/agent-cofold/src/runs.ts) - a paused run's replay, which took the seeded copy of its turn out of the backend's list alone"
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts) - the nested proxy, whose reopened inner session replaced the mirror with no action"
  - "[code://packages/agent-claude/src/session/turns.ts](../../../../packages/agent-claude/src/session/turns.ts) - the claude backend's turn message, which carries its attachments, the pattern the others follow"
---

## Goal

What a client sees of a chat is the host's held state.
So a backend that changes its own state says the change as an action.
A change kept in the backend alone reaches no client, since the backend's own state is read for a seed only.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "type: 'chat/turnStarted'" examples packages/*/src` - each backend's turn message, and which carry `attachments`.
- `rg -n "seed gives way" packages/agent-cofold/src` - the cofold replay that drops the seeded turn.
- `rg -n "mirror" packages/sdk/src/sessions/nested.ts` - where the proxy takes the inner host's state.

### Gaps

- The echo example's turn message leaves out the attachments it was handed, so a client reads the message without its picture.
- A cofold run resumed after a restart drops the seeded copy of its open turn from its own list, while every client keeps it.
- The nested proxy takes a reopened inner session's title and turns into its mirror and tells no client.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A backend's turn message carries the attachments it was handed, as the claude, pi and cofold backends do | [code://packages/agent-claude/src/session/turns.ts](../../../../packages/agent-claude/src/session/turns.ts); [actions.md#L3](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/actions.md#L3) | 01 |
| A cofold replay says the seeded copy of its open turn gone with `chat/truncated` back to the turn before it | [actions.md#L3](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/actions.md#L3); the chat reducer's `chat/truncated` | 02 |
| The nested proxy says a reopened inner session's title by `session/titleChanged` and its turns by `chat/truncated` and `chat/turnsLoaded` | [agentHostStateManager.ts#L759-L767](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L759-L767) | 03 |

## Proposed architecture

- **Data flow** - a backend's change goes out through its `emit`, and the host reduces it into the held state.
- **State flow** - a backend's `chatState()` and `sessionState()` are read for a seed only.
- **Source-of-truth files** - [`code://examples/echo/agent.ts`](../../../../examples/echo/agent.ts), [`code://packages/agent-cofold/src/runs.ts`](../../../../packages/agent-cofold/src/runs.ts), [`code://packages/sdk/src/sessions/nested.ts`](../../../../packages/sdk/src/sessions/nested.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the echo backend says a message's attachments](task-01-echo-says-a-messages-attachments.md) | todo | - |
| [02 - a cofold replay says its seed gave way](task-02-a-cofold-replay-says-its-seed-gave-way.md) | todo | - |
| [03 - the nested proxy says a reopened session](task-03-the-proxy-says-a-reopened-session.md) | todo | - |

## Risks and tradeoffs

- A backend change this plan does not name stays at its seed for every client, until its backend says it by its action.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-echo-says-a-messages-attachments.md](task-01-echo-says-a-messages-attachments.md).
- **Open questions:** none.
- **Watch out for:** a backend's state read after its own action names that change twice; say each change once.

## Final verification checklist

- [ ] Each backend's suite and the sdk suite pass with the change.
- [ ] Each case changed failed before its change, for the reason the change names.
