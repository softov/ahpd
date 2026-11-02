---
title: A session's row takes a busy chat's status
domain: host
status: planned
priority: high
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://6e6d1ca8 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3339-L3367 - `_aggregateChatSummaries`: the default chat's bits, promoted to `InputNeeded` by any chat that needs input, else to `InProgress` by any chat that runs, and the activity of the chat that decided"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3305-L3320 - the aggregate is the session's status and activity, over the session's whole chat list"
  - "https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L2204-L2207 - the Sessions window reads a row's status as \"the session aggregate which may have been promoted by a running peer chat\""
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/session-channel.md#L91-L99 - the specification's text: promote `InputNeeded`, then `Error`"
  - "[code://packages/sdk/src/host/catalogue.ts#L454-L482](../../../../packages/sdk/src/host/catalogue.ts#L454-L482) - `drivingOf`, which promotes `InputNeeded`, then `Error`"
  - "[code://packages/sdk/src/host/catalogue.ts#L411-L453](../../../../packages/sdk/src/host/catalogue.ts#L411-L453) - `statusOf` and `chatsOf`, which read every chat, workers included"
  - "[code://.project/plans/host/20261101-0329-the-hosts-state-is-the-reducers-output/plan.md](../20261101-0329-the-hosts-state-is-the-reducers-output/plan.md) - the answer this plan reverses, which follows the specification's text"
  - "[code://packages/sdk/test/subagent-chat.test.ts#L808-L847](../../../../packages/sdk/test/subagent-chat.test.ts#L808-L847) - the tests that hold a session's row to its default chat while another chat runs"
---

## Goal

A session's row says it is busy while any of its chats is busy, as VS Code's host promotes it.
A chat that needs input makes the row need input, and else a chat that runs makes the row run.
Otherwise the row says what its default chat says, and a failed peer chat leaves it as that.
The row's activity is the activity of the chat that decided its status.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "drivingOf|activityOf|statusOf" packages/sdk/src` - `drivingOf` decides both the row's status and the session's activity.
- `statusOf` also feeds `turning` in `host.ts` and a changeset's busy test in `changesets.ts`.
- VS Code main at `37eba093`: `_aggregateChatSummaries` promotes `InputNeeded`, then a chat whose bits are `InProgress` alone, and never `Error`.
- Its aggregate runs over the session's whole chat list, a tool's chats among them.
- `rg -n "promot" packages/*/test` - `subagent-chat.test.ts` holds a row to its default chat while a worker or a second chat runs.

### Runtime path

```
chat action -> chatMoved -> summaryMoved -> statusOf -> drivingOf -> the catalogue row's status
chatMoved -> activityOf -> drivingOf -> session/activityChanged
```

### Gaps

- A session whose default chat is idle while a peer chat or a worker runs reads idle.
- The Sessions window expects such a row to read running.
- A session whose peer chat failed reads as failed, where VS Code's host reads the default chat's bits.
- The specification's text promotes `Error`, and VS Code's host does not; VS Code's host decides here.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A chat whose status carries `InputNeeded` makes the row `InputNeeded` | [agentHostStateManager.ts#L3354-L3360](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3354-L3360) | 01 |
| Else a chat whose bits are `InProgress` alone makes the row `InProgress` | [agentHostStateManager.ts#L3355-L3363](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3355-L3363) | 01 |
| Else the row has the default chat's activity bits, or the most recent chat's, and no chat's `Error` is promoted | [agentHostStateManager.ts#L3349-L3353](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3349-L3353) | 01 |
| The row's activity, and the session's, follow the chat that decided | [agentHostStateManager.ts#L3366](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3366) | 01 |
| Every chat of the session counts, workers included, as now | [agentHostStateManager.ts#L3305-L3311](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3305-L3311) | 01 |
| A session with no chat reads idle, as now | [code://packages/sdk/src/host/catalogue.ts#L470-L473](../../../../packages/sdk/src/host/catalogue.ts#L470-L473) | 01 |

## Proposed architecture

- **State flow** - `drivingOf` picks the chat that decides a session's status and activity; `statusOf` lays the session's own flags over it.
- **Layer responsibilities** - `catalogue.ts` alone; every reader of a row's status reads it through `statusOf`.
- **Source-of-truth files** - [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A row takes its busiest chat's status](task-01-a-row-takes-its-busiest-chats-status.md) | todo | - |

## Risks and tradeoffs

- A session's row reads busy while a worker runs, so a changeset's operations are disabled until every chat of the session is idle.
- A failed peer chat shows on its own row in the session's list, and the session's row reads the default chat's bits.

## Resume state

- **Done so far:** planned 2026-11-02.
- **Next action:** [task-01-a-row-takes-its-busiest-chats-status.md](task-01-a-row-takes-its-busiest-chats-status.md).
- **Open questions:** none.
- **Watch out for:** `InputNeeded` is 24 and carries `InProgress`, so a chat that runs alone is the one whose bits under `InputNeeded` are `InProgress`.

## Final verification checklist

- [ ] Each new or changed case fails on `6e6d1ca8` for the reason it names, and passes after the change.
- [ ] The touched suites pass.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
