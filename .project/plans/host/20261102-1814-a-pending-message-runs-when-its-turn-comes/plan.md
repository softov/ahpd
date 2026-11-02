---
title: A pending message runs when its turn comes
domain: host
status: active
priority: high
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://89ebe4d5 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L367-L381 - the specification's text: a queued message is consumed in two steps, at once when the chat is idle, and an idle steering message is stored"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L375-L384 - a turn naming a pending message takes the steering message or the queued one out"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L260-L262 - steering that came too late to steer a turn runs next, ahead of queued messages"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L283-L292 - a pending message starts as `chat/turnStarted` with `queuedMessageId`, with nothing said before it"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L117-L119 - a queued message accepted while the chat is idle starts at once"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L171-L208 - each pending steering message is handed into the running turn once, and the turn goes on"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13509-L13525 - an edit of steering the provider holds is refused, in the words this host uses"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1950-L1954 - a cancel leaves queued messages queued"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L2992-L2999 - its chat finds the message a turn consumed in the queue it held when the turn started"
  - "[code://packages/sdk/src/host/chatactions.ts#L1396-L1458](../../../../packages/sdk/src/host/chatactions.ts#L1396-L1458) - a steering message with nothing running is refused, and one sent again is handed over again"
  - "[code://packages/agent-pi/src/session.ts#L1159-L1181](../../../../packages/agent-pi/src/session.ts#L1159-L1181) - pi says a queued message gone before its turn starts"
  - "[code://packages/agent-pi/src/session.ts#L1188-L1213](../../../../packages/agent-pi/src/session.ts#L1188-L1213) - a queued command's turn names no queued message"
  - "[code://packages/agent-pi/src/session.ts#L1500-L1512](../../../../packages/agent-pi/src/session.ts#L1500-L1512) - a message queued with nothing running waits"
  - "[code://packages/bot/src/chat.ts#L1007-L1042](../../../../packages/bot/src/chat.ts#L1007-L1042) - a bot's steer ends the open turn and starts another"
  - "[code://packages/agent-claude/src/session/turns.ts#L367-L372](../../../../packages/agent-claude/src/session/turns.ts#L367-L372) - Claude starts a queued message in one step"
---

## Goal

A message that waits runs when its turn comes, as VS Code's host runs it.
A steering message sent with no turn running runs as a turn of its own, named by its id.
The steering message a running turn holds, sent again, is answered and not handed over twice; an edit of it is refused.
pi starts a message queued with nothing running at once, and every queued turn names its message.
A bot's steer goes into the open turn, which goes on.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "pendingMessageSet|steer" packages/sdk/src/host/chatactions.ts` - a steering message with nothing running is refused, "Nothing is running in this chat to steer".
- A second `chat/pendingMessageSet` under a held steering id reaches the backend's `steer` again.
- `rg -n "startNext|queue:" packages/agent-pi/src/session.ts` - pi's `queue` never starts a message, and `startNext` says it gone first.
- `rg -n "steer:" packages/bot/src/chat.ts` - a bot's steer ends the open turn as complete and starts a turn for the steered text.
- VS Code main at `a4e689ae`: its queue drain runs late steering as a turn, and hands each steering message to its provider once.

### Runtime path

```
chat/pendingMessageSet steering -> chatactions.ts -> session.steer -> the running turn
  -> nothing running -> session.queue under the steering id -> chat/turnStarted with queuedMessageId
chat/pendingMessageSet queued -> session.queue -> the backend's queue -> its turn when the chat is idle
```

### Gaps

- A steering message with nothing running is refused, where VS Code's host runs it as a turn.
- A steering message sent again reaches the agent a second time.
- pi leaves a message queued with nothing running waiting.
- pi says a queued message gone before its turn, and a queued command's turn names nothing.
- A bot's steer splits the open turn in two.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A10: a steering message with nothing running is answered and runs as a turn of its own, under its id, through the backend's queue | [queueDrainContribution.ts#L260-L262](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L260-L262); [reducer.ts#L375-L384](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L375-L384) | 01 |
| A10: a VS Code client sees the refusal, where VS Code's host runs the message, so VS Code's host decides over "silently stored" | [chat-channel.md#L381](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L381) | 01 |
| A10: Claude, pi, cofold and the nested proxy keep their `steer`, which answers false with nothing running; the host's queue path runs the message | [code://packages/agent-claude/src/session/turns.ts#L668-L683](../../../../packages/agent-claude/src/session/turns.ts#L668-L683) | 01 |
| The steering message a running turn holds, sent again unchanged, is answered and not handed over twice | [queueDrainContribution.ts#L190-L196](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L190-L196) | 01 |
| The same id with another message is refused, "Cannot change a steering message while it is being processed." | [agentService.ts#L13516-L13523](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13516-L13523) | 01 |
| The two messages compare by value, since the held copy went through a reducer | `(defaulted: the reference host compares with equals)` | 01 |
| P2: no change; pi holds each steering message it is handed, as VS Code's host hands each one to its provider once | [queueDrainContribution.ts#L171-L208](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L171-L208) | - |
| P4: pi starts a message queued with nothing running at once | [queueDrainContribution.ts#L117-L119](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L117-L119); [chat-channel.md#L372](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L372) | 02 |
| P9: pi's queued command starts as a turn naming it, and pi says nothing of a queued message before its turn | [queueDrainContribution.ts#L283-L292](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L283-L292); [agentHostSessionHandler.ts#L2992-L2999](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L2992-L2999) | 02 |
| CT1, F2, Q3: no change; Claude, cofold and ACP start a queued message in one step, as VS Code's host does, and its chat could tell the two steps | [agentHostSessionHandler.ts#L2992-L2999](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L2992-L2999) | - |
| B4: a bot's steer is handed into the open turn, which goes on, and is taken out once handed on | [queueDrainContribution.ts#L171-L208](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L171-L208) | 03 |
| B4: the bot keeps the steer on a log line against that turn, so a chat read back still shows it, as plan 56 requires | [plugin/56](../../plugin/56-a-steered-bot-message-is-its-own-turn/plan.md) | 03 |
| E28: no change; a Claude turn opened for steering a stopped turn left names it, which VS Code's host does too | [agentSideEffects.ts#L908-L913](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L908-L913) | - |
| Q4, F3: no change; ACP and cofold keep queued messages after a stop, as VS Code's host does | [agentSideEffects.ts#L1950-L1954](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1950-L1954) | - |

## Proposed architecture

- **Event flow** - a steering message with nothing running takes the queued path, and its turn names it.
- **State flow** - the host reads the chat's held steering message to know what the running turn was handed.
- **Layer responsibilities** - sdk: the idle steering message and the second set · agent-pi: its queue starts its turns · bot: its steer feeds the open turn.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts), [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A steering message runs as VS Code runs it](task-01-a-steering-message-runs-as-vs-code-runs.md) | done | - |
| [02 - pi starts a queued message as a turn naming it](task-02-pi-starts-a-queued-message.md) | done | - |
| [03 - A bot's steer goes into the open turn](task-03-a-bots-steer-goes-into-the-turn.md) | done | - |

## Risks and tradeoffs

- A steering message sent to an idle chat starts a turn, where the person may have meant a correction.
- VS Code's host runs such a message the same way.
- A bot's answer after a steer lands in the turn the steer went into, and the turn holds both answers.

## Resume state

- **Done so far:** tasks 01 to 03, 2026-11-02.
- **Next action:** the implemented record.
- **Open questions:** none.
- **Watch out for:** the owed answer to a steering message is the backend's queued `chat/pendingMessageSet`, said as the client's own action.

## Final verification checklist

- [ ] Each new case fails on `89ebe4d5` for the reason it names, and passes after the change.
- [ ] The touched test files pass, the protocol's cases among them.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
