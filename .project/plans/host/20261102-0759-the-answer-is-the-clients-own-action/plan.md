---
title: The answer is the client's own action, on its channel, in its order
domain: host
status: built
priority: high
created: 2026-11-02
revalidated: 2026-11-02
requires:
  - plans/host/20261102-0618-every-dispatch-is-answered-once-by-its-own-action/plan.md
refs:
  - git://c3c8c3e4 - the commit this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/actions.md#L54-L56 - an action travels on the channel its prefix names; the server applies a client's action and then runs its side effect"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md#L7-L24 - a client holds its actions pending per subscription and matches an echo at the head of that list"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md#L60 - the server's echo wins"
  - "https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2745-L2752 - the reference host emits a client's own action with its origin"
  - "https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/platform/agentHost/node/agentService.ts#L13526-L13537 - the reference host takes a client's cancel into its state before the side effect"
  - "https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/platform/agentHost/node/agentService.ts#L13625-L13650 - the reference host says a client's action, then runs the side effect"
  - "https://github.com/microsoft/vscode/blob/8fb60541db0e1a371ea40157e0f58951ae4a485d/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L8015-L8025 - the reference client renames a chat with `session/titleChanged` on the chat's channel"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `answering`, `owed`, `applyNow`"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts) - a backend's action on its way out"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - the stop, the client's tool result, the rename"
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts) - the channel an action came on"
  - "[code://packages/sdk/src/host/lifecycle.ts](../../../../packages/sdk/src/host/lifecycle.ts) - `beginOrRun`, one turn at a time"
---

## Goal

A client's action is answered on the channel it was sent on, by the action it sent.
A backend decides when a turn starts or a message is queued, and the answer then carries what the client sent.
A stop and a client's tool result are said when the host takes them, before the backend acts on them.
A connection's answers go out in the order it sent its actions.
A config change is answered once, and an active client's entry is taken as sent.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "chatAbout|owedUnder|answering" packages/sdk/src/host.ts` - a session channel stands for its default chat, and an answer matches by type and turn alone.
- `rg -n "'chat/turnStarted'" packages/*/src` - six backends rebuild the turn start they say back.
- `rg -n "owe\(" packages/sdk/src` - a stop and a client's result wait for the backend.

### Runtime path

```
client chat/toolCallConfirmed {reason} -> backend confirm() -> backend's rebuilt confirmation
  -> the first action of that type is the echo -> the client's reason is lost
client chat/turnStarted, then chat/draftChanged -> the draft is said at once
  -> the turn start is said later, by the backend -> the answers come out of order
```

### Gaps

- An answer on another channel answers a dispatch, and a `chat/*` action on a session channel acts on the default chat.
- The echo is the backend's rebuilt action.
- A stop and a client's result are said when the backend lets go.
- Answers owed to a backend go out after later answers.
- A command sent as a turn while a turn runs is answered by a queued message.
- A config change is answered one key at a time, and one naming only unchanged keys is not answered.
- An active client's `clientId` is rewritten to the connection's.

## Answers

| What | Source | Task |
| --- | --- | --- |
| An action is answered on the channel it was sent on | reconciliation.md L7-L11; VS Code agentService.ts L13625 | 01 |
| A `chat/*` action off a chat's channel is refused | actions.md L54; chat-channel.md L82; no VS Code client sends one | 01 |
| A `session/*` action on a chat's channel of the session is answered on that channel | reconciliation.md L7-L11; VS Code baseAgentHostSessionsProvider.ts L8015-L8025, agentService.ts L13625 | 01 |
| An answer a backend says is the client's own action; a field the client left out is the backend's | VS Code agentHostStateManager.ts L2745-L2752; reconciliation.md L60 | 02 |
| A stop is said when the host takes it, then the backend is told; the backend's end of that turn is not said | VS Code agentService.ts L13526-L13537, agentSideEffects.ts L1921-L1955 | 03 |
| A client's tool result is said once the backend took it; the backend's result for that call is not said | VS Code agentService.ts L13625-L13650 | 03 |
| A connection's next action waits until the action a backend answers later is answered | reconciliation.md L23-L24; no VS Code client can tell the order | 04 |
| A turn asked for while one runs is refused, a command's too | commands.ts L573-L575; the chat holds one active turn; no VS Code client sends one | 05 |
| A config change is answered once, with every key it took, or refused whole | session actions.ts L603-L608; VS Code agentService.ts L13548-L13588 | 06 |
| An active client's entry is taken as sent; a field left out is the host's | VS Code agentService.ts L13625; no rule in the protocol | 07 |
| The `tools` filled into an entry that names none stays; recorded open | plugin/04 task-03 names only this repository's code | 07 |

## Proposed architecture

- **Data flow** - the host matches a backend's action to a client's dispatch by channel, type and the things it names, and says the client's action.
- **State flow** - a stop and a client's result reduce when they are taken; the backend's later word on them reduces to nothing.
- **Layer responsibilities** - sdk host: `host.ts`, `spawn.ts`, `chatactions.ts`, `actions.ts`, `lifecycle.ts`.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - an action is answered on its own channel](task-01-an-action-is-answered-on-its-own-channel.md) | done | - |
| [02 - the answer is the client's own action](task-02-the-answer-is-the-clients-own-action.md) | done | 01 |
| [03 - a stop and a result are said when taken](task-03-a-stop-and-a-result-are-said-when-taken.md) | done | 01 |
| [04 - answers go out in the order sent](task-04-answers-go-out-in-the-order-sent.md) | done | 01 |
| [05 - a turn asked while one runs is refused](task-05-a-turn-asked-while-one-runs-is-refused.md) | done | - |
| [06 - a config change is answered once](task-06-a-config-change-is-answered-once.md) | done | 01 |
| [07 - an active client set is taken as sent](task-07-an-active-client-set-is-taken-as-sent.md) | done | - |

## Risks and tradeoffs

- A client that sends a `chat/*` action on a session channel is refused; ahpd's own tests and clients send them on the chat.
- A backend that never answers a turn start holds its connection's next action for `WAIT_LIMIT` at most.
- A config change does not hold the next action: a backend may answer a key only as it is closed by a later start.

## Resume state

- **Done so far:** tasks 01 to 07, 2026-11-02; [implemented.md](implemented.md) says what was verified.
- **Next action:** none in this plan.
- **Open questions:** the `tools` an entry that names none is given; [implemented.md](implemented.md) records what each source says.
- **Watch out for:** a client's action without `startedAt` or a message origin; the backend's word fills them.

## Final verification checklist

- [x] Each new case fails on c3c8c3e4 and passes after the change.
- [x] `pnpm run typecheck` reports no errors.
