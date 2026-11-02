---
title: A renamed chat keeps its new title
domain: host
status: built
priority: high
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://6e6d1ca8 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/chatContributions/sessionTitle/sessionTitleContribution.ts#L53-L72 - a client's `session/titleChanged` on a chat channel renames that chat, and the session too when the chat is its default"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2316-L2331 - `updateChatTitle` sets the chat's held title and says `session/chatUpdated` with it"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2902-L2939 - a session action on a chat channel reduces nothing there"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3079-L3091 - and goes out on that channel with the client's origin"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentSideEffects.ts#L414-L526 - the title contribution sees the action after it went out"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L8077-L8088 - the Sessions window renames a peer chat and the default chat on the chat's own channel"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L2149 - it reads a tab's title back from the default chat's row at every session state"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-session/actions.ts#L134-L146 - the specification's text: `session/titleChanged` renames a session"
  - "[code://packages/sdk/src/host/chatactions.ts#L620-L643](../../../../packages/sdk/src/host/chatactions.ts#L620-L643) - `session/titleChanged`, on a chat channel the chat it names"
  - "[code://packages/sdk/src/host/tooling.ts#L1316-L1338](../../../../packages/sdk/src/host/tooling.ts#L1316-L1338) - `renameChat`, which leaves the chat's held title as it was"
  - "[code://packages/sdk/src/host/catalogue.ts#L1458-L1482](../../../../packages/sdk/src/host/catalogue.ts#L1458-L1482) - `chatMoved`, which reads a chat's row off its held state after each of its actions"
---

## Goal

A client that renames a chat on the chat's own channel is answered on that channel, and the chat keeps the new title.
The chat's held state and its row in the session take the title together, as VS Code's host renames a chat.
A renamed default chat renames its session too, after its row.
A rename on the session's own channel, and an agent's `rename_chat`, keep their paths.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "titleChanged|renameChat" packages/sdk/src/host` - one handler for a client's rename and one `renameChat`, which the `rename_chat` tool calls too.
- `renameChat` sets the backend's title and stores it, then says `session/titleChanged` for the default chat and `session/chatUpdated` for a peer.
- No chat action carries a title, and `chatMoved` reads a chat's row off its held state after each of its actions.
- So a renamed peer chat's row says its old title again at the chat's next action.
- The default chat's row is not retitled by a rename at all.
- VS Code main at `37eba093` says the client's action on the chat channel first.
- Then its `updateChatTitle` sets the held title and says the row, and a default chat renames its session.

### Runtime path

```
client session/titleChanged on a chat channel -> chatactions.ts
  -> the client's action, on the chat channel
  -> renameChat -> backend title, store, held chat title -> session/chatUpdated -> session/titleChanged for the default chat
```

### Gaps

- A peer chat renamed on its channel gets no answer, and its name reverts at its next turn.
- A default chat renamed on its channel is answered on the session's channel, and its row keeps the old title.
- The Sessions window reads a tab's title from that row, so its tab reverts too.
- The specification's text has no client rename of a chat; VS Code's host takes one on the chat's channel, and decides here.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A rename on a chat's channel is said back on that channel with the client's origin, before anything else | [agentHostStateManager.ts#L3079-L3091](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3079-L3091); [agentSideEffects.ts#L414-L526](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentSideEffects.ts#L414-L526) | 01 |
| A renamed chat's held state takes the title, and its row says it with this host's `session/chatUpdated` | [agentHostStateManager.ts#L2316-L2331](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2316-L2331) | 01 |
| A renamed default chat also renames its session with this host's `session/titleChanged`, after the row | [sessionTitleContribution.ts#L65-L66](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/chatContributions/sessionTitle/sessionTitleContribution.ts#L65-L66) | 01 |
| An agent's `rename_chat` renames a chat the same way | [code://packages/sdk/src/host/tooling.ts#L1316-L1338](../../../../packages/sdk/src/host/tooling.ts#L1316-L1338) | 01 |
| A rename on the session's own channel says the session's title, and stores and hands the default chat the title, as now | [code://packages/sdk/src/host/chatactions.ts#L620-L643](../../../../packages/sdk/src/host/chatactions.ts#L620-L643) | 01 |
| A blank title is refused, as now | [code://packages/sdk/src/host/chatactions.ts#L636-L640](../../../../packages/sdk/src/host/chatactions.ts#L636-L640) | 01 |
| `AHP.md` says how a chat's rename is answered | [code://docs/sdk/AHP.md#L235](../../../../docs/sdk/AHP.md#L235) | 01 |

## Proposed architecture

- **Event flow** - the client's rename goes out on the chat's channel, then the chat's title moves in its held state and its row.
- **Session title** - a default chat's rename says the session's title last.
- **State flow** - the chat's held state is the one place a chat's title lives after its snapshot; the row reads it from there.
- **Layer responsibilities** - `renameChat` renames a chat; `renameSession` renames a session from its own channel.
- **Source-of-truth files** - [`code://packages/sdk/src/host/tooling.ts`](../../../../packages/sdk/src/host/tooling.ts), [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A chat's title moves with its state and its row](task-01-a-chats-title-moves-with-its-state-and-row.md) | done | - |

## Risks and tradeoffs

- A client watching the chat's own channel holds the old title until it subscribes again, since no chat action carries a title.
- VS Code's host leaves such a client with the old title too.
- The held title is set outside the chat's reducer, as VS Code's host sets it.

## Resume state

- **Done so far:** task 01, 2026-11-02.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** the client's action on the chat channel is a session action, which the chat's reducer does not take.

## Final verification checklist

- [x] Each new case fails on `6e6d1ca8` for the reason it names, and passes after the change.
- [x] The touched suites pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
