---
title: A queued message sent now runs once
domain: host
status: planned
priority: high
created: 2026-11-04
revalidated: 2026-11-04
refs:
  - git://4d703f16 - the commit of ahpd the facts were checked at
  - "[code://packages/sdk/src/host/chatactions.ts#L1427-L1486](../../../../packages/sdk/src/host/chatactions.ts#L1427-L1486) - the host takes `chat/pendingMessageSet` and hands a steering message to `session.steer`"
  - "[code://packages/agent-claude/src/session/turns.ts#L865-L889](../../../../packages/agent-claude/src/session/turns.ts#L865-L889) - Claude's `steer`, which leaves `ctx.queued` as it is"
  - "[code://packages/agent-cofold/src/session.ts#L415-L440](../../../../packages/agent-cofold/src/session.ts#L415-L440) - cofold's `steer`, which leaves its queue as it is"
  - "[code://packages/agent-pi/src/session.ts#L1555-L1580](../../../../packages/agent-pi/src/session.ts#L1555-L1580) - pi's `steer`, which leaves `queued` as it is"
  - "[code://packages/bot/src/chat.ts#L1195-L1205](../../../../packages/bot/src/chat.ts#L1195-L1205) - the bot chat's `steer`, which leaves `waiting` as it is"
  - "[code://packages/sdk/src/types/session.ts#L776](../../../../packages/sdk/src/types/session.ts#L776) - `unqueue`, which every backend has"
  - https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L899-L916 - the reducer replaces the entry with the same id
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L2541-L2554 - VS Code's "Send Immediately" sends the same id again with kind `steering`
---

## Goal

A person turns a queued message into a steer, and the running turn takes it once.
Today Claude, cofold, pi and the bot chat take it into the running turn.
Then they run it again as a turn of its own.
ahpw's "Send now" waits for this fix.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "steer: \(" packages/*/src` - Claude, cofold, pi and the bot chat steer; ACP takes no steering.
- `rg -n "unqueue" packages/sdk/src/types/session.ts` - every backend removes a queued entry by id.

### Runtime path

```
client chat/pendingMessageSet steering, id of a queued entry -> chatactions -> session.steer(id) -> running turn takes it -> session.unqueue(id) -> no second turn
```

### Gaps

- No backend's `steer` removes a queued entry with the same id.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A steering message whose id is queued replaces that entry, and runs once | Softov, 2026-11-04, "lets plans and implement those 2" | 01 |
| The host removes the entry once, with `session.unqueue(id)` after a `steer` that took the message | (defaulted: one place for every backend; a steer that fails keeps the entry, as today) | 01 |

## Proposed architecture

- **Event flow** - the client's `chat/pendingMessageSet` steering, then the backend's own steering set, then `chat/pendingMessageRemoved` queued from `unqueue`.
  The reducer ignores that removal, because the entry is a steering message now.
- **Layer responsibilities** - sdk host: unqueue after a steer · backends: no change.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a steered queued message runs once](task-01-a-steered-queued-message-runs-once.md) | implemented | - |

## Risks and tradeoffs

- `unqueue` starts the head of the queue when nothing runs - after a steer a turn runs, so nothing starts.

## Resume state

- **Done so far:** task 01 is implemented on 2026-11-04.
- **Next action:** review, then the check of ahpw's "Send now" on a live session.
- **Watch out for:** a steer the backend refuses goes on to `session.queue` with kind `steering`.
  That call replaces the entry under the same id, and it keeps working.

## Final verification checklist

- [x] A queued message sent again as steering into a running turn is taken once, and the backend's queued copy is removed.
- [x] `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass, and the sdk, agent-claude, agent-cofold, agent-pi and bot tests pass.
