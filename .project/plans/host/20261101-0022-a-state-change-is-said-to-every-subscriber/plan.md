---
title: An action that changes state is said to every subscriber
domain: host
status: planned
priority: high
created: 2026-11-01
revalidated: 2026-11-01
refs:
  - git://5da31824 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md - each client keeps `confirmedState` per subscription and applies the echo of its own action to it: server-wins semantics, the server's echo is the source of truth"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/actions.ts - `chat/isArchivedChanged`: archiving the session's default chat is equivalent to archiving the session"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts - `ChatIsArchivedChanged` sets `SessionStatus.IsArchived` in the chat's status"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/reducer.ts - `SessionIsArchivedChanged` sets it in the session's status; `SessionMcpServerBackgroundRequested` sets `blocking` false on a blocking starting server"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/mcp.md - the host remains authoritative and MAY restore `blocking: true` via `session/mcpServerStateChanged` to reject the background request"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/actions.ts - `chat/isReadChanged`: after accepting it the host synchronizes the chat's `ChatSummary.status` and `SessionChatSummary.status` projections"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - `sessionFlag`, `chatFlag`, the default chat's archive, the background request"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts](../../../../packages/sdk/test/ahp-test-cases.test.ts) - the protocol case driver"
---

## Goal

Every action that changes a channel's state, by the protocol's reducer, reaches every subscriber of that channel, so a client that only watched holds what the protocol's cases expect. An answer to its sender alone stays where the action changes nothing.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "echoTo\(" packages/sdk/src` - sixteen sites answer the sender alone. Fourteen echo an action that reduces to no change: a bit, draft, folder, title, claim or review already held, `automationRun/cancelRequested` and `terminal/input` whose reducers return the state as it was, and `chat/turnCancelled` for a turn that is not running. Two echo a change: the default chat's `chat/isArchivedChanged`, whose reducer sets the chat's archived bit, and `session/mcpServerBackgroundRequested` no backend takes, whose reducer clears `blocking` on a blocking starting server.
- The case driver, given a client that subscribes before a case's actions and reduces what it is told with the protocol's reducer, held to each case's expectation on the keys the driver compares: on 5da31824 it finds case `272-chat-isarchivedchanged-archives-chat` alone, its `status` short of the archived bit, which the driver's `HOST_OWNS` entry for 272 had recorded as this host's own value.
- No protocol case reaches a blocking starting server through this host's driver: its sessions list none, so cases 274, 275 and 276 compare no customization.

### Gaps

- E14: the default chat's archive is said to its sender alone, so its sender's chat holds the bit, every other subscriber's does not, and the host's chat state does not either.
- E19: a background request no backend takes is said to its sender alone, so on a blocking starting server its sender's state holds `blocking` false while every other subscriber's holds true.
- The driver holds the state the host serves to each case and nothing that a subscriber reduces.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A client that only watched, reducing what it is told with the protocol's reducer, holds what each case expects on the keys the driver compares; case 272 is driven as the protocol writes it | the protocol's reducer cases; the reconciliation guide | 01 |
| The default chat's archive is applied to the chat for every subscriber with its sender's origin and archives the session; the default chat's archived bit follows the session's whichever action moves it | `chatFlag` and `sessionFlag`, as `sessionFlag` already brings each chat's read bit along with the session's | 02 |
| A background request no backend takes, on a blocking starting server, is said to every subscriber with its sender's origin and followed by `session/mcpServerStateChanged` restoring `blocking: true`; on any other server it stays its sender's answer alone | mcp.md's words for declining; `echoTo` for a no-op | 03 |

## Proposed architecture

- **Event flow** - a client's action reaches the host, which applies it to the channel and says it to every subscriber, its sender's copy carrying the sender's origin; an action that reduces to nothing is said to its sender alone. A change one action implies on another channel goes out there as the host's own action.
- **Layer responsibilities** - the host: applying and saying; the driver: holding a watching subscriber to the protocol's cases.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/sdk/test/ahp-test-cases.test.ts`](../../../../packages/sdk/test/ahp-test-cases.test.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A watching subscriber holds what each case expects](task-01-a-watching-subscriber-holds-what-each-case-expects.md) | planned | - |
| [02 - The default chat's archive is said to every subscriber](task-02-the-default-chats-archive-is-said-to-every-subscriber.md) | planned | 01 |
| [03 - A declined background request is said and restored](task-03-a-declined-background-request-is-said-and-restored.md) | planned | - |

## Risks and tradeoffs

- A session archived before this change keeps its default chat's archived bit unset until its archive next moves: the bit is kept per chat, and nothing rewrites the bits already kept.

## Resume state

- **Done so far:** planned 2026-11-01.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** a host action said inside a client's dispatch carries no origin when its type differs from the client's; one of the same type would take it.

## Final verification checklist

- [ ] Each new case fails on `5da31824` for the reason it names, and passes after the change.
- [ ] The touched suites pass.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors.
