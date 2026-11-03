---
title: The queue drains as VS Code drains it
domain: host
status: built
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://cde4dd6c - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L55-L69 - a turn's end starts the queue only when the turn succeeded or ran a local command"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L71-L90 - a client's pending-message action, once applied, runs the drain"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L123-L152 - the drain runs for a set, a removal and a reorder"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L245-L286 - the drain starts the head while the chat is idle, and nothing while its latest turn failed in a way a client can resume"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1950-L1954 - a cancel leaves the queue behind the turn queued"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L365-L372 - the specification's text: the queue is consumed when a turn completes, and at once when a message is queued while idle"
  - "[code://.project/plans/host/20261102-1814-a-pending-message-runs-when-its-turn-comes/plan.md](../20261102-1814-a-pending-message-runs-when-its-turn-comes/plan.md) - the plan whose found, not built row this plan builds"
  - "[code://packages/agent-claude/src/session/query.ts#L1030-L1160](../../../../packages/agent-claude/src/session/query.ts#L1030-L1160) - Claude starts the queue at every result"
  - "[code://packages/agent-claude/src/session/turns.ts#L366-L417](../../../../packages/agent-claude/src/session/turns.ts#L366-L417) - Claude's `startNext`"
  - "[code://packages/agent-claude/src/session/logins.ts#L346-L351](../../../../packages/agent-claude/src/session/logins.ts#L346-L351) - a turn that could not move to another login starts the queue"
  - "[code://packages/agent-pi/src/session.ts#L680-L727](../../../../packages/agent-pi/src/session.ts#L680-L727) - pi's `finish` starts the queue whatever ended the turn"
  - "[code://packages/agent-acp/src/session/turn.ts#L153-L156](../../../../packages/agent-acp/src/session/turn.ts#L153-L156) - ACP starts the queue after a failed turn"
  - "[code://packages/agent-cofold/src/runs.ts#L151-L154](../../../../packages/agent-cofold/src/runs.ts#L151-L154) - cofold starts the queue after a failed turn"
  - "[code://packages/bot/src/chat.ts#L680-L737](../../../../packages/bot/src/chat.ts#L680-L737) - the bot's `finish` starts the queue at a stop and after a failure"
---

## Goal

A chat's queue starts after a turn that succeeded or ran a `!` command, as VS Code's host drains it.
A stopped turn and a failed turn start nothing behind them.
A message queued, removed or reordered by a client while the chat is idle starts the head of the queue.
Nothing starts while the chat's latest turn failed in a way a client can resume.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "startNext" packages/agent-*/src packages/bot/src examples` - every place a backend starts its queue.
- Claude starts it at every result it does not hold back.
- Claude starts it too after a refused turn, a failed resume or a failed move to another login.
- pi starts it at every turn's end but a stop's; the bot and ACP and cofold after a failure.
- No backend's `unqueue` or `reorder` starts the queue.
- A stop holds the queue in Claude, pi and the bot already, through `#195`.

### What the sources say

VS Code's host starts the queue at a turn's end only for a success or a local command, and a cancel leaves the queue queued.

```ts
// queueDrainContribution.ts L55-L69 at a4e689ae
	onTurnEnd(turn: ITurnEnd): void {
		if (turn.reason.kind === 'cancelled') {
			const state = this._stateManager.getChatState(turn.channel);
			if (state) {
				for (const message of getPendingSteeringMessages(state)) {
					this._context.deleteMemento(PendingSender, turn.channel, message.id);
					this._stateManager.dispatchServerAction(turn.channel, { type: ActionType.ChatPendingMessageRemoved, kind: PendingMessageKind.Steering, id: message.id });
				}
			}
			this._context.deleteMemento(SubmittedSteering, turn.channel);
		}
		if (turn.reason.kind === 'success' || turn.reason.kind === 'localCommand') {
			this._tryConsumeNextQueuedMessage(turn.channel);
		}
	}
// agentSideEffects.ts L1950-L1954 at a4e689ae
				// Intentionally do NOT drain queued messages here: cancelling means
				// "stop", so messages queued behind the turn stay queued for the
				// user to dequeue/run manually. (A message the user sends *after*
				// the abort is still consumed via the ChatPendingMessageSet path
				// once cancellation has cleared the active turn.)
```

A client's set, removal or reorder of a pending message runs the drain once the host has applied it.

```ts
// queueDrainContribution.ts L87-L89 at a4e689ae
		if (this._handlePendingMessageAction(observed.channel, action)) {
			this._tryConsumeNextQueuedMessage(observed.channel);
		}
// queueDrainContribution.ts L140-L148 at a4e689ae, after the set's case at L131-L139
			case ActionType.ChatPendingMessageRemoved:
				if (!this._stateManager.getChatState(channel)?.queuedMessages?.some(message => message.id === action.id)) {
					this._context.deleteMemento(PendingSender, channel, action.id);
				}
				this._syncPendingMessages(channel);
				return true;
			case ActionType.ChatQueuedMessagesReordered:
				this._syncPendingMessages(channel);
				return true;
```

The drain starts the head while no turn runs, and nothing while the latest turn ended in an error a client can resume.

```ts
// queueDrainContribution.ts L249-L251 and L262-L267 at a4e689ae
		if (this._stateManager.getActiveTurnId(channel)) {
			return;
		}
		const latestTurn = state.turns.at(-1);
		if (latestTurn?.state === TurnState.Error && getErrorResponsePart(latestTurn)?.resumable) {
			return;
		}
		// Steering that arrived too late to steer a turn runs next, ahead of queued messages.
		const message = steering[0] ?? state.queuedMessages?.find(message => message.kind !== PendingMessageKind.Steering);
```

`getErrorResponsePart` reads the turn's last part, when it is an error (sessionState.ts L121-L127 at a4e689ae).
The specification's text consumes the queue "when a turn completes", and at once for a message queued while idle (chat-channel.md L365-L372).
It says nothing of a stopped or failed turn, or of a removal and a reorder.
A VS Code client draws the queue, and sees a message start that VS Code's host leaves waiting, so VS Code's host decides.

### Runtime path

```
a turn's end -> succeeded or a ! command -> the head starts
             -> stopped or failed -> the queue waits
a client's chat/pendingMessageSet, pendingMessageRemoved or queuedMessagesReordered -> the backend's queue, unqueue or reorder
  -> idle, and the latest turn is no resumable failure -> the head starts
```

### Gaps

- Claude, pi, ACP, cofold and the bot start their queue after a failed turn.
- A message queued after a turn that failed in a way a client can resume starts at once.
- A client's removal or reorder while the chat is idle starts nothing, so a queue that waits after a stop or a failure stays held.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A stopped turn starts nothing behind it, in Claude, pi and the bot, as in ACP, cofold and the examples | [agentSideEffects.ts#L1950-L1954](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1950-L1954); [queueDrainContribution.ts#L55-L69](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L55-L69) | 01 |
| A start a client asked for while the backend still let a stopped turn go is made once it has | [queueDrainContribution.ts#L245-L286](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L245-L286) | 01 |
| A failed turn starts nothing behind it, in every backend; a `!` command's turn starts the queue however the command ended | [queueDrainContribution.ts#L66-L68](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L66-L68) | 02 |
| A client's removal or reorder of a pending message while the chat is idle starts the head | [queueDrainContribution.ts#L71-L90](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L71-L90); [queueDrainContribution.ts#L123-L152](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L123-L152) | 02 |
| Nothing starts while the latest turn ended in an error part that says `resumable`, a message queued since included | [queueDrainContribution.ts#L262-L265](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L262-L265) | 02 |
| The specification's "when a turn completes" leaves a stop and a failure open, and a VS Code client sees the difference, so VS Code's host decides | [chat-channel.md#L365-L372](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L365-L372) | 02 |
| One function in the SDK says whether a turn holds the queue, for every backend | `(defaulted: the rule is one, as `titleFrom` and `statusOf` are one for every backend)` | 02 |

## Proposed architecture

- **Turn end** - each backend starts its queue only after a turn that completed, and after a `!` command's turn.
- **Client change** - each backend's `unqueue` and `reorder` start the head, which starts nothing while a turn runs.
- **Hold** - `startNext` starts nothing while the latest turn is a resumable failure, in Claude, pi and cofold, the backends that write one.
- **Layer responsibilities** - sdk: the hold's rule · agent-claude, agent-pi, agent-acp, agent-cofold, bot, examples: where their queue starts.
- **Source-of-truth files** - [`code://packages/sdk/src/sessions/catalog.ts`](../../../../packages/sdk/src/sessions/catalog.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A stop holds the queue](task-01-a-stop-holds-the-queue.md) | done | - |
| [02 - Only a success starts the queue](task-02-only-a-success-starts-the-queue.md) | done | 01 |

## Risks and tradeoffs

- A queue held after a failure waits until a client changes it or a later turn succeeds, as VS Code's host holds it.
- A message a client queues after a resumable failure waits there, as VS Code's host holds it.

## Resume state

- **Done so far:** tasks 01 and 02, 2026-11-03.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** Claude defers a start while its CLI owes an answer, and pi while it lets a stopped turn go.

## Final verification checklist

- [x] Each new case fails on `cde4dd6c` for the reason it names, and passes after the change.
- [x] The touched test files pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
