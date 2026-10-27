---
title: The host describes every agent
domain: host
status: built
priority: high
created: 2026-10-27
revalidated: 2026-10-27
requires:
  - plans/host/127-every-agent-sends-what-the-protocol-declares/plan.md
refs:
  - "[code://packages/sdk/src/host/root.ts#L158-L168](../../../../packages/sdk/src/host/root.ts#L158-L168) - `descriptors`, which sends a `description` only when the backend says one"
  - "[code://packages/sdk/src/types/agent.ts#L599](../../../../packages/sdk/src/types/agent.ts#L599) - `description`, which a backend may leave out"
  - npm://@microsoft/agent-host-protocol@1.0.0 - `AgentInfo.description`, which is required
---

## Goal

The root channel lists each agent as an `AgentInfo`, and the protocol requires its `description`.
A backend may say none, and then the host sends none, so the ACP and cofold entries break the declaration.
With this plan, the host sends a description for every agent: the backend's own, or the agent's name.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- The ACP and cofold cases report `RootAgentsChangedAction /agents/N missing required description`.
- `descriptors` already fills `provider` on each model, because the wire requires it and the backend leaves it out.

### Runtime path

```
Agent.description -> descriptors -> root/agentsChanged and the root snapshot -> a client
```

### Gaps

- An agent that says no description reaches a client without the required field.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The host sends the backend's description, or the agent's display name when it says none. | `AgentInfo.description` is required, and `descriptors` fills what the wire requires, [code://packages/sdk/src/host/root.ts#L158-L168](../../../../packages/sdk/src/host/root.ts#L158-L168) | 01 |

## Proposed architecture

- **Data flow** - every agent entry carries a description.
- **Event flow** - no change.
- **State flow** - no change.
- **Layer responsibilities** - `@ahpd/sdk`: the agent list of the root channel.
- **Source-of-truth files** - [`code://packages/sdk/src/host/root.ts`](../../../../packages/sdk/src/host/root.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Every agent entry has a description](task-01-every-agent-entry-has-a-description.md) | done | - |

## Risks and tradeoffs

- An agent described by its name says nothing more about itself; a backend that names a description keeps it.

## Resume state

- **Done so far:** planned and built 2026-10-27; see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** the ACP and cofold cases of p3 and p4 read the root channel too.

## Final verification checklist

- [x] The ACP and cofold cases report no missing description.
- [x] `plans/index.md` updated.
