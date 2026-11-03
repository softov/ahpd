---
title: Idle steering runs next in the order sent
domain: host
status: built
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://cde4dd6c - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13509-L13525 - steering to a provider that cannot take it is refused, idle or not, and an edit of held steering is refused, a queued set under its id included"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L245-L286 - the drain runs the first pending steering message next, ahead of queued ones"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/agentSessionMessage.ts#L17-L22 - pending steering, listed in the order the queue holds it"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/localCommand/localCommandContribution.ts#L30-L44 - a `!` command is run at a turn's admission, from the queue too"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L899-L919 - a steering set is the chat's `steeringMessage`, and its removal clears it"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L375-L384 - a turn naming a pending message takes it out"
  - "[code://.project/plans/host/20261102-1814-a-pending-message-runs-when-its-turn-comes/plan.md](../20261102-1814-a-pending-message-runs-when-its-turn-comes/plan.md) - the plan that runs an idle steering message as a turn of its own"
  - "[code://packages/sdk/src/host/chatactions.ts#L1437-L1515](../../../../packages/sdk/src/host/chatactions.ts#L1437-L1515) - a pending message, and the held steering message checked by kind"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1307-L1415](../../../../packages/sdk/src/host/lifecycle.ts#L1307-L1415) - `beginOrRun`, which queues a message or hands a command to `ran` with no kind"
  - "[code://packages/sdk/src/types/session.ts#L553-L692](../../../../packages/sdk/src/types/session.ts#L553-L692) - `Session.ran` and `Session.queue`"
  - "[code://packages/agent-claude/src/session/turns.ts#L635-L728](../../../../packages/agent-claude/src/session/turns.ts#L635-L728) - Claude's `ran` and `queue` append and say `queued`"
---

## Goal

A steering message sent while no turn runs is the next turn, ahead of every queued message, on a backend that takes steering.
Two of them run in the order they were sent.
A steering `!command` runs as a command in that place.
Each is said as a steering message while it waits.
A backend that takes no steering refuses a steering message, a turn running or not.
A queued message reusing the id of the steering message a running turn holds is refused.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "steering: true" packages/agent-*/src packages/bot/src` - every backend puts an idle steering message at the head of its queue.
- `rg -n "session.ran" packages/sdk/src/host/lifecycle.ts` - `beginOrRun` hands a command no kind.
- `rg -n "holding" packages/sdk/src/host/chatactions.ts` - only a steering set is checked against the held steering message's id.
- `rg -n "activeHeld !== undefined" packages/sdk/src/host/chatactions.ts` - the refusal of steering to a backend with no `steer` holds only while a turn runs.
- Main carries that exception and ACP's steering queue through `#195`, which merged round 2's union.

### What the sources say

VS Code's host refuses steering to a provider that cannot take it, idle or not, and refuses a set that changes held steering.

```ts
// agentService.ts L13512-L13524 at a4e689ae
			const existing = state?.queuedMessages?.find(message => message.id === id);
			if (action.type === ActionType.ChatPendingMessageSet && action.kind === PendingMessageKind.Steering && !this._providerService.getProviderForChat(sessionChannel, channel)?.sendSteeringMessage) {
				this._stateManager.rejectClientAction(channel, action, origin, 'The session provider does not support steering messages.');
				return;
			}
			// Steering handed to the provider cannot be edited, and can be removed only if the provider can withdraw it.
			if (state?.activeTurn && existing?.kind === PendingMessageKind.Steering
				&& (action.type === ActionType.ChatPendingMessageRemoved
					? action.kind === PendingMessageKind.Steering && !this._providerService.getProviderForChat(sessionChannel, channel)?.withdrawSteeringMessage
					: action.kind !== existing.kind || !equals(existing.message, action.message))) {
				this._stateManager.rejectClientAction(channel, action, origin, 'Cannot change a steering message while it is being processed.');
				return;
			}
```

Its drain takes the first pending steering message ahead of the queued ones, and lists pending steering in the order the queue holds it.

```ts
// queueDrainContribution.ts L266-L267 at a4e689ae
		// Steering that arrived too late to steer a turn runs next, ahead of queued messages.
		const message = steering[0] ?? state.queuedMessages?.find(message => message.kind !== PendingMessageKind.Steering);
// agentSessionMessage.ts L17-L22 at a4e689ae
/** Lists pending steering once, preferring the mixed queue over its legacy mirror. */
export function getPendingSteeringMessages(state: Pick<ChatState, 'steeringMessage' | 'queuedMessages'>): readonly PendingMessage[] {
	const steering = state.queuedMessages?.filter(message => message.kind === PendingMessageKind.Steering) ?? [];
	const legacy = state.steeringMessage;
	return legacy && !state.queuedMessages?.some(message => message.id === legacy.id) ? [legacy, ...steering] : steering;
}
```

VS Code's own reducer appends each set to one queue and mirrors the latest steering set as `steeringMessage` (reducer.ts L886-L903 at a4e689ae).
So two idle steering messages both run there, the first first.
A turn the drain admits passes the local command contribution, which runs a `!` command whether the turn came from the queue or not.
The types and reducers here are the specification's, whose reducer holds one `steeringMessage`, the latest steering set.

```ts
// types/channels-chat/reducer.ts L899-L903 at spec/v1.0.0
    case ActionType.ChatPendingMessageSet: {
      const entry: PendingMessage = { id: action.id, message: action.message };
      if (action.kind === PendingMessageKind.Steering) {
        return { ...state, steeringMessage: entry };
      }
```

### Runtime path

```
client chat/pendingMessageSet steering
  backend has no steer -> refused, "This backend cannot take a message mid-turn"
  a turn runs -> session.steer
  nothing runs -> beginOrRun -> session.queue or session.ran, with the kind
    -> behind the steering already waiting, ahead of every queued message, said as steering
client chat/pendingMessageSet queued under the held steering message's id, a turn running -> refused
```

### Gaps

- An idle steering message waits at the tail of the backend's queue, said as a queued message.
- Round 2 put it at the head, so a second one went ahead of the first.
- An idle steering `!command` is handed to `ran` with no kind, and waits at the tail as queued.
- A queued set reusing the held steering message's id goes on to the backend.

## Answers

| What | Source | Task |
| --- | --- | --- |
| C1: steering to a backend with no `steer` stays refused with nothing running, as now on main | [agentService.ts#L13513-L13516](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13513-L13516) | 01 |
| An idle steering message goes ahead of every queued message in Claude, pi, cofold, the bot and the nested proxy, and is said as steering | [queueDrainContribution.ts#L266-L267](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L266-L267); [reducer.ts#L899-L919](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L899-L919) | 01 |
| `Session.queue` takes the pending message's kind | `(defaulted: the protocol's word for the two kinds, carried to the backend that orders them)` | 01 |
| C2: a steering message goes behind the steering already waiting, so they run in the order sent | [agentSessionMessage.ts#L17-L22](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/agentSessionMessage.ts#L17-L22) | 02 |
| C2: a backend shows the latest steering message it was set as the chat's `steeringMessage` | [reducer.ts#L899-L903](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L899-L903) | 02 |
| C2: `Session.ran` takes the kind too, and a steering `!command` waits as steering and runs as a command | [queueDrainContribution.ts#L266-L267](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L266-L267); [localCommandContribution.ts#L30-L44](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/localCommand/localCommandContribution.ts#L30-L44) | 02 |
| C2: while a turn runs, a set reusing the held steering message's id is refused when its kind or its message differs | [agentService.ts#L13517-L13524](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13517-L13524) | 02 |

## Proposed architecture

- **Host** - `beginOrRun` hands the kind to `queue` and to `ran`; the held steering check reads the id whatever the kind.
- **Backends** - a steering entry goes after the last steering entry waiting; the chat shows the latest one set.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A backend that takes no steering refuses it](task-01-idle-steering-runs-ahead.md) | done | - |
| [02 - Steering runs in the order sent](task-02-steering-runs-in-the-order-sent.md) | done | 01 |

## Risks and tradeoffs

- The specification's reducer holds one steering message, so a client that set two sees the latest until it runs or goes.

## Resume state

- **Done so far:** tasks 01 and 02, 2026-11-03.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** the examples and ACP take no steering, so the host refuses it before their queues.

## Final verification checklist

- [x] Each new case fails on `cde4dd6c` for the reason it names, and passes after the change.
- [ ] The touched test files pass.
- [ ] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
