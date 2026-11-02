---
title: Every client action is answered, by its echo or a refusal
domain: host
status: built
priority: medium
created: 2026-10-31
revalidated: 2026-10-31
refs:
  - git://08b1d57a - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md - a client holds what it dispatched until an envelope with its own origin echoes it, or a rejection refuses it"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/actions.ts - `chat/isArchivedChanged`: archiving the session's default chat is equivalent to archiving the session"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/mcp.md - `session/mcpServerBackgroundRequested`: a no-op in the reducer unless the server is starting with `blocking: true`"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-automation-run/actions.ts - `automationRun/cancelRequested`: a side-effect request that leaves optimistic state unchanged; the outcome arrives later through `automationRun/lifecycleChanged`"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts) - the protocol case driver, which checks refusals and the state left behind"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - a chat's archive bit, the background request, a client's tool call result"
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts) - `automationRun/cancelRequested`"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `owed`, the echoes a backend says later, by what the action names"
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts) - `carry`, a client action handed inside and answered from there"
---

## Goal

Every action a client dispatches is answered to that client: an envelope with its origin, of any action type, or a refusal. The protocol cases are driven with numbered dispatches and each must be answered exactly once.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- The case driver, made to number its dispatches and count the envelopes carrying each one's origin, run over every case on 08b1d57a: four cases go unanswered, `272-chat-isarchivedchanged-archives-chat` and `274`, `275`, `276` (`session/mcpServerBackgroundRequested`). The audit's 043, 044, 050 and 051 are answered at this commit.
- `rg "chat/isArchivedChanged" packages/sdk/src/host` - on a session's default chat it is said as `session/isArchivedChanged` on the session channel and nothing on the chat channel (host/44 p3, a7343dc1), so the client's own dispatch is never answered.
- `rg "backgroundMcpServerStartup" packages` - no first-party backend has it, so the host says nothing; the nested proxy hands it inside with `deliver`, which never pairs the answer inside with the client outside.
- `rg "'chat/toolCallComplete'" packages/sdk/src/host` - the completion the session reports later goes out with no origin: `owed` holds only turn starts, stops and queued messages.
- `rg "automationRun/cancelRequested" packages/sdk/src docs` - a cancel the store takes is never answered; AUTOMATIONS.md calls it refused, AHP.md says the store answers it.

### Gaps

- E14: archiving the default chat answers on the session channel only.
- E19: the background request goes unanswered on every first-party backend, and on a nested session the answer inside never reaches the client outside.
- E21: a client's tool call result is answered by nothing that carries its origin.
- C11: a cancel taken is unanswered, and AUTOMATIONS.md says it is refused.
- The case driver passes a dispatch nobody answered.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The case driver numbers its dispatches and requires exactly one answer for each | the reconciliation guide | 01 |
| Archiving the default chat is answered to its sender on the chat channel, the session archived as before | `echoTo`, which answers an accepted action that leaves its channel's state as it was; host/44 p3's reasons kept | 02 |
| A background request no backend takes is answered to its sender; the proxy carries it, so the answer inside reaches the client outside | `echoTo`; `carry` | 03 |
| A client's tool call result is answered by the completion the session reports, which carries the client's origin | `owed`, named by the tool call | 04 |
| A cancel the store takes is answered to its sender; the run's lifecycle follows to everyone; AUTOMATIONS.md says so | the action's own contract | 05 |

## Proposed architecture

- **Event flow** - each of these dispatches reaches the host, which takes it or refuses it; taken, it is answered at once to its sender where nothing it changes is said with its origin, or by the action that reports its outcome where one does.
- **Layer responsibilities** - the host: answering; the nested proxy: carrying a client's action inside.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts), [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/sdk/src/sessions/nested.ts`](../../../../packages/sdk/src/sessions/nested.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The case driver requires every dispatch answered once](task-01-the-case-driver-requires-every-dispatch-answered.md) | done | - |
| [02 - Archiving the default chat is answered on the chat](task-02-archiving-the-default-chat-is-answered.md) | done | 01 |
| [03 - A background request is answered](task-03-a-background-request-is-answered.md) | done | 01 |
| [04 - A client's tool call result is answered by its completion](task-04-a-tool-call-result-is-answered.md) | done | - |
| [05 - A run cancel is answered](task-05-a-run-cancel-is-answered.md) | done | - |

## Risks and tradeoffs

- The sender of a default-chat archive applies its own echo to its chat, while the host keeps the bit on the session alone (host/44 p3: the chat's entry repeating the session's bit "says one thing twice"). The sender's chat holds the bit until its next snapshot; the session it names is archived and put to sleep at once.

## Resume state

- **Done so far:** planned and built 2026-10-31. See [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** an answer said by a later action needs that action to carry the origin, which `owed` gives only for what it is told to hold.

## Final verification checklist

- [x] Each new case fails on `08b1d57a` for the reason it names, and passes after the change.
- [x] The touched suites pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors.
