---
title: A message goes to the back session queued
domain: bots
status: planned
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://feb72387 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionMessageRouter.ts#L271-L282 - the Agents window sends a message into another session as a queued pending message, an agent's, naming its source"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionMessageRouter.ts#L250-L268 - and learns which turn it became from the turn start that names it"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/meta/vscode/agentRemoteSessionMeta.ts#L78-L89 - `toRemoteSessionMessageMetadata`, the source session and chat under the delegation key"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/meta/vscode/agentMessageDelegationMeta.ts#L6-L22 - the key `vscode.chat.delegation` and its fields"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L810-L827 - a message with no model runs on the host's default model, and with no agent on the provider's default behavior"
  - "[code://packages/bot/src/wake.ts#L436-L480](../../../../packages/bot/src/wake.ts#L436-L480) - `turn`, `said` and `steer`, which hand the back session the message's model, agent and attachments"
  - "[code://packages/bot/src/wake.ts#L620-L660](../../../../packages/bot/src/wake.ts#L620-L660) - `woken`'s send, a turn or a steer by whether the back session works"
  - "[code://packages/bot/src/plugin.ts#L676-L725](../../../../packages/bot/src/plugin.ts#L676-L725) - the `turn_start` handler, which opens a main turn for a back turn no main turn waits on"
  - "[code://packages/sdk/src/host/spawn.ts#L1361-L1369](../../../../packages/sdk/src/host/spawn.ts#L1361-L1369) - the `turn_start` event a backend's turn start raises"
---

## Goal

The bot sends a person's message to its back session as VS Code's Agents window sends a message into another session.
It is a queued `chat/pendingMessageSet`, whatever the back session is doing.
The message is an agent's, and its `_meta` names the main chat's session and chat.
It carries no model, agent or attachments.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `toRemoteSessionMessageMetadata` at `a4e689ae`: the router, the remote session service, and their tests.
- `said(`, `turn(` and `steer(` in `packages/bot/src/wake.ts` - what the back session is handed.
- `turn_start` in `packages/bot/src` and `packages/sdk/src` - how the plugin learns a back turn began.

### Runtime path

```
a message in the main chat -> wake.woken -> chat/pendingMessageSet queued on the back session's chat
  -> the back session's host takes it up -> turn_start naming the queued message -> wake.taken
  -> the back turn ends -> wake.finished answers the main turn, once nothing it sent still waits
```

### Gaps

- The back session is handed the person's model, agent and attachments.
- A message is a turn when the back session is idle and a steer when it works.
- A turn that takes up a queued message does not say so on its `turn_start`, so the bot cannot tell which turn its message became.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The router sends `{ type: ChatPendingMessageSet, kind: Queued, id, message: { text, origin: { kind: MessageKind.Agent }, _meta } }`: "Always enqueue: admission on the host preserves FIFO even if another client starts a turn concurrently." | [remoteSessionMessageRouter.ts#L271-L282](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionMessageRouter.ts#L271-L282) | 01 |
| Its `_meta` is `toRemoteSessionMessageMetadata(sourceSession, sourceChat)`, `{ 'vscode.chat.delegation': { sourceSession, sourceChat } }` | [agentRemoteSessionMeta.ts#L78-L89](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/meta/vscode/agentRemoteSessionMeta.ts#L78-L89); [agentMessageDelegationMeta.ts#L6-L22](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/meta/vscode/agentMessageDelegationMeta.ts#L6-L22) | 01 |
| A message with no model or agent runs on the defaults | [state.ts#L810-L827](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L810-L827) | 01 |
| The router learns which turn its message became from the `chat/turnStarted` that names it as `queuedMessageId` | [remoteSessionMessageRouter.ts#L250-L268](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionMessageRouter.ts#L250-L268) | 01 |
| The bots plan's row for the relayed message cites a chat attachment's resolution, which says nothing of a relay | the ledger's judgment of P1-106 | 01 |

## Proposed architecture

- **State flow** - the wake keeps, per back session, the ids of the messages it sent that no turn has taken up.
  A back turn's end answers the main turn once none waits.
- **Layer responsibilities** - bot: what the wake sends, what it waits on, and what a stop takes back.
  sdk: `turn_start` names the queued message a turn took up.
- **Source-of-truth files** - [`code://packages/bot/src/wake.ts`](../../../../packages/bot/src/wake.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The message is queued as an agent's](task-01-the-message-is-queued-as-an-agents.md) | todo | - |

## Risks and tradeoffs

- A message sent while the back session works waits for the turn in front of it, where a steer reached that turn.
  The main turn is answered by the turn the last message becomes.
- A `post_message` call answers the main turn at once, as before, so a message still waiting then runs as a back turn of its own.

## Resume state

- **Done so far:** nothing.
- **Next action:** task 01.
- **Open questions:** none.
- **Watch out for:** a back turn that begins with no message of the wake's, which `turn_start` shows as a main turn of its own.

## Final verification checklist

- [ ] Each new case fails on `feb72387`'s sources and passes after the change.
- [ ] Every bot test file and the plugin events file pass, one file at a time.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
