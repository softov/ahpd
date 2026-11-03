---
title: A stop names its turn
domain: host
status: built
priority: high
created: 2026-11-03
revalidated: 2026-11-03
changes:
  - specs/sessions-and-chats.md
refs:
  - git://a8eff676 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/actions.ts#L458-L461 - `ChatTurnCancelledAction.turnId` is a required field, \"Turn identifier\""
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L186-L188 - the chat reducer ends a turn only when the id the action names is the active turn's"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L274-L283 - the chat reducer completes a call only in the turn the action names"
  - "https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L345-L359 - the validation table, which has no row for an action that names no turn"
  - "https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L13530-L13535 - a stop whose `turnId` is not the active turn's is applied as sent and aborts nothing, matched before reduction"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13641-L13647 - a client's action is dispatched as the client sent it"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L2030-L2035 - a VS Code chat's stop names its turn"
  - "[code://packages/sdk/src/host/chatactions.ts#L1380-L1427](../../../../packages/sdk/src/host/chatactions.ts#L1380-L1427) - a stop, checked against the turn the chat runs"
  - "[code://packages/sdk/src/host/chatactions.ts#L642-L654](../../../../packages/sdk/src/host/chatactions.ts#L642-L654) - `stopped`, the stop said when it is taken"
  - "[code://packages/sdk/src/host/chatactions.ts#L2127-L2179](../../../../packages/sdk/src/host/chatactions.ts#L2127-L2179) - a client's tool result, said once the backend takes it"
  - "[code://.project/plans/host/20261102-1133-a-cancel-of-no-active-turn-is-echoed/plan.md](../20261102-1133-a-cancel-of-no-active-turn-is-echoed/plan.md) - the answer this plan reverses: a stop naming no turn named the running one"
  - "[code://.project/specs/sessions-and-chats.md#L87-L101](../../../specs/sessions-and-chats.md#L87-L101) - a stop of no running turn"
---

## Goal

A client's stop stops the turn its `turnId` names, and nothing else.
A stop that names no turn goes to every client of the chat as the client's own action, and stops nothing.
A client's tool result goes to every client as the client sent it, in the turn it names.
The host infers no turn for an action whose client named none.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "names no turn" packages docs .project/specs` - the host's stop case, `AGENT.md`, `AHP.md`, the sessions spec, and three cases that send `turnId: ''`.
- `rg -n "turnId: typeof action.turnId" packages/sdk/src` - the tool result's echo takes the running turn's id when the client sent none.
- `rg -n "type: 'chat/toolCallComplete', toolCallId" packages/*/test` - cases that send a client's result with no `turnId`.

### What the sources say

The protocol's type requires the turn.

```ts
// types/channels-chat/actions.ts L458-L461 at spec/v1.0.0
export interface ChatTurnCancelledAction {
  type: ActionType.ChatTurnCancelled;
  /** Turn identifier */
  turnId: string;
```

Its reducer ends only the turn a stop names, and completes a call only in the turn a result names.

```ts
// types/channels-chat/reducer.ts L186-L188 at spec/v1.0.0
  if (!state.activeTurn || state.activeTurn.id !== turnId) {
    return state;
  }
// types/channels-chat/reducer.ts L281-L283 at spec/v1.0.0
  if (!activeTurn || activeTurn.id !== turnId) {
    return state;
  }
```

The validation table names no action that leaves out its turn (chat-channel.md L349-L359).
VS Code's host matches a stop to the active turn before it stops anything, and says any other stop as sent.

```ts
// agentService.ts L13530-L13535 at 37eba093
		if (action.type === ActionType.ChatTurnCancelled) {
			// Match the turn before reduction so stale no-ops cannot trigger a chat-wide abort.
			if (this._stateManager.getChatState(channel)?.activeTurn?.id !== action.turnId) {
				this._logService.trace(`[AgentService] Ignoring cancellation of an inactive turn: channel=${channel}, turnId=${action.turnId}`);
				this._stateManager.dispatchClientAction(channel, action, origin, clientContext);
				return;
```

A VS Code chat names the turn it stops (agentHostSessionHandler L2030-L2035), so no VS Code client sends a stop without one.
The protocol's text then decides: the field is required, and the reducer ends only the turn named.
It is silent on a host's answer to an action without the field, so VS Code's host is the reference.
That host dispatches a client's action as sent, and a stop naming no active turn aborts nothing.

```ts
// agentService.ts L13641 at a4e689ae
		const dispatch = () => this._stateManager.dispatchClientAction(channel, action, origin, clientContext);
```

### Runtime path

```
client chat/turnCancelled -> chatAction
  turnId is the running turn's -> said when taken, the backend told after
  any other turnId, or none -> said as sent, nothing stopped
client chat/toolCallComplete -> the backend takes it -> said as sent
```

### Gaps

- A stop that names no turn stops the running turn, and is said under that turn's id.
- A client's tool result that names no turn is said under the running turn's id.
- `AGENT.md` and the sessions spec describe the stop that names no turn as a stop of the running one.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A stop stops the turn its `turnId` names, on a lead chat and a worker's chat | [agentService.ts#L13530-L13535](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L13530-L13535); [reducer.ts#L186-L188](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L186-L188) | 01 |
| A stop that names no turn goes to every client as the client's own action, and reaches no backend | [agentService.ts#L13530-L13535](https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L13530-L13535); [actions.ts#L458-L461](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/actions.ts#L458-L461) | 01 |
| A client's tool result is said as sent, its `turnId` included or left out | [agentService.ts#L13641-L13647](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13641-L13647); [reducer.ts#L274-L283](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L274-L283) | 01 |
| The cases that sent a client's result with no turn send the turn its call is in, as a client does | [actions.ts](https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/actions.ts) | 01 |

## Proposed architecture

- **Validation** - a stop reaches a backend only when its `turnId` is the held running turn's id.
- **Echo** - a stop and a tool result go out as the client sent them, and the host fills a stop's missing `duration`.
- **Source-of-truth files** - [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A stop stops the turn it names](task-01-a-stop-stops-the-turn-it-names.md) | done | - |

## Risks and tradeoffs

- A client that sends a stop with no turn sees its turn run on, as a VS Code client would on VS Code's host.
- A client's result with no turn leaves its call running in every client's state until the turn ends.

## Resume state

- **Done so far:** task 01, 2026-11-03.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** the host fills a stop's missing `duration`, which this plan keeps.

## Final verification checklist

- [x] Each new or changed case fails on `a8eff676` for the reason it names, and passes after the change.
- [x] The touched test files pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
