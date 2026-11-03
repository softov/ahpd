---
title: A turn sent while one runs takes its place
domain: host
status: built
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://feb72387 - the commit of ahpd this plan was checked at
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L358-L387 - the reducer replaces the active turn with the turn a start names, and keeps none of the one it replaced"
  - "https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L186-L188 - an ending ends only the active turn"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13429-L13435 - the reference host refuses a start only while a workspace changes"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1810-L1815 - and hands every other start to its turn service"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostTurnService.ts#L126-L172 - which admits it and sends it to the agent at once"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L486-L492 - the Claude agent's per-session serializer, held across a whole send"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2385-L2410 - a send queued on it"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L408-L434 - a send resolves when the matching result arrives"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2457-L2475 - an abort rejects the send in flight and frees the serializer for the next one"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L8720-L8750 - the Copilot agent queues each turn on the chat's sequencer"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L8081-L8095 - and an abort cancels the turns queued before it and stops the one running"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L870-L878 - an agent's signal goes to the chat's active turn, a permission included"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/localCommand/localCommandContribution.ts#L28-L41 - a `!` command the host is handed runs at once, before admission"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L87-L89 - a client's set on an idle chat starts the head of the queue"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L193-L195 - steering goes to the agent only while the chat has an active turn"
  - "https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L165-L173 - a client's removal of steering handed over has the provider withdraw it"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1356-L1392](../../../../packages/sdk/src/host/lifecycle.ts#L1356-L1392) - `beginOrRun`'s `run`, which refuses a start while the chat has an active turn"
  - "[code://packages/sdk/src/host/chatactions.ts#L396-L419](../../../../packages/sdk/src/host/chatactions.ts#L396-L419) - the wait for a stopped turn's end"
  - "[code://packages/sdk/src/host.ts#L873-L880](../../../../packages/sdk/src/host.ts#L873-L880) - `stopping`, and `letGo` settled by a backend's end of a turn the chat ended"
  - "[code://packages/agent-claude/src/session/turns.ts#L619-L633](../../../../packages/agent-claude/src/session/turns.ts#L619-L633) - Claude's `begin`, which refuses a turn while one runs or begins"
  - "[code://packages/agent-cofold/src/turns.ts#L527-L566](../../../../packages/agent-cofold/src/turns.ts#L527-L566) - cofold's `beginTurn`, which refuses a turn that finds one running after the lookup"
  - "[code://packages/agent-pi/src/session.ts#L1361-L1374](../../../../packages/agent-pi/src/session.ts#L1361-L1374) - pi's `begin`, which queues a turn sent while one runs"
  - "[code://packages/agent-acp/src/session/queue.ts#L169-L195](../../../../packages/agent-acp/src/session/queue.ts#L169-L195) - ACP's `begin`, which drops a turn sent while one runs"
  - "[code://packages/bot/src/chat.ts#L1046-L1052](../../../../packages/bot/src/chat.ts#L1046-L1052) - the bot's `begin`, which queues a turn sent while one is open"
  - "[code://examples/echo/agent.ts#L149-L211](../../../../examples/echo/agent.ts#L149-L211) - the echo example's turn, whose run ends whatever turn is active then"
  - ".project/problems/a-backend-keeps-a-steer-the-client-took-back.md - the problem filed for a steer a backend keeps after a client took it back"
---

## Goal

A `chat/turnStarted` a client sends while a turn runs is taken, as VS Code's host takes it.
Its start is said at once, so it takes the running turn's place in every client's state, as the protocol's reducer replaces the active turn.
The backend runs it once the work in front of it is done, as VS Code's agents run each turn in turn.
An action a client sends after a stop is applied at once, with no wait for the backend to let the stopped turn go.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `git grep -n "A turn is running in this chat"` - the host's refusal, Claude's `begin`, cofold's `beginTurn`, and the cases and docs that name them.
- `git grep -n "letGo\|stopping"` in `packages/sdk/src` - the wait for a stopped turn's end and the dispatch that settles it.
- `begin:` in every backend and example - what each does with a turn handed while one runs.
- VS Code at `a4e689ae`: `handleTurnStarted`, `startTurn` (agentHostTurnStarter.ts), `incomingRequest` in every chat contribution, `sendMessage` in the Claude and Copilot agents, and `_abortSession` in both.

### What VS Code's agents do with a turn handed while one runs

- The host applies the client's start and hands it to the agent at once.
  No contribution refuses it for a turn running; turnAdmissionContribution refuses only a read-only chat.
- The Claude agent queues the send on a per-session serializer held across the whole send.
  The new prompt goes to the SDK once the one in flight has its result.
- The Copilot agent queues the send on the chat's sequencer, and an abort cancels the turns queued before it.
- Neither aborts the running turn.
- The Claude agent's later output names the replaced turn, so the reducer drops it; a permission it asks for goes to the chat's active turn.
- The Copilot agent moves its one current turn to the new one, and the SDK runs the new prompt after the running one.
  That is its SDK's own queue, so the Claude agent's way is the one built here.

### Runtime path

```
chat/turnStarted while a turn runs -> chatactions.ts -> beginOrRun -> Session.begin
  -> the backend says the start at once -> every client's reducer replaces the active turn
  -> the backend runs the turn once the work in front of it is done
chat/turnCancelled of that turn -> Session.cancel -> the work in flight stops, the turns waiting go
```

### Gaps

- The host refuses a start while a turn runs, a `!` command's too.
- Claude refuses one through `handed`, cofold one that finds a turn running after its lookup.
- pi and the bot queue it as a pending message, and ACP drops it.
- The host holds a chat's action sent after a stop until the backend lets the stopped turn go.
- A steering message a stopped run still holds runs later, though a client took it back after the stop.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The reducer replaces the active turn with the started one and keeps none of the one it replaced | [reducer.ts#L358-L387](https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L358-L387) | 01 |
| The protocol's validation table has no row for a start while a turn runs, and no VS Code client sends one, so VS Code's host is the reference | the ledger's derivation of B, judged 2026-11-03 | 01 |
| VS Code's host refuses a start only while a workspace changes, and otherwise hands it to the agent at once | [agentService.ts#L13429-L13435](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13429-L13435); [agentSideEffects.ts#L1810-L1815](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1810-L1815); [agentHostTurnService.ts#L126-L172](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostTurnService.ts#L126-L172) | 01 |
| The Claude agent sends a prompt once the one in flight has its result: "two ordered sends" | [claudeAgent.ts#L486-L492](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L486-L492); [claudeSdkPipeline.ts#L408-L434](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L408-L434) | 01 |
| A stop stops the work in flight and drops the turns queued before it | [copilotAgent.ts#L8081-L8095](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L8081-L8095); [claudeAgent.ts#L2457-L2475](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2457-L2475) | 01 |
| A permission the replaced turn asks for goes to the chat's active turn | [agentSideEffects.ts#L870-L878](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L870-L878) | 01 |
| A `!` command the host is handed runs at once | [localCommandContribution.ts#L28-L41](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/localCommand/localCommandContribution.ts#L28-L41) | 01 |
| A turn a client sends after a stop goes to the agent at once, behind the abort; a message set on an idle chat starts the head of the queue at once | [agentHostTurnService.ts#L126-L172](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostTurnService.ts#L126-L172); [queueDrainContribution.ts#L87-L89](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L87-L89) | 01 |
| Steering goes to the agent only while the chat has an active turn; a client's removal of steering handed over has the provider withdraw it | [queueDrainContribution.ts#L193-L195](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L193-L195); [queueDrainContribution.ts#L165-L173](https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L165-L173) | 01 |
| Plan 87's refusal rests on a person's choice, and the failure its goal measured is the reducer's own replacement | `.project/plans/host/87-a-turn-is-refused-while-one-runs/plan.md`; the ledger's judgment of B | 01 |
| The wait for a stopped turn's end was added because the backends refused a turn while they held one, and a message queued then waited for an end that never came | the 20261102-0759 plan's task 08 | 01 |

## Proposed architecture

- **State flow** - each backend keeps the turns it was handed while one ran, said at once.
  The last one said is the chat's active turn.
  The turn whose work is in flight runs on, and its end is in no history.
- **Layer responsibilities** - sdk: `beginOrRun` hands every start to its backend, and the stopped-turn wait goes.
  The sdk hands steering to a backend only while the chat holds a running turn.
  Each backend: `begin`, `ran`, `cancel`, the start of the next turn, and the end of a replaced one.
- **Source-of-truth files** - [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts), and each backend's turn area.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A turn sent while one runs is taken](task-01-a-turn-sent-while-one-runs-is-taken.md) | done | - |

## Risks and tradeoffs

- A replaced turn's work runs on to its end, as VS Code's agents run it.
  A permission it asked for before it was replaced is in no client's state, and waits until a stop.
- pi, cofold, ACP and the bot run a `!` command sent while a turn runs once that turn ends.
  Their command turn takes the slot their agent's turn runs in; Claude runs it at once.
- Claude takes up a message queued after a stop when its CLI has answered the stopped prompt.

## Resume state

- **Done so far:** task 01, 2026-11-03.
- **Next action:** none; see [implemented.md](implemented.md).
- **Open questions:** none.
- **Watch out for:** a turn still switching its model, whose start is said once the switch answers.

## Final verification checklist

- [x] Each new case fails on `feb72387`'s sources and passes after the change.
- [x] The touched packages' test files pass, one file at a time.
- [x] `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.
