---
title: A chat's read state is its own
domain: host
status: built
priority: high
created: 2026-11-01
revalidated: 2026-11-01
requires:
  - plans/host/20261101-0207-the-protocol-cases-are-the-oracle/plan.md
refs:
  - git://c7899eff - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L26-L36 - `chat/isReadChanged` changes only the addressed chat, `session/isReadChanged` only the session, and \"neither action implies the other\""
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/session-channel.md#L95 - the session's status takes its activity from its chats, and \"The orthogonal IsRead / IsArchived flags remain session-scoped and pass through unchanged\""
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/state-model.md#L149-L152 - read state is scoped to the addressed channel"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L358-L372 - a turn's start clears the chat's `IsRead`"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L172-L237 - a turn's end leaves the chat's `IsRead` as it is"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/chatContributions/markUnread/markUnreadContribution.ts#L27-L48 - VS Code's host marks a chat unread at a turn's end, except a local command or a rejected request; then a read session, with the session's own action, unless the chat is a tool's or hidden"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/common/state/sessionState.ts#L2063-L2070 - `isChatInSessionReadAggregate`: a chat whose origin is not a tool and whose interactivity is not hidden; the others \"retain exact per-chat state without making the session unread\""
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/chatContributions/chatArchive/chatArchiveContribution.ts#L50-L51 - VS Code's host marks a chat it archives read"
  - "https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2869-L3006 - VS Code's host moves the session's read bit with its chats' and the chats' with the session's"
  - "[code://packages/sdk/src/host/chatactions.ts#L12-L75](../../../../packages/sdk/src/host/chatactions.ts#L12-L75) - `sessionFlag`, which moves the session's chats with a read bit it moves"
  - "[code://packages/sdk/src/host/chatactions.ts#L77-L89](../../../../packages/sdk/src/host/chatactions.ts#L77-L89) - `countedChats`, the chats whose bits make up the session's"
  - "[code://packages/sdk/src/host/chatactions.ts#L129-L145](../../../../packages/sdk/src/host/chatactions.ts#L129-L145) - `sessionFollows`, which moves the session's bit with a chat's"
  - "[code://packages/sdk/src/host/chatactions.ts#L216-L271](../../../../packages/sdk/src/host/chatactions.ts#L216-L271) - a client's chat bit, then the session's after it"
  - "[code://packages/sdk/src/host/spawn.ts#L1469-L1500](../../../../packages/sdk/src/host/spawn.ts#L1469-L1500) - a turn's start and end move the chat's bit, then the session's after it"
  - "[code://packages/sdk/src/host/spawn.ts#L382-L384](../../../../packages/sdk/src/host/spawn.ts#L382-L384) - a worker chat's bit at a turn's start"
  - "[code://packages/sdk/src/host/spawn.ts#L513-L515](../../../../packages/sdk/src/host/spawn.ts#L513-L515) - a worker chat's bit at its end"
  - "[code://packages/sdk/src/host/actions.ts#L786-L799](../../../../packages/sdk/src/host/actions.ts#L786-L799) - `session/isReadChanged` into `sessionFlag`"
  - "[code://.project/plans/host/89-chat-and-session-read-state-stay-in-step/plan.md](../89-chat-and-session-read-state-stay-in-step/plan.md) - the answers this plan reverses, which follow VS Code's host where the specification's text says otherwise"
  - "[code://packages/sdk/test/ahp-test-cases.test.ts#L416](../../../../packages/sdk/test/ahp-test-cases.test.ts#L416) - case 072's divergence: a session marked unread moves its chat's row"
  - "[code://packages/sdk/test/host-catalogue.test.ts#L501-L644](../../../../packages/sdk/test/host-catalogue.test.ts#L501-L644) - the tests that hold the two bits together"
---

## Goal

A chat's read bit and its session's read bit are independent, as the protocol has them.
A client that marks a chat read or unread changes that chat alone, and one that marks the session changes the session alone.
Each action keeps its own summaries in step: the chat's row in its session, and the session's row in the catalogue.
A turn's start clears its chat's bit, and leaves the session's.
A turn's end marks its chat unread, then a read session unread with the session's own action, unless the chat is a tool's or hidden.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "sessionFollows|countedChats" packages/sdk/src` - `sessionFollows` runs after a client's chat bit, a chat's archive, a turn's start and a turn's end; `countedChats` serves it and `sessionFlag`.
- `rg -n "isReadChanged|IsRead" packages/*/src` - no backend moves a read bit; the host's `chatFlag`, `sessionFlag` and `startsRead` are the only writers.
- VS Code main at `1306698e`: `markUnreadContribution.ts` marks a chat unread at a turn's end, and `chatArchiveContribution.ts` marks an archived chat read.
- The same turn's end then marks a read session unread with `session/isReadChanged`, filtered by the chat's own origin and interactivity.
- The same host also moves the session's bit with its chats' bits, in `agentHostStateManager.ts`, after a client's read action.
- The protocol's session reducer keeps `IsRead` through every action but `session/isReadChanged`, an input request included.

### Runtime path

```
client chat/isReadChanged -> chatFlag on the chat -> session/chatUpdated -> sessionFollows -> session/isReadChanged
client session/isReadChanged -> sessionFlag -> chatFlag on every counted chat, or on the one chat
backend turn start or end -> chatFlag on the chat -> sessionFollows -> session/isReadChanged
```

### Gaps

- A1: a chat's bit and its session's move each other, where chat-channel.md says "neither action implies the other".
- Case 072 through the host: a session marked unread marks its one chat unread.
- So the session's list of chats moves, where the session reducer moves nothing.
- `Not found: a sentence of the specification on the read state at a turn's end - searched chat-channel.md, session-channel.md and state-model.md at v1.0.0.`

## Answers

| What | Source | Task |
| --- | --- | --- |
| `chat/isReadChanged` moves the chat's bit, its row in the session and the session's row in the catalogue, and nothing else | [chat-channel.md#L26-L36](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L26-L36) | 01 |
| `session/isReadChanged` moves the session's bit and its row in the catalogue, and nothing else | [chat-channel.md#L35-L36](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L35-L36); [session-channel.md#L95](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/session-channel.md#L95) | 01 |
| A turn's start, a resumed turn and an input request clear the chat's bit, as the chat reducer does | [reducer.ts#L358-L372](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L358-L372) | 01 |
| A turn's end marks its chat unread, a worker's chat included, and a `!` command turn's end puts back the bit its chat had at its start | [markUnreadContribution.ts#L27-L39](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/chatContributions/markUnread/markUnreadContribution.ts#L27-L39); Softov, 2026-10-15, chose "Follow the protocol" | 01 |
| A turn's end, a `!` command's excepted, then marks a read session unread with this host's own `session/isReadChanged`, unless the chat's origin is a tool or its interactivity is hidden | [markUnreadContribution.ts#L27-L48](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/chatContributions/markUnread/markUnreadContribution.ts#L27-L48); [sessionState.ts#L2063-L2070](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/common/state/sessionState.ts#L2063-L2070) | 01 |
| A turn's end is neither client action, so the specification's "neither action implies the other" leaves it to the reference; its session mark derives no summary field from a chat | [chat-channel.md#L26-L36](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L26-L36); [session-channel.md#L95](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/session-channel.md#L95) | 01 |
| A chat archived on its own is marked read, and the session's bit stays as it is | [chatArchiveContribution.ts#L50-L51](https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/chatContributions/chatArchive/chatArchiveContribution.ts#L50-L51) | 01 |
| A new session and a new chat start read | [code://packages/sdk/src/host/lifecycle.ts#L1828-L1829](../../../../packages/sdk/src/host/lifecycle.ts#L1828-L1829) | 01 |
| The protocol case driver lists no divergence for case 072 | [code://packages/sdk/test/ahp-test-cases.test.ts#L416](../../../../packages/sdk/test/ahp-test-cases.test.ts#L416) | 01 |

## Proposed architecture

- **Event flow** - a client's read action and the host's own read marks each move one bit, on the channel the action names.
- **State flow** - the store keeps one read bit per session and one per chat, and none is computed from another.
- **Layer responsibilities** - `chatFlag` and `sessionFlag` each move one bit and its summaries.
- **Turn marks** - `spawn.ts` marks a chat at a turn's start and end, and a session at a turn's end.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Each read bit moves alone](task-01-each-read-bit-moves-alone.md) | done | - |
| [02 - The docs say each bit is its own](task-02-the-docs-say-each-bit-is-its-own.md) | done | 01 |

## Risks and tradeoffs

- A client that marks only a chat read leaves its session unread - the protocol keeps the two apart, and a client marks the session itself.
- A session that is unread in the store stays unread until a client marks it - a restart keeps the bits as they were.

## Resume state

- **Done so far:** tasks 01 and 02, 2026-11-01, and the session's mark at a turn's end the same day.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** `commandTurns` keeps a `!` command turn's start bit, which its end puts back on the chat alone.

## Final verification checklist

- [x] Each changed case fails on `c7899eff` for the reason it names, and passes after the change.
- [x] Case 072 passes through the host with no divergence listed.
- [x] The touched suites pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
