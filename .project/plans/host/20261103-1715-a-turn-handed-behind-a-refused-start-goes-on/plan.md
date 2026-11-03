---
title: A turn handed behind a refused start goes on
domain: host
status: planned
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://3945964a - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L55-L69 - a turn's end starts the queue only after a success or a local command"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1810-L1815 - a client's start is handed to the agent when it comes"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L486-L492 - the Claude agent sends a session's messages in order, each after the one before"
  - "[code://packages/agent-claude/src/session/turns.ts#L253-L289](../../../../packages/agent-claude/src/session/turns.ts#L253-L289) - `sayHanded`, which says a handed turn only while a turn is the chat's"
  - "[code://packages/agent-claude/src/session/turns.ts#L322-L326](../../../../packages/agent-claude/src/session/turns.ts#L322-L326) - the three refusals of a start, which started nothing after"
  - "[code://packages/agent-claude/src/session/turns.ts#L502-L512](../../../../packages/agent-claude/src/session/turns.ts#L502-L512) - `startNext`, which begins only a handed turn already said"
  - "[code://packages/agent-claude/src/session/turns.ts#L201-L241](../../../../packages/agent-claude/src/session/turns.ts#L201-L241) - `refuseTurn`, which made every refused turn's reason the chat's failure"
---

## Goal

A Claude turn whose start is refused fails, and the turns handed behind it go on.
The queue behind it waits, as after any failed turn.
A refused turn that a later turn replaced is in no history, and its reason is not the chat's failure.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `refuseTurn`, `handed` and `startNext` in `packages/agent-claude/src/session`.
- The refusals of a start: a CLI that is gone, an agent that will not load, and a model the CLI will not take.
- The other backends' ends of a failed handed turn, which go on to the turn handed behind it.

### What the sources say

- VS Code's drain starts the queue at a turn's end only after a success or a local command.
- VS Code's host hands every client's start to its agent when it comes, and the Claude agent sends each in order.
- So a failed start drains no queue, and the starts handed after it still run.

### What ahpd does

- A refused start shifts its turn off `handed`, says the failure, and starts nothing.
- A turn handed behind it, already said, stays the chat's running turn until a client changes the queue.
- A turn handed while a turn ahead of it switched its model is never said, since no turn was the chat's then.
- `refuseTurn` sets the chat's failure for a refused turn that a later turn replaced, so the chat reads as failed afterwards.

### Gaps

- A turn sent behind a refused start never runs.
- A turn sent while the turn ahead switched to a refused model is never said.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The queue waits after a refused start | [queueDrainContribution.ts#L55-L69](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L55-L69) | 01 |
| The turns handed behind it go on | [agentSideEffects.ts#L1810-L1815](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1810-L1815); [claudeAgent.ts#L486-L492](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L486-L492) | 01 |
| A turn handed while the turn ahead began is said once that turn is over, begun or refused | the same two lines: the start was handed on when it came | 01 |
| A replaced refused turn is in no history and its reason is not the chat's | [reducer.ts#L358-L387](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L358-L387), and the reading ACP's and cofold's ends make | 01 |

## Proposed architecture

- **State flow** - a refused start says its failure, then `startNext` says any handed turn not yet said and begins the first.
- **Layer responsibilities** - agent-claude: `beginTurn`'s refusals, `sayHanded`'s hold, `startNext` and `refuseTurn`.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The turns behind a refused start go on](task-01-the-turns-behind-a-refused-start-go-on.md) | todo | - |

## Risks and tradeoffs

- None found: the queue keeps its rule, and only the turns already handed move.

## Resume state

- **Done so far:** nothing yet.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** a handed command, which `sayHanded` runs as it says it.

## Final verification checklist

- [ ] Each new case fails on `3945964a`'s sources and passes after the change.
- [ ] The test file that holds the cases passes.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
