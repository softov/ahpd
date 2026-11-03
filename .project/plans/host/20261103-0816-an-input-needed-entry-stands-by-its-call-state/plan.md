---
title: An input needed entry stands by its call state
domain: host
status: planned
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://cde4dd6c - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L117-L130 - a confirmation entry stands at a pending confirmation or a pending result confirmation"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L132-L144 - a client execution entry stands while the call runs with a client contributor"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L146-L157 - an authentication entry stands at auth-required"
  - "[code://packages/sdk/src/host/catalogue.ts#L1528-L1569](../../../../packages/sdk/src/host/catalogue.ts#L1528-L1569) - `askedLeft`, which keeps each kind through `streaming` too"
  - "[code://packages/agent-acp/src/mapping.ts#L209-L221](../../../../packages/agent-acp/src/mapping.ts#L209-L221) - `running`, which asks for a call before its ready goes out"
  - "[code://packages/agent-acp/src/session/handlers.ts#L295-L308](../../../../packages/agent-acp/src/session/handlers.ts#L295-L308) - the loop that emits an update's actions"
  - "[code://packages/sdk/test/host-input-needed.test.ts#L180-L191](../../../../packages/sdk/test/host-input-needed.test.ts#L180-L191) - the entries' cases"
---

## Goal

A session's `inputNeeded` entry stands while its call is in the state its kind is raised for.
ACP asks a client for a call once the chat holds that call running.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "streaming" packages/sdk/src/host/catalogue.ts` - each kind keeps its entry through a streaming call.
- `rg -n "onRunning" packages/agent-acp/src` - the entry is raised inside the mapping, before the ready is emitted.

### Runtime path

```
a chat action -> askedLeft -> each entry of the chat, against the call its turn holds
an ACP update -> mapUpdate -> the ready goes out -> the clients' calls it started are asked for
```

### Gaps

- Each kind of entry stands while its call is streaming, where the reference host raises none in that state.
- A client execution entry stands at a pending confirmation, where that host raises one only while the call runs.
- ACP raises a client's entry before the ready that says the call is running.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A VS Code client reads a session's entries in its sessions list, so that host's states decide | [sessionInputNeededContribution.ts#L19-L25](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L19-L25) | 01 |
| A confirmation entry stands at `PendingConfirmation` or `PendingResultConfirmation` | [sessionInputNeededContribution.ts#L117-L130](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L117-L130) | 01 |
| A client execution entry stands while the call is `Running` with a client contributor | [sessionInputNeededContribution.ts#L132-L144](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L132-L144) | 01 |
| An authentication entry stands at `AuthRequired` | [sessionInputNeededContribution.ts#L146-L157](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L146-L157) | 02 |
| So an entry is raised for a call already in that state, which is what ACP's own order has to meet | [`code://packages/agent-acp/src/mapping.ts`](../../../../packages/agent-acp/src/mapping.ts) | 02 |

## Proposed architecture

- **State flow** - `askedLeft` reads each entry against the state its kind is raised for.
- **Layer responsibilities** - sdk: the host's rule; agent-acp: the order its entry is raised in.
- **Source-of-truth files** - [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts), [`code://packages/agent-acp/src/mapping.ts`](../../../../packages/agent-acp/src/mapping.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An entry stands in its own state](task-01-an-entry-stands-in-its-own-state.md) | todo | - |
| [02 - ACP asks once the call runs](task-02-acp-asks-once-the-call-runs.md) | todo | - |

## Risks and tradeoffs

- A backend that raises an entry for a call the chat does not hold in that state loses the entry at the next chat action.

## Resume state

- **Done so far:** nothing.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** a ready carrying no `confirmed` leaves the call at a pending confirmation, which a confirmation entry stands in.

## Final verification checklist

- [ ] The new case and the ACP order fail on `cde4dd6c` for the reasons they name, and pass after the change.
- [ ] The input-needed, tools, ACP client tool, ACP catalog and ACP ports test files pass.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
