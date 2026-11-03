---
title: A stop ends the back session's turn
domain: bots
status: built
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://cde4dd6c - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1942 - a stopped chat's subagents are cancelled with their registrations kept"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1470-L1497 - each subagent's running turn is cancelled with its duration, the registrations stay, and the parent's pending subagent signals go"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L2030-L2035 - a client's cancel carries its own stopwatch's time, zero where it has none"
  - "[code://packages/bot/src/chat.ts#L1053-L1066](../../../../packages/bot/src/chat.ts#L1053-L1066) - a bot's stop ends its turn alone"
  - "[code://packages/bot/src/wake.ts#L441-L589](../../../../packages/bot/src/wake.ts#L441-L589) - the wake, which routes a back session's answer to the main turn by `answering`"
  - "[code://packages/bot/src/plugin.ts#L506-L523](../../../../packages/bot/src/plugin.ts#L506-L523) - the plugin's `look`"
  - git://020669b1 - the cancel, built for an earlier round on a branch upstream had merged, with the forgetting the audit found improvised
---

## Goal

A client's stop of a bot's turn stops the back session's running turn too, with the time the bot timed it.
The back session keeps its link to the main chat.
A message the stop finds still on its way to a back session is not sent.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "cancel:" packages/bot/src/chat.ts` - a stop ends the bot's open turn and tells the handle's holder.
- `rg -n "answering" packages/bot/src/wake.ts` - the link from each back session to the main turn it answers.
- The cancel itself is in main, merged as part of `#195`, and its stop deletes that link.
- `rg -n "delivering|woken" packages/bot/src/wake.ts` - nothing holds a message a stop finds on its way.

### What the sources say

VS Code's host, at a client's cancel, cancels the stopped chat's subagents and keeps their registrations.

```ts
// agentSideEffects.ts L1942 at a4e689ae
				this.cancelSubagentSessions(channel, { retainRegistrations: true });
```

Each subagent's running turn is cancelled with its duration, the registrations stay, and the parent's pending signals go.

```ts
// agentSideEffects.ts L1470-L1497 at a4e689ae
	cancelSubagentSessions(parentChatURI: ProtocolURI, options?: { retainRegistrations: boolean }): void {
		for (const subagent of this._subagentChats.getAll(parentChatURI)) {
			const turnId = this._stateManager.getActiveTurnId(subagent.chatUri);
			if (turnId) {
				this._stateManager.dispatchServerAction(subagent.chatUri, {
					type: ActionType.ChatTurnCancelled,
					turnId,
					duration: this._turnDuration(subagent.turnStopWatch),
				});
				this._completeTurn(subagent.chatUri, turnId, 'cancelled');
			}
			this._toolCallTracker.clearSession(subagent.chatUri);
			this._turnTracker.clearSession(subagent.chatUri);
		}
		if (!options?.retainRegistrations) {
			this._subagentChats.deleteAll(parentChatURI);
		}
		for (const [key, buffer] of this._pendingSubagentSignals) {
			if (buffer.parentChatUri === parentChatURI) {
				this._pendingSubagentSignals.deleteAndDispose(key);
			}
		}
```

The bot draws its back session's chat as the open turn's subagent call, so the back session is that turn's subagent.
The bot sends the cancel as a client of the back session.
A client's cancel carries its own stopwatch's time, zero where it has none (agentHostSessionHandler L2030-L2035).
The bot's link from a back session to the main turn is `answering`, the registration that routes the answer.
What the bot has pending at a stop is a message still on its way to a back session that is starting.

### Runtime path

```
client chat/turnCancelled -> the bot's cancel -> onStop -> wake.stopped
  each back session answering the stopped turn -> look -> chat/turnCancelled with the bot's time
  a message for the stopped turn still on its way -> not sent
```

### Gaps

- A bot's stop leaves its back session working, and the answer then lands on whatever turn is open next.
- Round 2's stop forgot the link for every back session answering the stopped turn.
- A message still on its way to a starting back session is sent after the stop.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A stop of a bot's turn cancels the running turn of each back session answering it | [agentSideEffects.ts#L1470-L1483](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1470-L1483) | 01 |
| The cancel carries the time the bot's clock gives for a back turn it began, and zero for one it did not | [agentHostSessionHandler.ts#L2030-L2035](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L2030-L2035) | 01 |
| R2-20: the back session's link to the main chat stays | [agentSideEffects.ts#L1484-L1486](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1484-L1486); L1942 | 02 |
| R2-20: a message for the stopped turn still on its way to a back session is dropped, and one whose send was under way has its turn cancelled | [agentSideEffects.ts#L1487-L1491](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1487-L1491) | 02 |

## Proposed architecture

- **Event flow** - the bot's `cancel` tells the handle's `onStop`; the plugin passes it to the wake.
- **State flow** - the wake keeps `answering`, and marks the deliveries in flight for the stopped turn.
- **Source-of-truth files** - [`code://packages/bot/src/wake.ts`](../../../../packages/bot/src/wake.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A stop cancels the back turn](task-01-a-stop-cancels-the-back-turn.md) | done | - |
| [02 - The link stays, and pending sends go](task-02-the-link-stays.md) | done | 01 |

## Risks and tradeoffs

- A back session's late answer to a stopped turn reaches a handle with no open turn, which does nothing.

## Resume state

- **Done so far:** tasks 01 and 02, 2026-11-03.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** a steer into a working back session overwrites its link with the steered turn.

## Final verification checklist

- [x] Each new case fails on `cde4dd6c` for the reason it names, and passes after the change.
- [x] The touched test files pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
