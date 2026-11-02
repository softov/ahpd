---
title: Terminal input goes to every client of the terminal
domain: host
status: built
priority: high
created: 2026-11-02
revalidated: 2026-11-02
refs:
  - git://89ebe4d5 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/subscriptions.md#L140-L143 - terminal actions go to every client subscribed to the terminal's URI"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/terminal-channel.md#L110-L112 - input is a side-effect-only client action of the terminal"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L13629 - a client's terminal action is handed to the state manager as the client sent it"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2750-L2752 - which applies it and emits it"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3079-L3091 - the envelope takes the next serverSeq and carries the client's origin"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L224-L233 - the terminal manager writes the input as the envelope is emitted"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L748-L749 - every emitted envelope is recorded and broadcast"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4215-L4253 - recorded in the replay buffer, then sent to every client it is relevant to"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4547-L4569 - a client with an active subscription to the channel"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L768 - a rejection is recorded and broadcast the same way"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/workbench/contrib/terminal/browser/agentHostPty.ts#L261-L325 - the terminal a window draws acts on no `terminal/input`"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/common/state/agentSubscription.ts#L653-L675 - a terminal subscription holds no pending action"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/workbench/contrib/terminal/browser/agentHostOutputChannel.ts#L71-L88 - the terminal's output channel moves nothing on input"
  - "https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/chatTerminalOutputTextModelContentProvider.ts#L114-L140 - and neither does a chat's view of the terminal"
  - "[code://packages/sdk/src/host/actions.ts#L878-L893](../../../../packages/sdk/src/host/actions.ts#L878-L893) - input answered to its sender alone through `echoTo`, and its refusal said `alone`"
  - "[code://packages/sdk/src/host.ts#L1170-L1241](../../../../packages/sdk/src/host.ts#L1170-L1241) - `refuse` and `echoTo`"
  - "[code://docs/sdk/AHP.md#L760-L765](../../../../docs/sdk/AHP.md#L760-L765) - input as the one accepted action that goes to its sender alone, and the reason"
---

## Goal

A client's `terminal/input` that the terminal takes is sequenced, held for replay and sent to every client subscribed to the terminal.
The sender's copy carries its origin, as every accepted action does.
Input the terminal cannot take is refused to the same clients, and held for replay.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "echoTo" packages/sdk/src docs` - terminal input is the one caller of `echoTo`.
- `rg -n "terminal/input" packages/sdk/test` - the host-terminals cases assert input stays with its sender.
- `AHP.md` gives the reason for the sender's audience: another client never holds a password typed at a prompt, and neither does the replay buffer.
- VS Code main at `58a595f7` applies a client's terminal input, emits it with the next `serverSeq`, records it and broadcasts it.
- The terminal a VS Code window draws, its output channel and a chat's view of it act on no other client's input.

### Runtime path

```
dispatchAction terminal/input -> actions.ts -> terminal.write
  -> taken: dispatch -> emit -> every client subscribed to the terminal, and the replay buffer
  -> not taken: refuse -> emit -> the same clients, and the replay buffer
```

### Gaps

- The specification sends every terminal action to every client of the terminal, and VS Code's host does the same with input.
- This host answers input to its sender alone and keeps it out of the replay buffer.
- No VS Code window acts on another client's input or shows it, so a VS Code client cannot tell the two apart.
- So the specification's audience is the one to follow.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Input the terminal takes goes to every client subscribed to the terminal, at the next `serverSeq`, and is held for replay | [subscriptions.md#L140-L143](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/subscriptions.md#L140-L143); [agentHostStateManager.ts#L3079-L3091](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3079-L3091); [protocolServerHandler.ts#L4215-L4253](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4215-L4253) | 01 |
| No VS Code window acts on another client's input, so the specification's audience decides | [agentHostPty.ts#L261-L325](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/workbench/contrib/terminal/browser/agentHostPty.ts#L261-L325); [agentSubscription.ts#L653-L675](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/common/state/agentSubscription.ts#L653-L675); [agentHostOutputChannel.ts#L71-L88](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/workbench/contrib/terminal/browser/agentHostOutputChannel.ts#L71-L88) | 01 |
| Input the terminal cannot take is refused to the clients the taken input reaches, and held for replay | [code://packages/sdk/src/host.ts#L1190-L1195](../../../../packages/sdk/src/host.ts#L1190-L1195), a refusal reaches who its accepted action reaches; [protocolServerHandler.ts#L768](https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L768) | 01 |
| `echoTo` goes, since input was its one caller | [code://packages/sdk/src/host/actions.ts#L890](../../../../packages/sdk/src/host/actions.ts#L890) | 01 |
| `AHP.md` says input goes to every client of the terminal | [code://docs/sdk/AHP.md#L323](../../../../docs/sdk/AHP.md#L323) | 01 |

## Proposed architecture

- **Event flow** - taken input goes through `dispatch`, as every other accepted terminal action does.
- **State flow** - `emit` sequences it and holds it for replay; the terminal's reducer leaves the state as it was.
- **Layer responsibilities** - `actions.ts` sends input; `host.ts` and `context.ts` lose `echoTo`.
- **Source-of-truth files** - [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts), [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Input goes to every client of the terminal](task-01-input-goes-to-every-client-of-the-terminal.md) | done | - |

## Risks and tradeoffs

- Every client of a terminal receives what any client types into it, a password at a prompt that does not echo included.
- The replay buffer holds it too, so a client that reconnects within the buffer receives it.
- That is the reason `AHP.md` gives for the sender's audience, and VS Code's host sends input the same way.

## Resume state

- **Done so far:** task 01, 2026-11-02.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** a gate refusal stays with its sender; only the refusal of input itself moves.

## Final verification checklist

- [x] The two host-terminals cases fail on `89ebe4d5` for the audience they name, and pass after the change.
- [x] The touched suites pass.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
