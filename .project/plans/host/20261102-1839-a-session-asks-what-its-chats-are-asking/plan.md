---
title: A session asks what its chats are asking
domain: host
status: built
priority: high
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://89ebe4d5 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/state.ts#L236-L247 - `inputNeeded` is host-managed: upserted as chats raise requests, removed once each resolves"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L345-L359 - the validation of an input answer and an input completion"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L40-L83 - the reference host derives the session's entries from each chat action"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L85-L157 - an entry per open input request, confirmation, client execution and authentication"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L196-L221 - every entry of a chat goes at its turn's end, and the ids each entry takes"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1913-L1919 - an answer is handed to the agent as sent"
  - "[code://packages/sdk/src/host.ts#L887-L945](../../../../packages/sdk/src/host.ts#L887-L945) - `emit`, where a chat's held state takes each action"
  - "[code://packages/sdk/src/host/spawn.ts#L1389-L1410](../../../../packages/sdk/src/host/spawn.ts#L1389-L1410) - a backend's entries raise the plugin events"
  - "[code://packages/sdk/src/host/chatactions.ts#L1966-L2000](../../../../packages/sdk/src/host/chatactions.ts#L1966-L2000) - a draft answer refused for a backend that keeps none"
  - "[code://packages/sdk/src/host/channels.ts#L169-L170](../../../../packages/sdk/src/host/channels.ts#L169-L170) - the actions a worker's chat takes"
  - "[code://packages/agent-acp/src/session/handlers.ts#L755-L860](../../../../packages/agent-acp/src/session/handlers.ts#L755-L860) - ACP ends a question in no client's name"
  - "[code://packages/bot/src/chat.ts#L650-L673](../../../../packages/bot/src/chat.ts#L650-L673) - the bot ends a copied request in no client's name"
---

## Goal

A session's `inputNeeded` says what its chats are asking, and nothing else.
The host takes down an entry once its chat no longer holds its request open, as VS Code's host keeps them.
An answer is held to the request it answers, as the specification asks.
A draft answer is taken on any chat, for any backend.
A request ends by a client's answer or by its turn's end, never in no client's name.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "session/inputNeeded" packages/*/src` - five backends and the client calls raise and clear the session's entries themselves.
- Claude clears an `auth:` entry only when its server is ready again, and cofold and the nested proxy leave entries behind.
- `rg -n "keeps no draft answers|WORKER_ACTIONS" packages/sdk/src/host` - a draft answer is refused on a worker's chat and for four backends.
- `rg -n "inputCompleted" packages/agent-acp/src packages/bot/src` - ACP and the bot complete a request with no client's origin.
- VS Code main at `a4e689ae`: its `sessionInputNeeded` contribution derives every entry from the chat.

### Runtime path

```
a chat action -> dispatch -> the chat's held state -> each entry of that chat no longer standing -> session/inputNeededRemoved
chat/inputAnswerChanged, chat/inputCompleted -> chatactions.ts -> held to the open request -> said
```

### Gaps

- A session's entry outlives the request or the turn it was for.
- An entry can name a chat other than the one asking.
- A client's answer is taken whatever shape it has.
- A draft answer is refused on a worker's chat and for a backend that keeps none.
- A request leaves the chat mid-turn as answered by nobody.

## Answers

| What | Source | Task |
| --- | --- | --- |
| CS11, CT12, F11, X14: an entry stands while the chat's running turn holds open what it names, so it goes once its request resolves and with its turn | [sessionInputNeededContribution.ts#L40-L83](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L40-L83); [state.ts#L243-L245](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/state.ts#L243-L245) | 01 |
| A call still being announced holds its entry, since a backend raises some entries before the call reaches its confirmation or its client | [code://packages/agent-acp/src/session/clientcalls.ts](../../../../packages/agent-acp/src/session/clientcalls.ts) | 01 |
| CT6, X3: not built; the reference host derives each entry from the chat's call, and this host's chat names a client's call by the model's name | [agentHostSessionHandler.ts#L3083-L3095](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L3083-L3095) | - |
| CT4, Q10, B8: an accepted completion lacking a required answer, and a draft answer missing its value, are refused | [chat-channel.md#L351-L358](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L351-L358) | 02 |
| CT4, Q10, B8: VS Code's host hands an answer on unchecked, and its clients send what their forms hold, so no VS Code client can tell and the specification's text holds | [agentSideEffects.ts#L1913-L1919](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1913-L1919) | 02 |
| host/channels.ts:161, A11's `setAnswer`: a draft answer is taken on a worker's chat and for a backend that keeps none, and the host says it | [chat-channel.md#L355](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L355) | 03 |
| B2, Q6: the bot and ACP end no request in no client's name; a request no client answered ends with its turn | [chat reducer.ts#L172-L239](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L172-L239) | 04 |
| CT14, F1: fixed by `host/20261101-1556-every-backend-says-its-state-by-actions`, in main | [code://packages/agent-claude/src/session/clienttools.ts](../../../../packages/agent-claude/src/session/clienttools.ts) | - |
| F8: no change; VS Code's client reads an absent `allowFreeformInput` as allowed, as cofold does | [stateToProgressAdapter.ts#L236-L246](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/stateToProgressAdapter.ts#L236-L246) | - |
| F9, CT11: no change; the host hands the answers on as sent, and each backend puts them in its agent's own shape | [agentSideEffects.ts#L1913-L1919](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1913-L1919) | - |
| Q7: open; a request raised with no turn has no entry, as the reducer drops it; what ACP answers its agent then is left as it is | [chat reducer.ts#L239-L243](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L239-L243) | - |
| CT13: open; a stop ends Claude's background workers' questions, and VS Code's host cancels a chat's subagent sessions, whose questions it did not show | [agentSideEffects.ts#L1921-L1956](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1921-L1956) | - |

## Proposed architecture

- **Event flow** - each chat action the host says moves the session's entries for that chat.
- **State flow** - the session's `inputNeeded` holds nothing its chats no longer hold open.
- **Layer responsibilities** - sdk: the entries, the answer checks and the draft · agent-acp and bot: no ending in no client's name.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A session asks what its chats ask](task-01-a-session-asks-what-its-chats-ask.md) | done | - |
| [02 - An answer is held to its request](task-02-an-answer-is-held-to-its-request.md) | done | - |
| [03 - A draft answer is taken on any chat](task-03-a-draft-answer-is-taken-on-any-chat.md) | done | - |
| [04 - A request ends by an answer or its turn](task-04-a-request-ends-by-answer-or-turn.md) | done | 01 |

## Risks and tradeoffs

- Backends still raise the entries, under their own ids; the host takes each down when its request resolves.
- A session's entries come from the chat's call alone once a client's call carries the client's own tool name.

## Resume state

- **Done so far:** tasks 01 to 04, 2026-11-02.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** a worker's chat belongs to its lead session, so its entries are that session's.

## Final verification checklist

- [x] Each new case fails on `89ebe4d5` for the reason it names, and passes after the change.
- [x] The touched test files pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
