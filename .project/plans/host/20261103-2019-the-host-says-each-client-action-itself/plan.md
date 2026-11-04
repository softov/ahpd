---
title: The host says each client action itself, and hands its backends what VS Code's host hands its agents
domain: host
status: draft
priority: high
created: 2026-11-03
revalidated: 2026-11-03
refs:
  - git://b8b09872 - the commit of ahpd this plan was read at
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L12492-L12508 - the per-client dispatch queue and the prerequisites it waits for
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L12639-L12649 - a queued dispatch that fails is rejected with its own message
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13521-L13565 - the host's own checks before it applies a client's action
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13654-L13679 - the client's action said, then the side effects
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2737-L2751 - one call for a server's action, one for a client's
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2849-L2858 - the rewrites the host applies to any action it says
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2792-L2798 - the relay's own sequencer per client id
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1810-L1815 - a start goes to the turn service after it is said
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1921-L1955 - a cancel ends the turn, aborts the agent and drains nothing
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2226-L2244 - a turn's model and agent applied before the send, a refusal logged
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2307-L2316 - the last cancel check, then the prompt to the agent
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTurnService.ts#L142-L160 - admission after the echo, then the send
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTurnStarter.ts#L95-L111 - a turn refused at admission ends with chat/error
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L55-L326 - the host's queue, its steering hand-off and its drain
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/localCommand/localCommandContribution.ts#L28-L41 - a `!` command is the host's, for every agent
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1311-L1317 - sendMessage and abort, the calls a turn makes of an agent
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1943-L1957 - sendSteeringMessage, withdrawSteeringMessage and truncateChat
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2457-L2501 - the Claude agent's abort and its steering hook
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L412-L419 - a send after an abort or a crash rebinds the query
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L449-L497 - steering into the turn in flight, and the abort that fails every pending entry
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L704-L719 - a stream that ends without a result fails its sends
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/AGENTS.md?plain=1#L623-L625 - the steering contract between the host and its agents
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L3717-L3726 - what VS Code's client sends as a start
  - "[code://packages/sdk/src/host.ts#L822-L928](../../../../packages/sdk/src/host.ts#L822-L928) - today's echo by matching: `applying`, `owed`, `answering`, `originOf`, `answeredBy`"
  - "[code://packages/sdk/src/host.ts#L2160-L2260](../../../../packages/sdk/src/host.ts#L2160-L2260) - today's per-connection chain, `taken`, `awaited` and `bounded`"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1315-L1540](../../../../packages/sdk/src/host/lifecycle.ts#L1315-L1540) - `beginOrRun` and `beginTurn`, the road every message takes to a backend"
  - "[code://packages/sdk/src/types/session.ts#L587-L800](../../../../packages/sdk/src/types/session.ts#L587-L800) - the Session contract a backend implements"
---

## Goal

A client's action is said by the host itself, as the client sent it, once the host's own checks pass.
The backends are then handed only the calls VS Code's host makes of its agents.
The queue and the steering hand-off become the host's, drained where VS Code drains them.
ahpd's own features take each decision the way VS Code's host takes it for the same kind of thing.

## Reconnaissance

The VS Code files read are the `refs` above, at `6b68d3fe`, each read to the end of the function cited.
The audit rows this plan answers are named in *Gaps*, by their ids in the job's `tmp/audit-complete/rows-*.jsonl`.
The rows read the audit tree, main with six turn branches merged; this plan builds on main, whose names it uses.

### Searches performed

- `rg -n "dispatchClientAction|dispatchServerAction|_dispatchActionNow|_clientDispatchQueues" src/vs/platform/agentHost/node` - the echo and the per-client queue.
- `rg -n "sendSteeringMessage|withdrawSteeringMessage|setPendingMessages|abort\(" src/vs/platform/agentHost` - the steering contract and the stop.
- `rg -n "onTurnEnd|_syncPendingMessages|_tryConsumeNextQueuedMessage|_admitQueuedTurn" src/vs/platform/agentHost/node/chatContributions` - the drain.
- `rg -n "_cancelledTurnIds" src/vs/platform/agentHost/node/agentSideEffects.ts` - the cancel checks of a turn's send.
- The dispatch core's rows: A-0001 to A-0008, A-0026, A-0036 to A-0039, A-0051 to A-0053.
- The Session contract's rows: D-0024, D-0025, D-0031, D-0038, D-0050 to D-0053, D-0065 to D-0086.
- Claude's rows: E-0001, E-0006, E-0007, E-0011, E-0012, E-0017, E-0023, E-0032, E-0066.
- The flows' rows: H1-0009 to H1-0018, H1-0025 to H1-0029, H1-0036, H1-0037, H1-0044, H1-0045.
- The connection's rows: H2-0006, H2-0011 to H2-0013.

### Runtime path

```
today:  client action -> per-connection chain -> chatAction -> backend method -> what the backend says in that tick, or later -> matched as the echo
VS Code: client action -> per-client queue (prerequisites only) -> host checks -> dispatchClientAction (the echo) -> side effects -> agent calls
```

### Gaps

- The echo is whatever matches the dispatch being applied, a backend's rebuild included: A-0001, A-0005, A-0006, A-0007, A-0008, E-0001.
- A connection's later dispatches wait on a backend's answer, up to 60 s: A-0003, A-0004, H2-0011, H2-0012, H2-0013.
- A turn's admission, a machine's catch-up and a config restart hold the echo: A-0026, H1-0009, H1-0010, H1-0011, H1-0013, H1-0018.
- The Session contract lets a backend refuse what VS Code's host applies: D-0024, D-0025, D-0031, D-0050 to D-0053, A-0052, A-0053.
- Each backend keeps and drains its own queue: D-0038, H1-0025 to H1-0029, E-0006.
- Steering is handed once and never again; a stop lets the CLI run what it read: H1-0036, H1-0037, H1-0044, E-0017, E-0023.
- A stop does not stop a prompt still being prepared: H1-0045.
- The nested proxy holds the connection and drops a message's fields: H1-0014, H1-0015, D-0065 to D-0086.
- `!` commands are a backend's, and refused for two: D-0031, H1-0012, E-0007.

## Answers

| # | What | Source, the deciding lines quoted | Task |
| --- | --- | --- | --- |
| 1 | The host says a client's action itself, with the client's origin, after its own checks and before any side effect | agentService.ts L13654: `const dispatch = () => this._stateManager.dispatchClientAction(channel, action, origin, clientContext);` then L13679: `this._sideEffects.handleAction(channel, action, clientId, clientContext, resumedTurn, false, clientSeq, credentials);`; agentHostStateManager.ts L2745-L2747: "Dispatch a client-originated action (write-ahead from a renderer). The action is applied to state and emitted with the client's origin so the originating client can reconcile." | 01 |
| 2 | Everything a backend or a side effect says is the host's action, with no origin; nothing is matched as an echo | agentHostStateManager.ts L2737-L2738: `this._applyAndEmit(channel, action, undefined, undefined, credentials);` in `dispatchServerAction`; L2750-L2751: `dispatchClientAction(...) { return this._applyAndEmit(channel, action, origin, clientContext); }` | 01 |
| 3 | The host's own rewrites of an action it says are the only change to a client's action | agentHostStateManager.ts L2850-L2861: a chat's `provider` dropped, a session's `_meta` given its GitHub references (`action = { ...action, _meta: withAgentSessionGitHubReferences({ _meta: action._meta, workingDirectories })._meta };`), a cancel's fusion phases ended | 01 |
| 4 | The host's checks before the echo refuse with `rejectClientAction`; everything after the echo is state, not a refusal | agentService.ts L13526-L13528: "The session provider does not support steering messages."; L13531-L13535: "Cannot change a steering message while it is being processed."; L13555-L13560: a cancel of an inactive turn is said as sent ("Ignoring cancellation of an inactive turn") | 01 |
| 5 | A client's dispatches wait only for the host's own prerequisites, per client id, with no time limit | agentService.ts L12492-L12500: `requiresSessionRestore`, `requiresCredentialResolution`, `requiresPeerResolution`, `requiresKnownAttachmentRewrite`, `requiresReviewStateUpdate`, `requiresAnnotationsRestore`, `requiresWorkspacePin`; L12502-L12505: none of them and no queue, `_dispatchActionNow` at once; L12507: `const next = (pending ?? Promise.resolve()).then(async () => {` | 02 |
| 6 | A queued dispatch that fails is rejected with its own message | agentService.ts L12639-L12642: `this._stateManager.rejectClientAction(channel, action, { clientId, clientSeq }, toErrorMessage(err));` | 02 |
| 7 | A relay's dispatches are sequenced per relay client id, and only for a relay connection | protocolServerHandler.ts L2794-L2797: `if (client.transport.relayClientId !== undefined && this._config.relayResourceRoots) { return this._relayClientDispatchSequencer.queue(client.clientId, () => this._dispatchClientActionNow(client, params, checkAuthorization)); }` | 02, 09 |
| 8 | A start goes to the turn service after it is said; admission refuses with chat/error on the started turn | agentSideEffects.ts L1810-L1814: `case ActionType.ChatTurnStarted: { ... this._turnService.handleTurnStarted(channel, action, clientId, clientContext, credentials);`; agentHostTurnStarter.ts L95-L101: `if (disposition.kind === 'reject') { stateManager.dispatchServerAction(request.turnChannel, { type: ActionType.ChatError, ...` | 03 |
| 9 | A turn's model and agent are applied before its send; a model the agent does not offer is logged and the chat keeps its model | agentSideEffects.ts L2228-L2231: `if (message.model && !model) { this._logService.info(... keeps its model ...` ; L2236-L2238: `changeAgent(...).catch(err => { this._logService.error('[AgentSideEffects] changeAgent failed', err); })` | 04, 07 |
| 10 | A turn cancelled while the host prepares it never reaches the agent | agentSideEffects.ts L2241-L2244 and L2307-L2310: `if (this._cancelledTurnIds.get(turnChannel)?.has(turnId)) { await this._discardPendingTurnStartCheckpoint(...); return; }`; L2316: `await agent.chats.sendMessage(chatUri, ...)` | 03 |
| 11 | A cancel ends the turn, aborts the agent, and drains nothing | agentSideEffects.ts L1946-L1948: `agent.chats.abort(chat, ...)`; L1950-L1954: "Intentionally do NOT drain queued messages here: cancelling means \"stop\"" | 04, 05 |
| 12 | The agent's contract is sendMessage, abort, changeModel, changeAgent, resumeTurn and the optional steering hooks | agent.ts L1311: `sendMessage(chat: URI, prompt: string, ...): Promise<void>;`; L1317: `abort(chat: URI, context: AgentChatOperationContext): Promise<void>;` | 04 |
| 13 | Steering is handed one message at a time; false defers it; a promise of false hands it back | agent.ts L1943-L1947: "Hands off one independent submission without replacing the legacy slot; false defers until ready. A promise that resolves false hands the message back unsent, for example because the turn it was meant to steer ended first. The host then keeps it pending and runs it as the next turn." | 04, 05 |
| 14 | Handed steering is withdrawn only where the agent can; the host refuses the removal otherwise while a turn runs | agent.ts L1950-L1954: "Withdraws a steering message, previously handed off through sendSteeringMessage, that a client removed before the model received it. A message the model already received stays in its turn. Without this hook, the host rejects removing steering while a turn is active." | 04, 05 |
| 15 | The queue is the host's: it admits the next message only after a success or a local command, steering first, and never while the latest turn is a resumable failure | queueDrainContribution.ts L66-L68: `if (turn.reason.kind === 'success' \|\| turn.reason.kind === 'localCommand') { this._tryConsumeNextQueuedMessage(turn.channel); }`; L262-L267: "Steering that arrived too late to steer a turn runs next, ahead of queued messages." | 05 |
| 16 | The drain says a server start with a new turn id, the time, the message as held and `queuedMessageId`, then sends it | queueDrainContribution.ts L290-L297: `const turnId = generateUuid(); this._stateManager.dispatchServerAction(channel, { type: ActionType.ChatTurnStarted, turnId, startedAt: new Date().toISOString(), message, queuedMessageId: messageId, });` | 05 |
| 17 | Every pending steering message is handed to the agent while a turn is active: at the turn's start and on every later action of it, until taken | queueDrainContribution.ts L125-L130 (`case ActionType.ChatTurnStarted: ... this._syncPendingMessages(channel);`); L109-L116: on any other action while `state?.activeTurn`, `_syncPendingMessages` for steering not yet submitted; L193-L203: `if (!provider?.sendSteeringMessage \|\| !state.activeTurn) { return; } for (const message of pending) { ... provider.sendSteeringMessage(...)` | 05 |
| 18 | Steering handed back steers the active turn, or runs next once the chat is idle | queueDrainContribution.ts L230-L243: "The provider returned steering unsent because the turn it targeted ended; steer the current turn or run it next." | 05 |
| 19 | A cancelled end takes every pending steering message out with the host's own action | queueDrainContribution.ts L56-L63: `if (turn.reason.kind === 'cancelled') { ... for (const message of getPendingSteeringMessages(state)) { ... dispatchServerAction(turn.channel, { type: ActionType.ChatPendingMessageRemoved, kind: PendingMessageKind.Steering, id: message.id });` | 05 |
| 20 | A client's removal of submitted steering reaches the agent's withdraw | queueDrainContribution.ts L84-L86 and L165-L173: `provider?.withdrawSteeringMessage?.(URI.parse(channel), id);` | 05 |
| 21 | A pending message's sender is the host's, kept for its own use, and is not put into an action | queueDrainContribution.ts L77-L83: `this._context.memento(PendingSender, observed.channel, action.id).set({ clientId: observed.clientId, clientContext: observed.clientContext, ... })`; L321: `senderClientId: sender.clientId` handed to `sendTurnMessage` | 10 |
| 22 | A `!` command is the host's local command, for every agent, before admission | localCommandContribution.ts L28-L40: `const handled = this._localCommands.tryHandle({ turnChannel: request.turnChannel, turnId: request.turnId, text: request.message.text, }); ... return { kind: 'handled' };` | 06 |
| 23 | Claude's stop aborts the query, failing every entry the SDK has not yielded; the next send rebinds | claudeSdkPipeline.ts L487-L495: `this._abortController.abort(); this._queue.failAll(new CancellationError()); ... this._needsRebind = true;`; L415-L417: `if (this._needsRebind) { await this._rebindQuery('recover'); }` | 07 |
| 24 | Claude declines steering until its prompt is out, and folds it into the turn in flight | claudeAgent.ts L2494-L2498: `if (steeringMessage) { if (!target.hasActiveTurn) { return false; } target.injectSteering(steeringMessage); }`; claudeSdkPipeline.ts L454-L470: the steering entry inherits the in-flight prompt's turn id | 07 |
| 25 | A Claude stream that ends without a result fails its pending sends, and the next send rebinds | claudeSdkPipeline.ts L709: `throw new Error('Claude SDK stream ended without a result message');`; L716-L718: `this._queue.failAll(fatal); this._needsRebind = true;` | 07 |
| 26 | A turn handed while another runs is a send the agent runs after the one before it, and a failed send fails its own turn only | agentSideEffects.ts L1810-L1814 (each start handed when it comes); claudeSdkPipeline.ts L427-L435: each `send` pushes its own entry with its own `deferred: new DeferredPromise<void>()` | 07, 08 |
| 27 | A session another host runs is reached through a relay that forwards each frame as sent; the host running it applies and echoes | relayTransport.ts L123-L135: `const text = JSON.stringify(message); ... this._channel.relaySend(connectionId, text)` | 09 |
| 28 | Who sent a message is the host's own record, used to run it, and no action or state carries it | queueDrainContribution.ts L26: `const PendingSender = createChatMementoKey<IQueuedMessageSender \| undefined, [messageId: string]>('queueDrain.sender', () => undefined);`; L282-L284: "Drop the entry rather than blanking it"; agentHostStateManager.ts L2849-L2861: none of the host's rewrites adds a sender | 10 |
| 29 | A client tool's call carries the tool's own name | claudeMapSessionEvents.ts L637-L638 and L664-L676: the in-process client-tool prefix stripped from `toolName` | 12 |
| 30 | A confirmation shows the command the model wrote | claudeCanUseTool.ts L174: the permission request carries the tool's input as the model wrote it | 13 |
| 32 | A client's stop is said with the duration it sent; only a resumed turn's stop takes the duration the host measured | agentService.ts L13562-L13565: `const resumedDuration = this._sideEffects.getResumedTurnDuration(channel, action.turnId); if (resumedDuration !== undefined) { action = { ...action, duration: resumedDuration }; }`; agentHostSessionHandler.ts L3621-L3624: VS Code's client sends its stopwatch's time, 0 without one | 01 |
| 33 | What this plan builds takes the name AHP or VS Code gives the same thing: `sendMessage`, `abort`, `changeModel`, `changeAgent`, `resumeTurn`, `sendSteeringMessage`, `withdrawSteeringMessage`, `truncateChat` for a backend's calls; pending messages, queued and steering, for the chat's queue; the queue drain; a local command | agent.ts L1311, L1317, L1943-L1957 (the calls' names); queueDrainContribution.ts L29-L32: `/** Owns pending-message synchronization and decides when a queued turn can be admitted. */ export class QueueDrainContribution ... static readonly id = 'queueDrain';`; localCommandContribution.ts L14-L16: `export class LocalCommandContribution ... static readonly id = 'localCommand';` | 04, 05, 06 |
| 31 | A reconnect activates every restored channel in one step, with its replay or snapshot | protocolServerHandler.ts L1548-L1550 and L1579-L1583: restored subscriptions held inactive until every restore settles, then activated together | 11 |
| 34 | A `!` command that ran completes its call, a non-zero exit as `success: false` with no `error`; one that could not run completes with the error; its turn completes either way | bangLocalCommand.ts L141-L148: `: { success: false, pastTenseMessage: localize('agentHostBang.exited', "Command exited with code {0}", exitCode) };`; L124-L133: `pastTenseMessage: localize('agentHostBang.failed', "Failed to run command"), error: { message: err instanceof Error ? err.message : String(err) },`; localChatCommand.ts L212: `this._stateManager.dispatchServerAction(request.turnChannel, { type: ActionType.ChatTurnComplete, turnId: request.turnId, duration: Math.max(0, stopWatch.elapsed()) });` | 06 |
| 35 | The host's instructions for a turn go with its send, and every agent puts them in that turn's prompt | agentSideEffects.ts L2281-L2288: `const contribution = await this._chatContributions.outgoingTurn({ ... });` then `...(contribution.instructions?.length ? { hostInstructions: contribution.instructions } : {}),`; claudeAgentSession.ts L668: `getUserPromptAdditionalContext: () => this._hostInstructions?.join('\n\n'),` | 08 |

### Today's holds, and what VS Code keeps

| Hold today | VS Code's counterpart | Kept or gone | Task |
| --- | --- | --- | --- |
| The per-connection chain, `waiting` | The per-client queue, `_clientDispatchQueues`, keyed by client id (row 5) | Kept, keyed by client id | 02 |
| `taken` and `awaited`: a backend's later answer holds the next dispatch | None: "VS Code never holds a client's next action for an agent's or another host's answer" (A-0003, H2-0011) | Gone | 02 |
| `bounded`, `WAIT_LIMIT` 60 s | None: a queued step runs with no time limit (row 6) | Gone | 02 |
| A session's wake, its read from the catalogue | `requiresSessionRestore` (row 5) | Kept | 02 |
| A message's attachments written before it is applied | `requiresKnownAttachmentRewrite` (row 5) | Kept | 02 |
| A changeset's review state | `requiresReviewStateUpdate` (row 5) | Kept | 02 |
| A draft for a session not running, applied outside the chain (H2-0013) | A chat action on a session not restored enters the queue (row 5) | Kept, inside the queue | 02 |
| `restarting`: a config change that restarts the backend | None: the config is said at once and acted on in the turn's send (A-0051, H1-0013) | A turn said at once, the restart its preparation; the config's echo in 04 | 03, 04 |
| A turn's policy check before its echo | Admission after the echo (row 8) | Gone; the check is admission | 03 |
| A machine's catch-up before the echo | The turn's preparation after the echo, with cancel checks (rows 9, 10) | Gone; the catch-up is preparation | 03 |
| The root config port write | The state's apply before the echo (agentHostStateManager.ts L2745-L2752): the port's file is where the daemon's keys are held | Kept | 02 |
| The plan-read hold on a turn's end (C-0099) | None: an agent's end of a turn is said as it comes (agentSideEffects.ts L901-L917) | Gone | 02 |
| The relay sequencer | Per relay client id (row 7) | The nested proxy's carry, per client id | 09 |
| Claude's `deferred` drain behind an owed answer (E-0006, H1-0029) | None: the abort leaves nothing owed (row 23) | Gone | 05, 07 |

### Where the earlier items land

| Item | Lands in | Why |
| --- | --- | --- |
| 1, the echo said exactly as sent | 01 | The host says the client's action itself; no fill and no backend rebuild remain to change it |
| 2, the turns handed behind a refused start | 07, 08 | A handed start is a send of its own (row 26); a failed preparation ends that turn with chat/error and the next send goes on |
| 3a, Claude runs steering it read after a stop | 07 | The stop aborts the query (row 23) |
| 3b, steering while a turn prepares | 05, 07 | The host hands it again on each action of the active turn (row 17); Claude declines until its prompt is out (row 24) |
| 3c, idle steering when a turn becomes active | 05 | The host hands every pending steering message at the turn's start (row 17) |
| 3d, cofold's steering handed back | 05, 08 | `sendSteeringMessage` answers with a promise of false; the host steers the active turn or runs it next (row 18) |
| `Session.clearSteering` | Goes, in 04 | The host removes pending steering with its own actions (row 19); the abort drops what a backend holds (row 23) |
| `Session.withdraw` | Stays as `withdrawSteeringMessage`, in 04 | VS Code's provider call (row 14), the one host-to-backend call at a removal (rows 20, 33) |
| 4, `ahpd.sender` | 10 | VS Code's host keeps a message's sender for its own use and says it in no action (rows 21, 28): `ahpd.sender` goes from actions and state, and the gap goes with it |
| E-0011, a stream that ends without an error | 07 | The query fails its sends and the next send rebinds (row 25) |
| E-0032, a client tool named `mcp__ahp__<clientId>__<name>` | 12 | Independent of the echo; its own branch from main |
| E-0007, a queued `!` command said before the client's set | 01, 05, 06 | The client's set is said first (row 1), the drain admits it (row 16), and the host runs it (row 22) |
| E-0066, the shell's export lines in the confirmation | 13 | Independent of the echo; its own branch from main |
| H2-0006, a reconnect adding channels one at a time | 11 | The subscriptions activate together (row 31) |
| H2-0012 and H2-0013 | 02 | No time limit; a draft waits in the queue |
| F-0004, F-0083, F-0136, a queued start rebuilt by ACP, cofold or pi | 05, 08 | The drain says the start with the message as the client set it (row 16); each backend's queue goes |
| F-0007, F-0086, a queued `!` command started before the client's set | 01, 05, 06 | The client's set is said first (row 1), the drain admits it (row 16), and the host runs it (row 22) |
| F-0008, F-0087, F-0138, a `!` turn waiting behind a running turn | 06 | The host runs the command when its turn is admitted (row 22) |
| F-0010, F-0011, F-0089, F-0141, F-0142, a failed command recorded as an error | 06 | The call completes with the exit or the failure, and the turn completes (row 34) |
| F-0095, F-0153, F-0155, steering handed back or sent while a turn prepares, run as its own turn | 05, 08 | False defers and the host hands it again on the turn's next action (rows 13, 17); handed back, it steers the active turn (row 18) |
| F-0019, F-0116, F-0135, the turn's instructions never reaching ACP, cofold or pi | 08 | Each send carries them into that turn's prompt (row 35) |
| C-0019, C-0023, a backend holding an echo, and the echo filled with its fields | 01 | The host says the client's action itself (rows 1, 2) |
| C-0020, C-0021, a backend's background work and session activity dropped | 01 | A backend's action is the host's action (row 2); the session's activity is folded into its state |
| D-0051 to D-0053, a toggle, a server start and a background request refused after the echo | 01 | A refusal after the echo cannot be one (row 4) |

## Proposed architecture

- **Data flow** - a client's action passes the queue's prerequisites and the host's checks, is said with its origin, and its side effects call the backend.
- **Event flow** - a backend's actions are the host's, said with no origin; a turn's start for a queued message is the host's drain.
- **State flow** - the chat state holds the pending messages; the host drains them and hands steering; a backend holds only what it was handed.
- **Layer responsibilities** - sdk: the echo, the queue, admission, the drain, `!` commands. Each backend: sendMessage, abort, steering, withdraw, model, agent.
- **Source-of-truth files** - [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts), [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts), [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The host says the client's action](task-01-the-host-says-the-clients-action.md) | done | - |
| [02 - The queue waits for prerequisites only](task-02-the-queue-waits-for-prerequisites.md) | done | 01 |
| [03 - A turn is admitted after its echo](task-03-a-turn-is-admitted-after-its-echo.md) | done | 01 |
| [04 - The Session contract follows IAgent](task-04-the-session-contract-follows-iagent.md) | done | 01 |
| [05 - The host owns the queue and steering](task-05-the-host-owns-the-queue.md) | done | 04 |
| [06 - A `!` command is the host's](task-06-a-command-is-the-hosts.md) | done | 05 |
| [07 - Claude follows](task-07-claude-follows.md) | done | 04, 05 |
| [08 - cofold, pi, ACP and the bot follow](task-08-the-other-backends-follow.md) | done | 04, 05 |
| [09 - The nested proxy is a relay](task-09-the-nested-proxy-is-a-relay.md) | todo | 01, 02 |
| [10 - The sender stays the host's](task-10-the-sender-stays-the-hosts.md) | todo | 01 |
| [11 - A reconnect activates its channels together](task-11-a-reconnect-activates-together.md) | todo | - |
| [12 - A client tool's call names the tool](task-12-a-client-tool-names-the-tool.md) | todo | - |
| [13 - A confirmation shows the model's command](task-13-a-confirmation-shows-the-command.md) | todo | - |

## Risks and tradeoffs

- Every backend changes at once with the contract - tasks 04 to 09 land together, and the cases of each backend move with it.
- The cases that read a backend's echo change - a backend's rebuilt start is no longer the client's answer.
- Claude's stop kills the CLI, and the next turn resumes it - VS Code's Claude does the same (row 23).
- A background task the CLI runs ends with that stop - as it does under VS Code's abort.
- A start a policy refuses is said and then ended in error - VS Code's admission does the same (row 8).

## Resume state

- **Done so far:** the plan, from the audit's rows and VS Code at `6b68d3fe`, and tasks 01 to 07.
- **Next action:** [task-09-the-nested-proxy-is-a-relay.md](task-09-the-nested-proxy-is-a-relay.md).
- **Answered:**
  1. The afternoon's turn branches this plan replaces are dropped, not merged.
  2. What of them the plan does not touch is rebuilt on top of it.
- **Watch out for:** the nested proxy, whose inner host answers a client's action; it is the one road where the echo comes from elsewhere.
