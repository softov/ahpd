import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { chatReducer } from '@microsoft/agent-host-protocol';
import type { ChatAction, ChatState, ErrorInfo } from '@microsoft/agent-host-protocol';
import { CommandAutoApprover, DEFAULT_TERMINAL_AUTO_APPROVE_RULES, splitCommand } from '../access/commandautoapprover.js';
import type { CommandSplit, CommandSplitter, SensitiveEditLocation, TerminalAutoApprovePatterns, TerminalAutoApproveRules } from '../access/commandautoapprover.js';
import { RpcError, INTERNAL_ERROR } from '../rpc.js';
import { bag, reason } from '../utils/values.js';
import { computerId, computersFor } from '../machines/computers.js';
import { localPath, uriOf } from '../resources/fileuri.js';
import { deepFreeze, frozenCopy } from '../utils/frozen.js';
import { nestedAgent } from '../sessions/nested.js';
import type { NestedAsked } from '../sessions/nested.js';
import { idOf, uriFor, Status } from '../sessions/catalog.js';
import { meter } from '../usage/meter.js';
import { linkIn } from '../automations/calllinks.js';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../tools/clientcalls.js';
import { asSentAttachment } from './chatattachment.js';
import { chatUriFor, toolCallOfSubagentChat } from './channels.js';
import { buildSubagentChatUri, chatUriFormatOf, subagentChatUri } from '../vscode/chatminting.js';
import { findMcpChildId } from '../vscode/mcpcustomizations.js';
import { CLOSING, withSenderOn } from './common.js';
import { commandTurnKey, sessionFlag, startsRead } from './chatactions.js';
import {
  alwaysAsks, asksForTool, confirmationOptions, getAutoApproval as autoApprovalOf, isDeniedByPermissions, isForbiddenSnapshotWrite, managedDecision,
  permissionRulesOf,
} from './permissions.js';
import type { ToolApproval } from './permissions.js';
import { vscodeRootProperties } from '../vscoderootconfig.js';
import { PENDING_CONFIRMATION_FIELDS } from '../types/agent.js';
import type { PendingConfirmation } from '../types/agent.js';
import { sameFolder, trusted } from './trust.js';
import { isWorktreeUnderRepository } from '../repo/worktrees.js';
import { BASELINE_TURN } from '../types/changes.js';
import type { Bag } from '../types/common.js';
import type { Agent, BoundTool, Start } from '../types/agent.js';
import type { TurnEndEvent, TurnEndReason } from '../types/events.js';
import type { Owner } from '../types/usage.js';
import type { Connection } from '../types/host.js';
import type { Session, SubagentChat, SubagentRequest } from '../types/session.js';
import type { MessageAttachment } from '@microsoft/agent-host-protocol';
import type { ResourceStore } from '../types/resources.js';
import type { MayRunTool, RunClientTool, ToolsChanged, ToolsEndpoint } from '../tools/server.js';
import { isWorkspaceless } from './lifecycle.js';
import { AGENT_HOST_WORKSPACELESS_INSTRUCTIONS } from '../vscode/workspacelessinstructions.js';
import type { Move } from './lifecycle.js';
import type { HostContext } from './context.js';
import type { Origin } from './state.js';

/**
 * What starting a backend's session is made of.
 *
 * The one place a backend session comes to life, together with the worker chats
 * it asks for: the call stamps a worker chat is linked by, the row a worker is
 * announced as, and the titles and harness a session is recorded under.
 */
export interface Spawn {
  /** Whether a tool call, or a tool call action, spawns a worker whose chat URI it does not carry yet. */
  unstamped(meta: unknown): meta is Bag;
  /** A tool call action with the worker chat's URI in its `_meta`. */
  withWorkerUri(chat: string, action: Bag): Bag;
  /** Every turn's tool calls stamped with this session's name where a client reduced the stamp. */
  stampedCalls(session: string, chat: string, turns: Bag[]): Bag[];
  /** Every turn marked with which client sent it, where the daemon's `turnSenders` says senders. */
  withSender(session: string, turns: Bag[]): Bag[];
  /** A turn's start carrying who sent it, where the daemon's `turnSenders` says senders. */
  withSenderSaid(action: Bag, sender: Owner): Bag;
  /** A chat's state with the attachments its clients sent back on its messages. */
  asSentChat(state: Bag): Bag;
  /** Write one action on a worker's chat. */
  sendSubagent(uri: string, given: Bag): void;
  /** Workers whose turn has been ended, so a second ending is not a second turn. */
  endedWorkers: Set<string>;
  /**
   * Raise `turn_end` for a turn of a session's chat, with who sent it where
   * `end` does not say, as VS Code's host offers its chat contributions each
   * turn's end at the place that ends it: its agent's end, a send that failed,
   * a start its admission refused, a local command run.
   */
  raiseTurnEnd(end: Omit<TurnEndEvent, 'type'>): void;
  /** The worker chat for one tool call of a backend's, made on first ask. */
  openSubagent(session: string, lead: string, toolCallId: string, request: SubagentRequest): SubagentChat;
  /**
   * The chat a call of `issuingChat` spawns a worker in, as VS Code's host
   * mints one: in the session's format, from the root of the conversation.
   */
  mintSubagentChatUri(session: string, issuingChat: string, toolCallId: string): string;
  /**
   * The session and the call a worker chat runs for, from the records: a
   * worker open here, or one a session's read record holds under the name
   * minted for it. Nothing for a chat no record names, as VS Code's host finds
   * a spawned chat's owner from the spawning call's records alone.
   */
  workerOf(chat: string): { session: string; toolCallId: string } | undefined;
  /** A chat of a session held as `<provider>:/<id>`, in the `ahp-session:/<id>` spelling it was built for, when it has one. */
  legacyChatUri(uri: string, chatUri: string): string | undefined;
  /** A chat's stored title. */
  titleOf(uri: string, chatUri: string): string | undefined;
  /** Persist a chat's title under its name. */
  persistChatTitle(uri: string, chatUri: string, title: string): void;
  /** Persist the title a session was given, beside its chats' own. */
  persistSessionTitle(uri: string, title: string): void;
  /** Record which harness a session runs on, under every id it answers to. */
  recordSessionProvider(uri: string, agent: Agent, session: Session): void;
  /**
   * Start one backend's session, and the worker chats it goes on to ask for.
   *
   * `sender` is the connection that sent the turn this start is for, when a
   * client sent it, whose principal is the start's `reader`.
   *
   * `askedInstructions` is what the request that asked for this session says,
   * added to `Start.instructions` after what the host's tools say. It is not
   * kept, so a session started again after a restart is not told it: what has
   * to hold for the whole life of a session belongs on a tool's instruction.
   *
   * `own` is the session's own backend and config, for a start that creates
   * the session with a chat whose config is not the session's: a chat another
   * backend serves, which a resume whose recorded default chat is one of those
   * starts and which lands on `Held.backends`, or a default chat that set
   * values of its own, which a resume and a restart start on them. The
   * session stays the one `own` names. Every other road starts the session's
   * own chat on the session's config, which says whose the session is by
   * itself.
   */
  spawn(
    agent: Agent,
    uri: string,
    chatUri: string,
    chatId: string | undefined,
    config: Record<string, unknown>,
    resuming?: { resume?: string; seed?: Bag[]; forkAt?: string; rewindAt?: string; context?: string },
    workingDirectory?: string,
    credentials?: Record<string, string>,
    additional?: string[],
    sender?: Connection,
    askedInstructions?: string[],
    own?: { agent: Agent; config: Record<string, unknown> },
  ): Promise<Session>;
  /**
   * Set every plugin plan's `changed` on the entry it closes over.
   *
   * Run at start and again from `replace`, because a plugin a live fold brings
   * holds an entry nothing has set this on yet.
   */
  wirePlan(): void;
  /** Complete the Plan call the host drew in a chat's turn, before that turn's end is said. */
  completePlan(chat: string, turn: string): void;
}

/**
 * Whether an action is one the protocol's chat reducer clears a chat's read
 * bit on: a turn that starts or is resumed, and a question put to a person.
 */
const clearsRead = (type: unknown): boolean =>
  type === 'chat/turnStarted' || type === 'chat/turnResume' || type === 'chat/inputRequested';

/**
 * The host's store, as one session's backend is handed it.
 *
 * A new object per session, frozen, whose every method calls the host's own -
 * so a backend that replaces `read` on what it was given changes its own view
 * and nothing else, while the bytes it reads are still the host's. The live
 * store is one object shared by every session and by the resource commands,
 * and a backend that reached into it would be changing what the next client
 * reads.
 *
 * The write half is the store's to offer or leave out, and this view offers
 * exactly what it holds: a store that cannot be written stays a read-only
 * store here rather than one that throws on every call.
 */
function heldResources(store: ResourceStore): ResourceStore {
  const taken: ResourceStore = {
    list: (uri) => store.list(uri),
    read: (uri, wanted) => store.read(uri, wanted),
    resolve: (uri, followSymlinks) => store.resolve(uri, followSymlinks),
    complete: (typed, base, limit) => store.complete(typed, base, limit),
  };
  const write = store.write;
  const erase = store.delete;
  const mkdir = store.mkdir;
  const move = store.move;
  const copy = store.copy;
  const watch = store.watch;
  if (write !== undefined) taken.write = (uri, content, owner, client, reader) => write(uri, content, owner, client, reader);
  if (erase !== undefined) taken.delete = (uri, recursive, owner, reader) => erase(uri, recursive, owner, reader);
  if (mkdir !== undefined) taken.mkdir = (uri) => mkdir(uri);
  if (move !== undefined) taken.move = (source, destination, failIfExists) => move(source, destination, failIfExists);
  if (copy !== undefined) taken.copy = (source, destination, failIfExists) => copy(source, destination, failIfExists);
  if (watch !== undefined) taken.watch = (uri, asked, onChange) => watch(uri, asked, onChange);
  return Object.freeze(taken);
}

export function createSpawn(ctx: HostContext): Spawn {
  const {
    options, sessions, byChat, subagents, owners, kept, names, births, moves, about,
    dispatch, log, described, links, restoredSessions,
    sessionHolding, dirOf, operationsMoved, refreshWatched, refreshFacts,
    fire, charged, senders, senderOf, sentBy, forgetSender, keysOf, forgetKeys, enteredIn, inMachine, bringBackOf,
    contributedDefaults, runningSchema, chatSummary, subagentSummary, markSummaryDirty, refreshSessionChangesSummary, setAgentModels,
    publishAccountInfo, updateChatMovability,
  } = ctx;
  ctx.turnSenders = options.turnSenders ?? 'said';
  ctx.steerReadBack = options.steerReadBack ?? 'inTurn';
  ctx.backendBackgroundWork = options.backendBackgroundWork ?? 'drop';

  /*
   * A turn's end, raised where it ends, on every chat a worker's among them,
   * with its sender read from the turn while the host holds it and from the
   * store once it has let it go, as VS Code's host offers its chat
   * contributions each turn's end on the channel the turn ran on.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatContributionsService.ts#L39-L49
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTurnStarter.ts#L95-L137
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/localCommands/localChatCommand.ts#L201-L221
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1127-L1152
   */
  const raiseTurnEnd = (end: Omit<TurnEndEvent, 'type'>): void => {
    const sender = end.sender ?? senderOf(end.turnId) ?? kept.sender(idOf(end.session), end.turnId);
    void fire({ ...end, type: 'turn_end', ...(sender === undefined ? {} : { sender }) });
  };
  /*
   * Why an action that ends a turn on `chat` ended it, as VS Code's host reads
   * its agent's ending actions: an error with the part's own error and its
   * `resumable`.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1127-L1152
   */
  const endingOf = (chat: string, action: Bag): TurnEndReason => {
    if (action.type === 'chat/turnCancelled') return { kind: 'cancelled' };
    if (action.type === 'chat/turnComplete') {
      return ctx.commandTurns.has(commandTurnKey(chat, String(action.turnId ?? ''))) ? { kind: 'localCommand' } : { kind: 'success' };
    }
    const part = (action.part ?? {}) as Bag;
    const failure = (part.error ?? {}) as Bag;
    return {
      kind: 'error',
      error: {
        errorType: typeof failure.errorType === 'string' ? failure.errorType : 'turnFailed',
        message: typeof failure.message === 'string' ? failure.message : 'The turn failed',
      },
      resumable: part.resumable === true,
    };
  };

  /** Whether a tool call, or a tool call action, spawns a worker whose chat URI it does not carry yet. */
  const unstamped = (meta: unknown): meta is Bag =>
    typeof meta === 'object' && meta !== null && (meta as Bag).toolKind === 'subagent'
    && (meta as Bag).subagentChatUri === undefined;
  /**
   * A tool call action with the chat it links in its `_meta`.
   *
   * The reference's `subagentChatUri`, stamped on a call's start, delta and
   * ready whose `_meta` says `toolKind` `subagent`, so a client can open the
   * worker's chat from the call before the chat is announced; the backend
   * never spells a worker chat URI, and this host does. A later action goes
   * out as the backend made it, as the reference sends it, and every other
   * action is returned as it is.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1038-L1043
   *
   * A call that carries a `subagent` content already says which chat it works
   * with, and that link is kept: a worker chat of this session is the URI
   * derived below, so nothing an ordinary worker does changes, while a chat of
   * another session - a bot's back session - is not one this session could
   * ever derive, and a worker chat named here would be a chat that does not
   * exist. The content on this action is read first, then what the index holds
   * from an earlier one, because a completion may carry no content at all.
   */
  const withWorkerUri = (chat: string, action: Bag): Bag => {
    if (action.type !== 'chat/toolCallStart' && action.type !== 'chat/toolCallDelta' && action.type !== 'chat/toolCallReady') return action;
    if (!unstamped(action._meta) || typeof action.toolCallId !== 'string') return action;
    const session = sessionHolding(chat);
    if (session === undefined) return action;
    const result = action.result as Bag | undefined;
    const linked = linkIn(action.content) ?? linkIn(result?.content) ?? links.linkOf(chat, action.toolCallId);
    const uri = linked ?? mintSubagentChatUri(session, chat, action.toolCallId);
    return { ...action, _meta: { ...action._meta, subagentChatUri: uri } };
  };
  /**
   * A backend's start of an MCP server's call, the server's customization
   * stamped on it where the backend named no contributor: a server a client's
   * plugin contributes is a customization of the list this host lays over the
   * session, which no backend is handed, so it is stamped here, where that list
   * lives, as VS Code's Claude session stamps a call from the list it holds.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L420-L441
   */
  const withMcpContributor = (session: string, action: Bag): Bag => {
    if (action.type !== 'chat/toolCallStart' || action.contributor !== undefined) return action;
    const toolName = typeof action.toolName === 'string' ? action.toolName : '';
    if (!toolName.startsWith('mcp__')) return action;
    const serverName = toolName.split('__')[1];
    const laid = ctx.stateOf(session)?.customizations;
    const customizationId = serverName ? findMcpChildId(Array.isArray(laid) ? laid as Bag[] : [], serverName) : undefined;
    return customizationId === undefined ? action : { ...action, contributor: { kind: 'mcp', customizationId } };
  };
  /**
   * The chat a call spawns a worker in, as VS Code's host mints one: in the
   * session's format, from the call and the root of the conversation the
   * issuing chat is in, which a worker's chat names as its parent.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L103-L109
   */
  const mintSubagentChatUri = (session: string, issuingChat: string, toolCallId: string): string => {
    let root = issuingChat;
    for (let up = subagents.get(root); up !== undefined && up.parentChat !== root; up = subagents.get(root)) root = up.parentChat;
    return subagentChatUri(chatUriFormatOf(ctx.defaultChatFor(session)), session, root, toolCallId);
  };
  /*
   * A worker chat's session and call, as VS Code's host resolves a spawned
   * chat's owner from the live registry and then the spawning calls recorded in
   * loaded chats.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostChatOwnershipService.ts#L302-L343
   */
  const workerOf = (chat: string): { session: string; toolCallId: string } | undefined => {
    const live = subagents.get(chat);
    if (live !== undefined) return { session: live.session, toolCallId: live.toolCallId };
    for (const [id, workers] of ctx.subHistory) {
      const session = ctx.nameOf(id);
      const one = workers.find((held) => mintSubagentChatUri(session, ctx.defaultChatFor(session), String(held.toolCallId ?? '')) === chat);
      if (one !== undefined) return { session, toolCallId: String(one.toolCallId ?? '') };
    }
    return undefined;
  };
  /**
   * A message with the attachments the client sent back on it.
   *
   * A `chat` attachment is resolved into a pointer before the backend is handed
   * it - `messageAttachments` - and a backend hands back what it was given: the
   * turn it started, and the message it is holding for the turn behind it. What
   * a client would then read is the pointer, with the tail of another chat's
   * transcript in its `modelRepresentation`, where what the person attached was
   * a reference to a chat. `asSentAttachment` is what says which attachments
   * this host made, so the message a client is served is the message that was
   * sent and the pointer stays in what the model read.
   *
   * The two actions a client's message travels on, and only those: every other
   * action a backend sends is passed through as its own object.
   */
  const asSent = (given: Bag): Bag => {
    if (given.type !== 'chat/turnStarted' && given.type !== 'chat/pendingMessageSet') return given;
    const message = given.message as Bag | undefined;
    if (typeof message !== 'object' || message === null) return given;
    const attachments = sentAttachments(message);
    return attachments === undefined ? given : { ...given, message: { ...message, attachments } };
  };

  /** A message's attachments as the client sent them, or nothing where none moved. */
  const sentAttachments = (message: Bag): MessageAttachment[] | undefined => {
    const held = message.attachments as MessageAttachment[] | undefined;
    if (!Array.isArray(held)) return undefined;
    const attachments = held.map(asSentAttachment);
    return attachments.some((one, at) => one !== held[at]) ? attachments : undefined;
  };

  /** A turn, or a held message, with the attachments the client sent on it. */
  const sentMessage = (given: unknown): unknown => {
    const one = given as Bag | undefined;
    if (typeof one !== 'object' || one === null) return given;
    const message = one.message as Bag | undefined;
    if (typeof message !== 'object' || message === null) return given;
    const attachments = sentAttachments(message);
    return attachments === undefined ? given : { ...one, message: { ...message, attachments } };
  };

  /**
   * A chat's state with the attachments its clients sent back on its messages.
   *
   * The other road out of the host for the same fact the emitter keeps: the
   * turn, the message waiting behind one and the steering message are all held
   * by the backend as it was handed them, so a subscriber would read the
   * pointer `messageAttachments` made in place of the chat attachment that was
   * sent. `withSender` is here for the same reason and in the same place - a
   * backend's state is the agent's answer and not a place this host writes
   * into, so what moves is copied and what did not is the backend's own object.
   */
  const asSentChat = (state: Bag): Bag => {
    const list = (given: unknown): unknown => {
      if (!Array.isArray(given)) return given;
      const held = given as Bag[];
      const next = held.map(sentMessage) as Bag[];
      return next.some((one, at) => one !== held[at]) ? next : given;
    };
    // Copied once, and only the keys that moved, so a state a client reads says
    // what the backend's said and no more.
    let next = state;
    const moved = (key: string, value: unknown): void => {
      if (value === state[key]) return;
      if (next === state) next = { ...state };
      next[key] = value;
    };
    moved('turns', list(state.turns));
    moved('activeTurn', sentMessage(state.activeTurn));
    moved('queuedMessages', list(state.queuedMessages));
    moved('steeringMessage', sentMessage(state.steeringMessage));
    return next;
  };
  /**
   * A chat's state with the stamp on each spawning call whose bag, as a
   * client reduced it, carries one, so a client that subscribes late reads
   * what the wire said: a call whose last `_meta` came on its start, delta or
   * ready. A call that links a chat carries that link, and every other one
   * gets this session's worker chat; a worker's own content names exactly that
   * URI, so a worker of this session is left as it was. A copy where anything
   * moved; the state passed in is the backend's own.
   */
  const stampedCalls = (session: string, chat: string, turns: Bag[]): Bag[] => turns.map((turn) => {
    const parts = Array.isArray(turn.responseParts) ? turn.responseParts as Bag[] : undefined;
    if (parts === undefined) return turn;
    let touched = false;
    const next = parts.map((part) => {
      const call = part.toolCall as Bag | undefined;
      if (call === undefined || !unstamped(call._meta) || typeof call.toolCallId !== 'string'
        || !links.stampedOn(chat, call.toolCallId)) return part;
      touched = true;
      const linked = linkIn(call.content);
      return { ...part, toolCall: { ...call, _meta: { ...call._meta, subagentChatUri: linked ?? mintSubagentChatUri(session, chat, call.toolCallId) } } };
    });
    return touched ? { ...turn, responseParts: next } : turn;
  });
  /**
   * A turn with the sender who asked it, and every turn without one left as it
   * is.
   *
   * `_meta` is the protocol's own place for a message's context and only the
   * message declares one - `Turn` and `ActiveTurn` do not - so a turn read out
   * of a session says who sent it the way the live action does, on the thing
   * the client was handed. A copy where a sender was found and the backend's
   * own object everywhere else, because `chatState()` is the agent's answer
   * and not a place this host writes into.
   */
  const withSender = (session: string, turns: Bag[]): Bag[] => turns.map((turn) => {
    if (ctx.turnSenders === 'kept') return turn;
    const sender = kept.sender(idOf(session), String(turn.id ?? ''));
    const message = turn.message as Bag | undefined;
    if (sender === undefined || typeof message !== 'object' || message === null) return turn;
    return { ...turn, message: { ...message, _meta: { ...(message._meta as Bag | undefined), 'ahpd.sender': sender } } };
  });
  /*
   * A turn's start as this host says it: with its sender where the daemon's
   * `turnSenders` is `said`, and as it is where it is `kept`, VS Code's, whose
   * host keeps a turn's sender and says it in no action.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatContributionsService.ts#L183-L199
   */
  const withSenderSaid = (action: Bag, sender: Owner): Bag => (ctx.turnSenders === 'kept' ? action : withSenderOn(action, sender));

  /** Workers whose turn has been ended, so a second ending is not a second turn. */
  const endedWorkers = new Set<string>();
  /**
   * Write one action on a worker's chat.
   *
   * The emitter the backend holds is the only thing that writes to this chat,
   * and the chat's state takes each action as every chat's does; the row and
   * the session's activity follow that state from there.
   */
  /**
   * Whether a backend's `chat/toolCallConfirmed` names a call a client's
   * decision already moved, which the host said in its place (`Session.confirm`):
   * VS Code's host says a client's confirmation once, and no provider says one
   * of its own. A backend's word on a call still waiting is its own decision,
   * and is said.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1878-L1904
   */
  const decidedAlready = (chat: string, action: Bag): boolean => {
    if (action.type !== 'chat/toolCallConfirmed') return false;
    const turn = ctx.stateOf(chat)?.activeTurn as Bag | undefined;
    const call = (Array.isArray(turn?.responseParts) ? turn.responseParts as Bag[] : [])
      .map((part) => part.toolCall as Bag | undefined)
      .find((one) => one !== undefined && one.toolCallId === action.toolCallId);
    return call?.status !== 'pending-confirmation';
  };

  /**
   * A backend's question about a call, as this host puts it to a person, as
   * VS Code's host handles its agent's pending confirmation.
   *
   * A question is a `chat/toolCallReady` with a `confirmationTitle` and no
   * `confirmed`. The options are VS Code's where the backend put none of its
   * own, and Allow Once and Skip, whatever the backend offered, for a tool the
   * operator's rule names. A tool the session's `permissions` deny is refused
   * before its question reaches any client: nothing is said, and the backend
   * is handed the refusal, as VS Code's host answers a call its permissions
   * deny. A tool they allow is answered here, unless the operator's rule
   * names it: the call is said running with `confirmed: not-needed`, and the
   * backend is handed the approval with no option. A client's tool keeps its
   * question, marked `autoApproveBySetting`, which the client that runs it
   * answers, as VS Code's host leaves that answer to the client. The backend
   * is handed an answer once its own question is in place. Undefined is a
   * question said to nobody.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1684-L1766
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L566-L610
   */
  const toolReady = (session: string, chat: string, given: Bag, backend: () => Session | undefined): Bag | undefined => {
    if (given.type !== 'chat/toolCallReady') return given;
    // The question's host-only fields, read here and sent to no client.
    const signal = Object.fromEntries(PENDING_CONFIRMATION_FIELDS.flatMap((key) => (given[key] === undefined ? [] : [[key, given[key]]]))) as PendingConfirmation;
    const action = Object.fromEntries(Object.entries(given).filter(([key]) => !(PENDING_CONFIRMATION_FIELDS as readonly string[]).includes(key)));
    if (typeof action.confirmationTitle !== 'string' || action.confirmed !== undefined) return action;
    const toolCallId = String(action.toolCallId ?? '');
    const turn = ctx.stateOf(chat)?.activeTurn as Bag | undefined;
    const call = (Array.isArray(turn?.responseParts) ? turn.responseParts as Bag[] : [])
      .map((part) => part.toolCall as Bag | undefined)
      .find((one) => one !== undefined && one.toolCallId === toolCallId);
    const toolName = typeof call?.toolName === 'string' ? call.toolName : undefined;
    const owning = sessions.get(session);
    const serving = owning?.backends.get(chat)?.agent ?? owning?.agent;
    const contributor = (action.contributor ?? call?.contributor) as Bag | undefined;
    const folders = (owning === undefined ? [] : ctx.leadOf(owning)?.workingDirectories() ?? []).map(localPath).filter((one) => one !== '');
    const shell = signal.permissionKind === 'shell';
    const commandLine = shell ? signal.shellCommand ?? (typeof action.toolInput === 'string' ? action.toolInput : undefined) : undefined;
    const subCommands = commandLine === undefined ? [] : splitForRules(commandLine, signal.shellLanguage ?? 'bash')?.subCommands ?? [];
    /*
     * The terminal rules and the edit patterns are the host's one value each,
     * read for every question whoever sent its turn, as VS Code's host reads
     * them from its root config for every question.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L380
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L875
     */
    const pushed = ctx.rootConfig['terminalAutoApproveRules'];
    const terminalRules = pushed !== null && typeof pushed === 'object'
      ? pushed as TerminalAutoApproveRules
      : options.terminalAutoApproveDefaults === 'none' ? {} : DEFAULT_TERMINAL_AUTO_APPROVE_RULES;
    const patterns = ctx.rootConfig['editAutoApprovePatterns'];
    const editPatterns = (patterns !== null && typeof patterns === 'object' ? patterns : vscodeRootProperties.editAutoApprovePatterns?.default ?? {}) as TerminalAutoApprovePatterns;
    const held: unknown = owning?.config['sensitiveEditLocations'];
    const sensitive = Array.isArray(held) && held.every((one: unknown) => typeof one === 'object' && one !== null && !Array.isArray(one)
      && typeof (one as Bag).path === 'string' && typeof (one as Bag).isDirectory === 'boolean')
      ? held as SensitiveEditLocation[]
      : [];
    const managedSettings = options.managedSettingsPermissions;
    const attachments = kept.attachmentsDir?.(idOf(session));
    const messages = [...(Array.isArray(ctx.stateOf(chat)?.turns) ? ctx.stateOf(chat)?.turns as Bag[] : []), ...(turn === undefined ? [] : [turn])]
      .map((one) => one.message as Bag | undefined);
    const approval: ToolApproval = {
      request: {
        kind: signal.permissionKind,
        toolName: toolName ?? '',
        ...(signal.shellLanguage === undefined ? {} : { shellLanguage: signal.shellLanguage }),
        ...(signal.permissionUrl === undefined ? {} : { url: signal.permissionUrl }),
        ...(signal.permissionPath === undefined ? {} : { path: signal.permissionPath }),
      },
      ...(commandLine === undefined ? {} : { commandLine }),
      ...(signal.requestSandboxBypass === true ? { requestSandboxBypass: true } : {}),
      rules: permissionRulesOf(owning?.config.permissions, ctx.rootConfig.permissions),
      context: { ...(folders[0] === undefined ? {} : { workingDirectory: folders[0] }), homeDirectory: homedir(), ignorePathCase: process.platform === 'win32' || process.platform === 'darwin' },
      workingDirectories: folders,
      ...(attachments === undefined ? {} : { attachmentsDirectory: attachments }),
      attached: messages.flatMap((message) => (Array.isArray(message?.attachments) ? message.attachments as Bag[] : []))
        .flatMap((one) => (typeof one.uri === 'string' && one.uri.startsWith('file:') && localPath(one.uri) !== '' ? [localPath(one.uri)] : [])),
      globalAutoApprove: ctx.rootConfig.globalAutoApproveEnabled === true,
      sessionAutoApprove: ctx.rootConfig.autoApprovePolicyRestricted !== true && owning?.config.autoApprove === 'autoApprove',
      bypassLocked: managedSettings?.disableBypassPermissionsMode === 'disable',
      terminalAutoApprove: ctx.rootConfig.terminalAutoApproveEnabled !== false,
      editPatterns,
      sensitive,
      ...(commandLine === undefined ? {} : {
        evaluateShell: (classifiers) => approver.evaluation(commandLine, {
          rules: terminalRules, editPatterns, shell: signal.shellLanguage ?? 'bash', sensitive, ...classifiers,
          ...(folders[0] === undefined ? {} : { workingDirectory: folders[0] }),
        }),
      }),
      exists: existsSync,
    };
    /*
     * The operator's managed rules, read on every question beside the
     * session's permissions where the daemon's `managedRules` is `checked`;
     * under `handed` the backends are handed them and the host checks none, as
     * VS Code's host. A question a managed rule asks, its backend's mark or
     * this host's, answers to nobody but a person, as one the operator's
     * `eligibleForAutoApproval` names.
     */
    const checked = options.managedRules !== 'handed';
    // The operator's rule read by the call's contributor: the tools this host offered the chat and runs itself, which
    // the rule names `host/<name>`, and an MCP server's tool against the server its contributor names among the
    // session's customizations.
    const eligible = !checked || toolName === undefined || !alwaysAsks(options.eligibleForAutoApproval, toolName,
      ctx.boundTools(session, chat, serving?.provider).filter((one) => one.owner === undefined).map((one) => one.definition.name),
      contributor, ctx.stateOf(session)?.customizations);
    const managedSays = checked ? managedDecision(managedSettings, approval, subCommands) : undefined;
    const managed = signal.managedApprovalRequired === true || managedSays === 'ask' || !eligible;
    if (managedSays === 'deny' || isForbiddenSnapshotWrite(approval) || isDeniedByPermissions(approval, subCommands)) {
      queueMicrotask(() => { backend()?.confirm(toolCallId, false, undefined, 'host_policy'); });
      return undefined;
    }
    const asked = { ...approval, ...(managed ? { managedApprovalRequired: true } : {}) };
    const approved = managed ? undefined : autoApprovalOf(asked);
    // A client's tool keeps its question, which the client that runs it answers, marked approved by the setting.
    const marked = approved !== undefined && contributor?.kind === 'client'
      ? { ...(call?._meta as Bag | undefined), ...(action._meta as Bag | undefined), autoApproveBySetting: true }
      : action._meta as Bag | undefined;
    if (approved === undefined || contributor?.kind === 'client') {
      const { options: offered, meta } = confirmationOptions(asked, Array.isArray(action.options) ? action.options as Bag[] : undefined, marked);
      const { _meta: _given, ...rest } = action;
      return { ...rest, options: offered, ...(meta === undefined ? {} : { _meta: meta }) };
    }
    queueMicrotask(() => { backend()?.confirm(toolCallId, true, undefined, 'host_policy'); });
    return {
      type: 'chat/toolCallReady',
      turnId: action.turnId,
      toolCallId,
      ...(action.contributor === undefined ? {} : { contributor: action.contributor }),
      ...(action.intention === undefined ? {} : { intention: action.intention }),
      invocationMessage: action.invocationMessage,
      ...(action.toolInput === undefined ? {} : { toolInput: action.toolInput }),
      confirmed: 'not-needed',
      ...(action._meta === undefined ? {} : { _meta: action._meta }),
    };
  };

  const sendSubagent = (uri: string, given: Bag): void => {
    const ref = subagents.get(uri);
    if (ref === undefined) return;
    // A question a worker's call puts is the lead chat's backend's to be answered, as a client's answer on the worker's chat is.
    const action = toolReady(ref.session, uri, withMcpContributor(ref.session, withWorkerUri(uri, given)), () => {
      const owning = sessions.get(ref.session);
      return owning === undefined ? undefined : ctx.leadOf(owning);
    });
    if (action === undefined || decidedAlready(uri, action)) return;
    const was = ctx.stateOf(uri)?.status;
    // Whether this ends the turn the worker's chat runs, whose end is then raised as every chat's is.
    const turn = String(action.turnId ?? '');
    const ends = (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled' || action.type === 'chat/error')
      && String((ctx.stateOf(uri)?.activeTurn as Bag | undefined)?.id ?? '') === turn;
    dispatch(uri, action);
    if (ends) raiseTurnEnd({ session: ref.session, channel: uri, turnId: turn, reason: endingOf(uri, action) });
    // Unread where the protocol's chat reducer makes it so, from the action a
    // client reduces, with nothing said of this host's own.
    if (clearsRead(String(action.type)) && sessions.has(ref.session)) {
      kept.setChatFlags(idOf(ref.session), uri, kept.chatFlags(idOf(ref.session), uri) & ~Status.IsRead);
    }
    /*
     * And whether the chat that carries it may still be moved.
     *
     * A move takes a chat's workers with it, so one running a turn holds its
     * chat where it is. Walked up to the chat a client sees, because a worker's
     * own call can be inside another worker and only the top one is a chat of
     * the session.
     */
    if (ctx.stateOf(uri)?.status !== was) {
      let at = ref.parentChat;
      for (let up = subagents.get(at); up !== undefined && up.parentChat !== at; up = subagents.get(at)) at = up.parentChat;
      updateChatMovability(at);
    }
  };

  /**
   * The worker chat for one tool call of a backend's, made on first ask.
   *
   * The row is announced on the session, the turn is opened with the prompt,
   * and the spawning call is linked to it - which is the whole of what makes a
   * worker's conversation a conversation rather than a pile of parts inside
   * somebody else's turn.
   */
  const openSubagent = (session: string, lead: string, toolCallId: string, request: SubagentRequest): SubagentChat => {
    /*
     * The chat the call is in. A nested worker's call is in the worker chat
     * that spawned it, which is why the parent names a call and not a chat.
     */
    const parentChat = request.parentToolCallId !== undefined && request.parentToolCallId !== ''
      ? mintSubagentChatUri(session, lead, request.parentToolCallId)
      : lead;
    const uri = mintSubagentChatUri(session, parentChat, toolCallId);
    let ref = subagents.get(uri);
    if (ref === undefined) {
      const now = new Date().toISOString();
      ref = {
        session,
        parentChat,
        toolCallId,
        title: request.title,
        ...(request.agentName !== undefined ? { agentName: request.agentName } : {}),
        ...(request.description !== undefined ? { description: request.description } : {}),
        turnId: `turn-${crypto.randomUUID()}`,
        openedAt: Date.now(),
      };
      subagents.set(uri, ref);
      /*
       * The worker's chat opens here, as nothing: what it says from here on is
       * every action the backend emits on it, read before it is announced.
       * Kept read until something is said in it, as a new chat starts.
       */
      startsRead(ctx, session, uri);
      ctx.openState(uri, 'chat', {
        resource: uri,
        title: request.title,
        status: Status.Idle | kept.chatFlags(idOf(session), uri),
        modifiedAt: now,
        origin: { kind: 'tool', chat: parentChat, toolCallId },
        interactivity: 'read-only',
        turns: [],
      });
      /*
       * The default chat takes its own title from here, before the worker is
       * said, as the reference host adds a spawned chat to its session.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L15539-L15548
       */
      ctx.snapshotDefaultChatTitle(session);
      dispatch(session, { type: 'session/chatAdded', summary: subagentSummary(uri, ref) });
      // The session's row is where a client listing sessions reads its chats,
      // so a chat that has just appeared is said there too.
      markSummaryDirty(session);
      sendSubagent(uri, {
        type: 'chat/turnStarted',
        turnId: ref.turnId,
        startedAt: now,
        // The parent agent's instruction, which is the worker's own message.
        message: { text: request.prompt ?? '', origin: { kind: 'tool' } },
      });
      /*
       * The link, on the call itself.
       *
       * The protocol keeps the two ends consistent: the chat's origin names
       * the call, and the call's result content names the chat. Written with
       * whatever the call already had, which is why the content is remembered
       * beside the action that carried it. Written only while the call's chat
       * has a turn open: an action naming a turn that has ended lands on no
       * turn a client holds, and the backend's own completion of the call
       * carries the link instead. A nested worker's call is in its parent
       * worker's chat, whose state this host reduces, so the link goes through
       * `sendSubagent` and lands in that state too.
       */
      const parentTurn = links.turnOf(parentChat);
      if (parentTurn !== undefined) {
        const content = { type: 'subagent', resource: uri, title: request.title,
          ...(request.agentName !== undefined ? { agentName: request.agentName } : {}),
          ...(request.description !== undefined ? { description: request.description } : {}) };
        const held = (links.contentOf(parentChat, toolCallId) ?? []).filter((one) => !(one.type === 'subagent' && one.resource === uri));
        const next = [...held, content];
        links.hold(parentChat, toolCallId, next);
        const link = { type: 'chat/toolCallContentChanged', turnId: parentTurn, toolCallId, content: next };
        if (subagents.has(parentChat)) sendSubagent(parentChat, link);
        else dispatch(parentChat, link);
      }
    }
    const held = ref;
    return {
      uri,
      turnId: held.turnId,
      emit: (action: Bag) => sendSubagent(uri, action),
      end: (state: 'complete' | 'error' | 'cancelled', why?: string) => {
        const held = subagents.get(uri);
        if (held === undefined || endedWorkers.has(uri)) return;
        endedWorkers.add(uri);
        const duration = Math.max(0, Date.now() - held.openedAt);
        const turnId = held.turnId;
        if (state === 'complete') sendSubagent(uri, { type: 'chat/turnComplete', turnId, duration });
        else if (state === 'cancelled') sendSubagent(uri, { type: 'chat/turnCancelled', turnId, duration });
        else {
          // VS Code's error type for a failed subagent, with the failure's own
          // words, or VS Code's where it has none.
          // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L2983-L2998
          sendSubagent(uri, {
            type: 'chat/error',
            turnId,
            duration,
            part: { kind: 'error', error: { errorType: 'subagentFailed', message: why ?? 'Subagent failed.' } },
          });
        }
        // Something new to read in the worker's chat, which a turn's end says
        // unread, whatever its bit, as the reference host's markUnread says
        // every chat's. A worker's chat is a tool's, so its end leaves the
        // session's bit as it is.
        // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/markUnread/markUnreadContribution.ts#L27-L49
        // https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/common/state/sessionState.ts#L2063-L2070
        if (sessions.has(held.session)) {
          kept.setChatFlags(idOf(held.session), uri, kept.chatFlags(idOf(held.session), uri) & ~Status.IsRead);
          dispatch(uri, { type: 'chat/isReadChanged', isRead: false });
        }
      },
    };
  };

  /**
   * A default or worker chat of a session held as `<provider>:/<id>`, built
   * for `ahp-session:/<id>`, or nothing for any other chat: the chat's legacy
   * URI, as VS Code derives a legacy default chat from a session's identity.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostLegacyDefaultChat.ts#L25
   *
   * A default or worker chat's URI embeds its session's, and a session store
   * may hold a chat's title under that URI of it, so a title is looked for
   * there too.
   */
  const legacyChatUri = (uri: string, chatUri: string): string | undefined => {
    const former = uriFor(idOf(uri));
    if (former === uri) return undefined;
    if (chatUri === chatUriFor(uri)) return chatUriFor(former);
    const callId = toolCallOfSubagentChat(chatUri);
    return callId !== undefined && chatUri === buildSubagentChatUri(uri, callId) ? buildSubagentChatUri(former, callId) : undefined;
  };
  /** A chat's stored title: under its URI, or else under `legacyChatUri`. */
  const titleOf = (uri: string, chatUri: string): string | undefined => {
    const former = legacyChatUri(uri, chatUri);
    return kept.chatTitle(idOf(uri), chatUri) ?? (former === undefined ? undefined : kept.chatTitle(idOf(uri), former));
  };
  /** A nested session's record with a new title or a new time, where it has one. */
  const moveNested = (id: string, change: { title?: string }): void => {
    const was = kept.nested?.(id);
    if (was === undefined) return;
    kept.setNested?.(id, { ...was, ...change, modifiedAt: new Date().toISOString() });
  };
  /**
   * Persist a chat's title under its URI, and clear one kept under
   * `legacyChatUri`, as VS Code persists a chat's custom title under its chat.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/persistSessionMetadata.ts#L36
   */
  const persistChatTitle = (uri: string, chatUri: string, title: string): void => {
    kept.setChatTitle(idOf(uri), chatUri, title);
    const former = legacyChatUri(uri, chatUri);
    if (former !== undefined && kept.chatTitle(idOf(uri), former) !== undefined) kept.setChatTitle(idOf(uri), former, '');
    // And on the session's own list of chats, so a session served read-only
    // after a restart lists this one under the name it was given.
    ctx.keepChat(uri, chatUri, undefined, false);
  };
  /**
   * Persist the title a session was given, beside its chats' own: the name
   * its backend is handed as its default chat starts, and the title a nested
   * session's record lists it by. An empty one is kept as the session having
   * none, and its backend's own title stands.
   */
  const persistSessionTitle = (uri: string, title: string): void => {
    kept.setCustomTitle?.(idOf(uri), title);
    moveNested(idOf(uri), { title });
  };

  /**
   * A session's working folder, written into its record as a path where the
   * record says another or none.
   */
  const keepFolder = (id: string, folder: string | undefined): void => {
    const path = folder === undefined ? '' : localPath(folder);
    if (path === '' || kept.workingDirectory?.(id) === path) return;
    kept.setWorkingDirectory?.(id, path);
  };

  /**
   * Which harness a session runs on, recorded under every id it answers to,
   * as VS Code records a chat's agent provider and persists its default chat's
   * backing.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L10038
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L15573
   *
   * The host's own and the agent's, which are one name unless the backend chose
   * a different id for the transcript it writes. Recorded when a session
   * starts: two agents can read the same transcripts, a listing is a read and
   * writes nothing, and a session that was never recorded still has to open
   * somewhere. A backend that names its own id once a turn has run is recorded
   * at the end of that turn, in the chat's own emit.
   *
   * The working folder goes under the agent's id as well, so a backend that
   * finds the session by that id is told where it ran.
   *
   * The name the host holds the session under is written under the host's id
   * only, and only when the row has none: a name belongs to the session this
   * host made, and the backend's own id is a second key for the same row. The
   * id it is written under is the host's, because that is what `names` is
   * keyed by and what a listed session is found again by.
   */
  const recordSessionProvider = (uri: string, agent: Agent, session: Session): void => {
    kept.setProvider(idOf(uri), agent.provider);
    if (kept.uri?.(idOf(uri)) === undefined) kept.setUri?.(idOf(uri), uri);
    const own = session.agentId();
    if (own !== undefined && own !== '') {
      kept.setProvider(own, agent.provider);
      keepFolder(own, sessions.get(uri)?.workingDirectory);
    }
  };

  /**
   * The session's tree, written down as a commit of its own.
   *
   * A source with no checkpoints is a source that answers the session's
   * changes from what it saw the tools write, which is what every host did
   * before there were any - so nothing here is required of one, and a source
   * that fails at it is the same case: the counts come from somewhere else and
   * the session is untouched.
   */
  const checkpointOf = async (dir: string, uri: string, turn: string): Promise<void> => {
    try {
      await options.changes?.checkpoint?.(dir, idOf(uri), turn);
    }
    catch { /* a checkpoint that is not there is a count from somewhere else */ }
  };

  /*
   * Whether a value is a reading the rules can be applied to.
   *
   * All three members are required. A parser that leaves one off is not one
   * this file knows how to read, and treating a missing `unanalyzable` as
   * `false` would approve a line on a guess.
   */
  const isCommandSplit = (value: unknown): value is CommandSplit => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const held = value as Record<string, unknown>;
    return Array.isArray(held['subCommands'])
      && held['subCommands'].every((one) => typeof one === 'string')
      && Array.isArray(held['writeDests'])
      && held['writeDests'].every((one) => typeof one === 'string')
      && typeof held['unanalyzable'] === 'boolean';
  };

  /*
   * The reading the rules are applied to: the port's, or the sdk's own when
   * nobody named another.
   *
   * The port is code this host did not write, so a throw or a value that is
   * not a `CommandSplit` is read as a line nobody could read. That is the same
   * answer `splitCommand` gives for a line it cannot parse, and it asks rather
   * than approving on a reading the port did not actually give.
   */
  const splitForRules: CommandSplitter = (line, shell) => {
    const parser = options.commandParser;
    if (parser === undefined) return splitCommand(line, shell);
    try {
      const read: unknown = parser(line, shell);
      return isCommandSplit(read) ? read : undefined;
    }
    catch {
      return undefined;
    }
  };

  /*
   * The rules that answer a shell command, one for every session this host
   * starts: it keeps no state, so one is the same as one a session.
   */
  const approver = new CommandAutoApprover(splitForRules);

  /*
   * The task list call the host draws, one per turn.
   *
   * A plugin registers the lines and the host draws them: a call is opened in
   * every turn open when the plugin says the lines moved, rewritten on each
   * later change, and completed as the turn ends. It is named as VS Code
   * shows an agent's task list, its todo call `TodoWrite`, "Update todo list".
   * The line is kept from the change it was drawn for, because the completion
   * carries what the call last showed, and a turn that ended while a read was
   * running draws nothing at all: the turn's end is said as its backend says
   * it, as the reference host says an agent's end of a turn.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeToolDisplay.ts#L160
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeToolDisplay.ts#L393-L394
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L901-L917
   */
  const planCallId = (turn: string): string => `${turn}:plan`;
  /** What each chat's open turn last showed, by chat. */
  const drawnPlans = new Map<string, { turn: string; content: Bag[] }>();
  /** The last change asked for, by session, so a slow read cannot draw over a faster one. */
  const drawing = new Map<string, number>();

  const drawnContent = (lines: string[]): Bag[] => lines.map((text) => ({ type: 'text', text }));

  const completePlan = (chat: string, turn: string): void => {
    const held = drawnPlans.get(chat);
    if (held === undefined || held.turn !== turn) return;
    drawnPlans.delete(chat);
    dispatch(chat, {
      type: 'chat/toolCallComplete',
      turnId: turn,
      toolCallId: planCallId(turn),
      result: {
        success: true,
        pastTenseMessage: 'Update todo list',
        ...(held.content.length === 0 ? {} : { content: held.content }),
      },
    });
  };

  const drawPlan = async (session: string): Promise<void> => {
    const plan = options.plan;
    if (plan === undefined) return;
    const held = sessions.get(session);
    if (held === undefined) return;
    const open: { chat: string; turn: string }[] = [];
    for (const chat of held.chats.keys()) {
      const turn = links.turnOf(chat);
      if (turn !== undefined) open.push({ chat, turn });
    }
    // Nothing is drawn while no turn of the session is running: the change is
    // the list's, and the next turn reads the list as it stands.
    if (open.length === 0) return;
    const asked = (drawing.get(session) ?? 0) + 1;
    drawing.set(session, asked);
    let lines: string[];
    try {
      lines = await plan.read(session);
    }
    catch (error: unknown) {
      log(`plugin ${plan.by}: the plan of ${session} was not read: ${reason(error)}`);
      return;
    }
    // A later change asked while this read ran, and its lines are the ones to show.
    if (drawing.get(session) !== asked) return;
    for (const { chat, turn } of open) {
      // The turn may have ended while the read ran; there is nothing left to draw it in.
      if (links.turnOf(chat) !== turn) continue;
      const content = drawnContent(lines);
      const previous = drawnPlans.get(chat);
      if (previous === undefined || previous.turn !== turn) {
        drawnPlans.set(chat, { turn, content });
        dispatch(chat, { type: 'chat/toolCallStart', turnId: turn, toolCallId: planCallId(turn), toolName: 'TodoWrite', displayName: 'Update todo list' });
        dispatch(chat, { type: 'chat/toolCallReady', turnId: turn, toolCallId: planCallId(turn), invocationMessage: 'Update todo list', confirmed: 'not-needed' });
      }
      else {
        previous.content = content;
      }
      dispatch(chat, { type: 'chat/toolCallContentChanged', turnId: turn, toolCallId: planCallId(turn), content });
    }
  };

  /*
   * A plugin's plan is drawn by this host, which is built after the plugin
   * applied, so the entry is given the way to ask for the draw.
   *
   * Run again by `replace`, because a plugin a live fold brings holds an entry
   * nothing has set this on yet, and its plan would never be drawn.
   */
  const wirePlan = (): void => {
    if (options.plan === undefined) return;
    options.plan.changed = (uri) => drawPlan(uri);
  };
  wirePlan();

  const spawn = async (
    agent: Agent,
    uri: string,
    chatUri: string,
    chatId: string | undefined,
    config: Record<string, unknown>,
    resuming?: { resume?: string; seed?: Bag[]; forkAt?: string; rewindAt?: string; context?: string },
    workingDirectory?: string,
    credentials?: Record<string, string>,
    additional?: string[],
    sender?: Connection,
    askedInstructions?: string[],
    own?: { agent: Agent; config: Record<string, unknown> },
  ): Promise<Session> => {
    /*
     * The backend that actually runs this session.
     *
     * A backend that cannot move its own process into a machine declares
     * `runsNested`, and a session of it that names a computer runs through the
     * SDK's proxy instead: a whole host with that backend loaded is started
     * inside the machine and its frames are carried out as this session's. A
     * session with no machine, or a backend without the flag, is started here
     * exactly as it was.
     *
     * The host inside loads the plugin that registered the agent here, as its
     * spec was recorded. An agent made from a record has no such plugin: the
     * host inside loads the plugin of the record's engine and is handed the
     * record. An agent with neither ends its session saying so.
     *
     * A machine off this host is nested whatever the backend declared, because
     * one that moves its own process into a machine on this host still cannot
     * reach a box on another. The
     * port is asked once, here, because whether a machine is off this host is
     * the port's to know and every road to a running backend goes through this
     * one place.
     */
    const plugin = options.agentPlugins?.[agent.provider];
    const handedAgent = plugin === undefined ? options.handedAgent?.bind(options) : undefined;
    const machine = computerId(config.computer);
    const offHost = machine !== undefined && options.computers?.remote?.(machine) === true;
    /*
     * A machine whose port can hand over a socket, which is a node that dialled
     * this host: the host inside it is reached over that socket instead of a
     * command. The port is asked for every machine, so the answer for one it
     * does not serve is nothing, and the proxy starts the host the old way.
     */
    const connect = options.computers?.connect?.bind(options.computers);
    const used = machine !== undefined && (agent.runsNested === true || offHost)
      ? nestedAgent(agent, {
        plugins: plugin === undefined ? [] : [plugin],
        ...(handedAgent === undefined ? {} : { handed: () => handedAgent(agent.provider) }),
        log,
        ...(connect === undefined ? {} : {
          restart: options.nodeRestart ?? 'end',
          start: (asked: NestedAsked) => connect(asked.id, {
            plugins: asked.plugins,
            ...(asked.cwd === undefined ? {} : { cwd: asked.cwd }),
            ...(asked.record === undefined ? {} : { record: asked.record }),
          }),
        }),
      })
      : agent;
    if (ctx.closed) throw new RpcError(INTERNAL_ERROR, CLOSING);
    if (resuming?.resume !== undefined) restoredSessions.add(uri);
    /*
     * A session's own scratch folder, made again when a start finds it gone,
     * as VS Code's agent makes a recorded scratch folder again before a chat
     * runs in it.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1785-L1791
     */
    const workspaceless = isWorkspaceless(uri, workingDirectory);
    if (workspaceless && workingDirectory !== undefined) mkdirSync(workingDirectory, { recursive: true });
    // Kept before its tools are bound, which is what `set_workspace` is offered by.
    if (workspaceless) ctx.startedWorkspaceless.add(uri);
    /*
     * What this session's turns cost, kept against each turn until it ends.
     *
     * Only where the host was given somewhere to keep usage: a host with no
     * `usage` port records nothing, and a meter that had one would only hold a
     * running sum nobody reads. The owner and the scope are asked of the turn
     * and the session when the record is written rather than held here, because
     * both can move while the turn runs.
     */
    const metering = options.usage === undefined ? undefined : meter({
      usage: options.usage,
      ...(options.usagePer === undefined ? {} : { per: options.usagePer }),
      onProblem: log,
      session: uri,
      chat: chatUri,
      agent: agent.provider,
      computer: () => computerId(config.computer),
      senderOf,
      // What the turn's check chose, read when each record is written and let
      // go of when the turn ends.
      keysOf,
      owner: () => kept.owner(idOf(uri)),
      scope: () => charged.get(uri)?.scope,
    });
    /*
     * Whether this session runs with nothing to call.
     *
     * A session opened for its words alone - a commit message, a pull request
     * title - is one question answered by one model, and a tool call in the
     * middle of it would be that model reading and writing the very tree the
     * operation is about to commit. The host's own tools are left out by
     * `boundTools`, which answers none for a URI in here, and the four fields
     * below are the other ways a backend is handed something callable. It is
     * asked before any of them, and it decides nothing else about the session.
     */
    const bare = ctx.bareSessions.has(uri);
    /*
     * The MCP servers this session's agent is offered, read when the session
     * starts rather than held, so a daemon that edits the key while it runs
     * changes what the next session is given.
     *
     * The session's client plugins are part of them: a plugin's own servers
     * reach every backend through here, including the ones that cannot load a
     * plugin at all.
     */
    const servers = bare ? {} : ctx.mcpFor(uri);
    /*
     * The client plugin copies this chat's agent is handed, and a note of
     * which they were.
     *
     * A backend that loads plugins opens these directories and one that cannot
     * ignores the field; either way the set is written down here, because a
     * send is the only thing that can compare it with the session's set now.
     */
    const plugins = bare ? [] : ctx.pluginsFor(uri, chatUri);
    /*
     * The servers of those plugins a client switched off, by name.
     *
     * Left out of `mcpFor` above, and named here: a backend that opens a
     * plugin directory can find a server there on its own, and this is how it
     * is told not to run one.
     */
    const denied = bare ? [] : ctx.deniedMcpServers(uri);
    /*
     * The same tools as an MCP server, for a backend that cannot call them in
     * this process - an ACP agent, which asks its client for them.
     *
     * One endpoint per session, opened when the backend asks and closed when
     * the session goes, so a token reaches the tools of the session it was
     * handed to and nothing else.
     *
     * The operator's rule holds there as at the /mcp door, where the daemon's
     * `managedRules` is `checked` and the backend asks nothing of its own
     * before a call runs: a call through this server reaches no question, so a
     * host tool the rule names is refused, and so it is in every list the
     * backend hands the endpoint after.
     */
    const toolsServer = (ask?: {
      runClient?: RunClientTool;
      toolsChanged?: ToolsChanged;
      mayRun?: MayRunTool;
    }): ToolsEndpoint | undefined => {
      if (bare) return undefined;
      const ruled = options.managedRules !== 'handed' && ask?.mayRun === undefined;
      const held = (tools: BoundTool[]): BoundTool[] => tools.map((one) => {
        const name = one.definition.name;
        if (!ruled || one.run === undefined || !asksForTool(options.eligibleForAutoApproval, `host/${name}`)) return one;
        return {
          ...one,
          run: () => { throw new Error(`${name} asks every time: eligibleForAutoApproval names host/${name}, and this session's tools server puts no question`); },
        };
      });
      const opened = options.toolsServers?.open(
        held(ctx.boundTools(uri, chatUri, agent.provider)),
        ask?.runClient,
        ask?.toolsChanged,
        ask?.mayRun,
      );
      if (opened === undefined) return undefined;
      const open = ctx.served.get(uri) ?? [];
      open.push(opened);
      ctx.served.set(uri, open);
      return { ...opened, setTools: (now) => opened.setTools(held(now)) };
    };
    /*
     * What this backend is told about the folders it is handed.
     *
     * Read from the host's one `workspaceTrust`, which the last push from any
     * window set. Every start reads it, whoever sent the turn and when nobody
     * did, as VS Code's host reads its one trust value for every session it
     * starts and every hook it runs.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostSessionPrewarmer.ts#L166-L169
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L8621
     *
     * A folder is trusted by its own trust, and a worktree this host made in
     * its repository's `<repo>.worktrees` by its repository's as well, as VS
     * Code's host grants a session's working directory its trust. A worktree
     * under a configured root is read by its own alone.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotSessionLauncher.ts#L512-L520
     *
     * One folder is trusted without a connection: the one a plugin asked for
     * with `session:trust`, kept with the session. Nobody at the keyboard
     * vouched for it - that is the point of the grant - and a restart that
     * starts the session again has no connection to ask. It is that folder
     * alone, compared as the folder it names, and no folder under it: what the
     * grant bought is one folder, not a tree.
     */
    const trustedBy = (folder: string): boolean => {
      const asked = kept.trustedFolder?.(idOf(uri));
      if (asked !== undefined && sameFolder(asked, folder)) return true;
      const trust = ctx.rootConfig.workspaceTrust;
      const made = ctx.worktreeOf(uri);
      return trusted(folder, trust)
        || (made !== undefined && sameFolder(made.path, folder) && isWorktreeUnderRepository(made.path, made.repository) && trusted(made.repository, trust));
    };
    /*
     * What the model is told before it starts, in the order it is told.
     *
     * The host's tools' own instructions come first, because they are about
     * tools every session is offered; what the session was asked for joins
     * them after, which is where a request's own words belong - it may name a
     * tool that only its session has, so nothing in front of it could account
     * for that. A workspace-less session is told last that it works in a
     * scratch folder, as VS Code's agents append that to what they are told.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/prompts/promptRegistry.ts#L220-L229
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L2159-L2162
     */
    const told = [...ctx.instructions(uri), ...(askedInstructions ?? []), ...(workspaceless ? [AGENT_HOST_WORKSPACELESS_INSTRUCTIONS] : [])];
    /*
     * Whether the backend loads the person's own settings, read off the store
     * rather than off a request: a restart has no request, and what the session
     * asked for is kept for exactly this moment. Absent is the default every
     * session has always had, and only the `false` a request asked for is there.
     */
    const userSettings = kept.userSettings?.(idOf(uri));
    /*
     * The session as the backend built it, once it has been built.
     *
     * The start handed to `create` carries a callback that reads the session's
     * title, and the title lives on the object that callback is part of
     * creating - so the object is held here, where the callback can reach it
     * once the backend answers.
     */
    let titled: Session | undefined;
    const terminalOutputs = ctx.outputsFor(uri, chatUri);
    /**
     * Whether this host is saying an action on the chat's road itself, which is
     * how a turn it handed the backend, or ran as a local command, is booked:
     * once, when the host says its start there.
     */
    let booking = false;
    /** The client whose relayed action the action on this road answers, while it is said. */
    let answering: Origin | undefined;
    /**
     * Whether the backend has reported what it can do, which a backend that
     * opens its server before it answers does inside `create`, before this
     * host holds the session: its models are then learned once it is held.
     */
    let reported = false;
    const wired: Start = {
      uri,
      chatUri,
      trusted: trustedBy,
      // The operator's policy as it stands at the start: managed settings, and
      // the auto-approval restriction a window forwarded.
      ...ctx.schemaPolicy(),
      ...(userSettings === undefined ? {} : { userSettings }),
      ...(sender?.principal === undefined ? {} : { reader: sender.principal }),
      /*
       * The tools bound to this session: this host's own, and whatever the
       * clients already in it provide.
       *
       * Asked of `boundTools` rather than of `contributing`, because a host
       * that contributes none of its own still has a client's to pass on -
       * and a session created by a client that announced its tools in the same
       * breath would otherwise have been offered nothing until the next
       * announcement moved the list.
       */
      ...(ctx.boundTools(uri, chatUri, agent.provider).length > 0 ? { tools: deepFreeze(ctx.boundTools(uri, chatUri, agent.provider)) } : {}),
      ...(told.length > 0 ? { instructions: told } : {}),
      /*
       * The stores a backend may need for itself, handed down only when the
       * host holds them. Files are this host's own store, so a backend reads
       * what a client reads. `terminals` is not that store but the factory
       * over it: the host owns the URI, the root registration and the emit,
       * and a backend given the raw port would get none of the three.
       */
      ...(options.resources !== undefined ? { resources: heldResources(options.resources) } : {}),
      ...(options.terminals !== undefined ? { terminals: ctx.heldTerminals(options.terminals, uri, chatUri) } : {}),
      /*
       * Output terminals, offered whether or not the host holds a store: there
       * is no process here to spawn, only a channel to write text into.
       */
      outputTerminals: ctx.heldOutputs(uri),
      // The outputs this chat keeps after their terminals are gone, where the
      // store keeps the session a folder to hold them in.
      ...(terminalOutputs === undefined ? {} : { terminalOutputs }),
      ...(options.computers !== undefined ? { computers: computersFor(options.computers, agent.provider, uri, kept.owner(idOf(uri))) } : {}),
      /*
       * The MCP servers, when there are any.
       *
       * Absent rather than an empty map, because a backend that reads it has no
       * way to tell a host that configured none from a host that never heard of
       * them, and the answer to either is the same.
       */
      ...(Object.keys(servers).length === 0 ? {} : { mcpServers: servers }),
      /*
       * The client plugins, when the session's clients brought any - which is
       * a directory each, here, because a path on the client's machine is not
       * one a backend running here could open.
       */
      ...(plugins.length === 0 ? {} : { plugins }),
      ...(denied.length === 0 ? {} : { deniedMcpServers: denied }),
      ...(options.toolsServers === undefined ? {} : { toolsServer }),
      // Resolved here rather than left for the backend to default, so what a
      // call waits is one number the host decided and a deployment set once.
      clientToolTimeoutMs: options.clientToolTimeoutMs ?? DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
      /*
       * The operator's environment for the shells this session runs.
       *
       * Handed on unchanged, because only a backend knows what it does with a
       * shell - the Claude backend puts an `export` line in front of every Bash
       * command. Absent rather than an empty map, because a backend that reads
       * it has no way to tell a host that configured none from a host that
       * never heard of the key, and the answer to either is the same.
       */
      ...(options.shellEnv === undefined ? {} : { shellEnv: frozenCopy(options.shellEnv) }),
      ...(credentials && Object.keys(credentials).length > 0 ? { credentials } : {}),
      ...(workingDirectory !== undefined ? { workingDirectory } : {}),
      ...(additional !== undefined && additional.length > 0 ? { additional: frozenCopy(additional) } : {}),
      /*
       * The chat's own name for its conversation, where it has one.
       *
       * Handed on every start of that chat - the first, a resume and a restart -
       * because it is the name the backend keeps it under, and a second start
       * that named nothing would open the session's transcript instead of this
       * chat's. A fork is the one place a backend may mint its own: it was asked
       * for a copy under a name of its own, and the id it answers with is the
       * one this host records for the chat.
       */
      ...(chatId === undefined ? {} : { chatId }),
      ...(resuming?.resume !== undefined ? { resume: resuming.resume } : {}),
      ...(resuming?.seed !== undefined ? { seed: resuming.seed } : {}),
      ...(resuming?.forkAt !== undefined ? { forkAt: resuming.forkAt } : {}),
      ...(resuming?.rewindAt !== undefined ? { rewindAt: resuming.rewindAt } : {}),
      ...(resuming?.context !== undefined ? { context: resuming.context } : {}),
      /*
       * The values in force, as a frozen copy rather than the host's own map.
       *
       * A backend reads these to know what it was started with; one that set
       * `model` on them would be setting what the host records against this
       * session and what the next turn is started with.
       */
      settings: frozenCopy({ ...agent.defaults(), ...contributedDefaults(), ...config }),
      schema: () => runningSchema(agent),
      // What the boot probe already learned: the commands behind a slash, the
      // skills, the subagents and the MCP servers. A session that answered
      // `[]` until its own agent replied was empty for the first several
      // seconds - and a client that asks once and caches never found out
      // otherwise.
      seedCustomizations: about(agent.provider).customizations,
      /*
       * What the boot probe learned the models are, for the same reason and
       * read from the same place: a session opened with a stored model needs to
       * know this variant offers it before it will reopen on it, and a session
       * that has not been asked is not going to find out from anybody.
       */
      seedModels: about(agent.provider).models,
      /*
       * The worker chat a backend asks for, named and opened here.
       *
       * The host is the only thing that knows what a chat URI looks like, what
       * a catalogue row says and which turn a part belongs to - so the backend
       * brings the call id and the words, and everything else is this.
       */
      subagent: (toolCallId: string, request: SubagentRequest) => openSubagent(uri, chatUri, toolCallId, request),
      subagentChatOf: (toolCallId: string) => mintSubagentChatUri(uri, chatUri, toolCallId),
      /*
       * The background tasks this backend reports.
       *
       * Always offered, because a task is a record and needs no store: the
       * host builds the row from what the backend says, and a backend that
       * emits `chat/backgroundWorkSet` itself has it dropped, by `emit`.
       */
      backgroundTasks: ctx.background.heldTasks(),
      /*
       * A harness's own task list, raised for whoever is listening.
       *
       * The backend brings the list because it is the only thing that sees the
       * harness's calls; the sender is read here because it is the host's to
       * know, and the turn the list names is what the host recorded it under.
       */
      planUpdate: (update) => {
        const sender = senderOf(update.turn);
        const title = titled?.title().trim() ?? '';
        void fire({
          type: 'plan_update',
          session: uri,
          chat: chatUri,
          harness: agent.provider,
          ...(title === '' ? {} : { title }),
          ...update,
          ...(sender === undefined ? {} : { sender }),
        });
      },
      /*
       * Whether the host draws the turn's Plan call. A backend told so keeps
       * its harness's own list out of the turn rather than drawing a second
       * call, and what that list still knows comes up through `planUpdate`.
       */
      ...(options.plan === undefined ? {} : { plan: true }),
      /* An action on a channel this session's backend serves, said under this host's name for it. */
      emitOn: (channel, action) => {
        dispatch(channel, action);
      },
      /*
       * The answer of the host that runs this session to a client's action
       * this backend relayed: its echo, said on this road under the client's
       * origin, a start's booked here as the start of a turn this host hands a
       * backend is, or the client's action refused in that host's words.
       */
      answer: (channel, action, origin, rejectionReason) => {
        if (rejectionReason !== undefined) {
          // A start refused there is no turn, so nothing held against it here stays.
          if (action.type === 'chat/turnStarted') {
            ctx.forgetSender(String(action.turnId ?? ''));
            ctx.forgetKeys(String(action.turnId ?? ''));
          }
          const by = [...ctx.connections].find((one) => one.clientId === origin.clientId);
          if (by === undefined) log(`${uri}: the host running it refused ${String(action.type)}, and its client has gone: ${rejectionReason}`);
          else ctx.refuse(by.peer, channel === 'chat' ? chatUri : uri, action, origin, rejectionReason);
          return;
        }
        answering = origin;
        booking = channel === 'chat' && action.type === 'chat/turnStarted';
        try { wired.emit(channel, action); }
        finally {
          answering = undefined;
          booking = false;
        }
      },
      /*
       * What a backend says is this host's own action, said as the reference
       * host says its agent's: its background work and its session's activity
       * as much as its turns.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L901-L912
       */
      emit: (channel, action) => {
        /*
         * The session's `inputNeeded` entries are this host's to say: it
         * raises and takes down each from the chats' state, whoever asked, as
         * VS Code's host mirrors every chat's blockers and no agent raises an
         * entry.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L19-L25
         */
        if (channel === 'session' && (action.type === 'session/inputNeededSet' || action.type === 'session/inputNeededRemoved')) return;
        /*
         * Background work is the host's to draw, where the daemon's
         * `backendBackgroundWork` is `drop`.
         *
         * A row is the protocol's shape with a `_meta` flag and a snapshot
         * beside it, all of which the host builds from `backgroundTasks`, so an
         * action a backend emitted itself would be a second builder, and the one
         * a late subscriber never sees: one shape for every backend's rows, a
         * third party's among them, as upstream decided (plan host/115). Dropped
         * rather than refused, because a backend mid-migration should not fail
         * a turn over it, and logged because silence is how it goes unnoticed.
         * `say` is VS Code's: a provider's own action goes out as the host's.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L901-L912
         */
        if ((action.type === 'chat/backgroundWorkSet' || action.type === 'chat/backgroundWorkRemoved') && ctx.backendBackgroundWork === 'drop') {
          log(`dropped ${action.type} from ${agent.provider}: the host draws background work`);
          return;
        }
        /*
         * A chat's read and archived bits are the ones this host keeps, laid
         * over the status a backend says on the chat's row, as they are on the
         * chat's state.
         */
        if (channel === 'session' && (action.type === 'session/chatUpdated' || action.type === 'session/chatAdded')) {
          const row = (action.type === 'session/chatAdded' ? action.summary : action.changes) as Bag | undefined;
          const named = String((action.type === 'session/chatAdded' ? row?.resource : action.chat) ?? '');
          if (row !== undefined && typeof row.status === 'number') {
            const status = (row.status & (Status.IsRead - 1)) | kept.chatFlags(idOf(uri), named);
            action = action.type === 'session/chatAdded'
              ? { ...action, summary: { ...row, status } }
              : { ...action, changes: { ...row, status } };
          }
        }
        const where = channel === 'chat' ? chatUri : uri;
        const turn = String(action.turnId ?? '');
        /*
         * A backend's start of a turn the chat holds is neither said nor
         * booked again: the host said the turn's start, and booked it on this
         * road when it handed the turn over. A turn the backend opens itself
         * is the chat's from its start, said and booked here.
         */
        if (channel === 'chat' && action.type === 'chat/turnStarted' && !booking) {
          const held = ctx.stateOf(chatUri);
          const turns = Array.isArray(held?.turns) ? held.turns as Bag[] : [];
          if (String((held?.activeTurn as Bag | undefined)?.id ?? '') === turn || turns.some((one) => String(one.id ?? '') === turn)) return;
        }
        // A client's decision on a call is said once, as the client's.
        if (channel === 'chat' && decidedAlready(chatUri, action)) return;
        if (channel === 'chat') {
          const put = toolReady(uri, chatUri, withMcpContributor(uri, action), () => sessions.get(uri)?.chats.get(chatUri));
          if (put === undefined) return;
          action = put;
        }
        // A turn the chat began, under its own id: the id a read after a
        // restart holds it by, unless the backend says it wrote it otherwise.
        // The origin goes with it where the turn was not a person's, so a turn
        // an automation began reads back as one.
        if (channel === 'chat' && action.type === 'chat/turnStarted') {
          const startedFrom = bag(bag(action.message).origin);
          ctx.turnRecordedAs(uri, chatUri, turn, turn,
            typeof startedFrom.kind === 'string' && startedFrom.kind !== 'user' ? startedFrom : undefined);
        }
        const sender = senderOf(turn);
        /*
         * Who asked, on the wire and on disk.
         *
         * The action carries it because `chat/turnStarted` is one of the few
         * that declares a `_meta`; the store keeps it because the in-memory
         * entry is let go of when the turn ends and a session read out of its
         * transcript asks the store, not this map. Nothing is written and
         * nothing is sent where there is nobody to name, so a host with no
         * users directory sends exactly what it sent before.
         */
        if (sender !== undefined && channel === 'chat' && action.type === 'chat/turnStarted') {
          kept.setSender(idOf(uri), turn, sender);
          if (answering === undefined) action = withSenderSaid(action, sender);
        }
        /*
         * The bits of a session and a chat whose backend runs them on another
         * host, as that host says them: kept here, where every row and state
         * of the session and the chat reads them. The session's read bit
         * follows a chat's there, and comes out as the session's action, which
         * is said here only where it moves the bit: a client's own was said
         * when this host took it.
         */
        const relays = sessions.get(uri)?.chats.get(chatUri)?.flag !== undefined;
        const bit = relays && channel === 'chat'
          ? (action.type === 'chat/isReadChanged' ? Status.IsRead : action.type === 'chat/isArchivedChanged' ? Status.IsArchived : undefined)
          : undefined;
        if (bit !== undefined) {
          const flags = kept.chatFlags(idOf(uri), chatUri);
          const on = bit === Status.IsRead ? action.isRead === true : action.isArchived === true;
          kept.setChatFlags(idOf(uri), chatUri, on ? flags | bit : flags & ~bit);
        }
        if (relays && channel === 'session' && (action.type === 'session/isReadChanged' || action.type === 'session/isArchivedChanged')) {
          const read = action.type === 'session/isReadChanged';
          sessionFlag(ctx, uri, read ? Status.IsRead : Status.IsArchived, read ? action.isRead === true : action.isArchived === true, asSent(action));
          return;
        }
        dispatch(where, asSent(action), answering);
        // A tool call whose result names file edits wrote to this session's
        // tree, so the changeset is re-read then rather than waiting for the
        // turn's end, as the reference recomputes on a completed call's edits.
        // The row's counts move with it: the turn has no checkpoint yet, so
        // the session kind is counted from its baseline to the working tree.
        // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1118-L1124
        const result = action.result as Bag | undefined;
        if (action.type === 'chat/toolCallComplete' && Array.isArray(result?.content)
          && (result.content as Bag[]).some((one) => one?.type === 'fileEdit')) {
          const dir = dirOf(uri);
          if (dir !== undefined) {
            void refreshWatched(dir);
            void refreshSessionChangesSummary(uri, true);
          }
        }
        /*
         * What this turn used, kept against it until it ends.
         *
         * Read here rather than where a turn is run because this is the one
         * place every action a backend sends goes through, and before the
         * sender is let go of below, because the record says who sent the work.
         * The three endings are the ones `settleRun` reads: a turn that failed
         * is ended by its `chat/error`, not by a completion after it.
         */
        if (metering !== undefined) {
          if (action.type === 'chat/turnStarted') {
            const asked = ((action.message ?? {}) as Bag).model;
            metering.started(turn,
              typeof action.startedAt === 'string' ? action.startedAt : new Date().toISOString(),
              typeof (asked as Bag | undefined)?.id === 'string' ? ((asked as Bag).id as string) : undefined);
          }
          else if (action.type === 'chat/usage') metering.reported(turn, (action.usage ?? {}) as Bag);
          else if (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled'
            || action.type === 'chat/error') metering.ended(turn);
        }
        // A turn that has ended is let go of, once what a usage record will want
        // has been read off it and what a history needs is the store's. A turn
        // that failed is ended by its `chat/error`, as the protocol's reducer
        // ends it.
        if (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled'
          || action.type === 'chat/error') {
          // The meter has written the turn's record by now, so the keys it
          // read are let go of beside the sender.
          forgetSender(turn);
          forgetKeys(turn);
        }
        // A nested session's record follows the title and the last turn.
        if (action.type === 'session/titleChanged' && typeof action.title === 'string') moveNested(idOf(uri), { title: action.title });
        else if (channel === 'chat' && action.type === 'chat/turnComplete') moveNested(idOf(uri), {});
        // A turn's two ends as its road says them: begun, and finished,
        // stopped or failed, a `!` command's turn finished as this host's
        // local command. A per-token delta is not an event, because a plugin
        // that wants the stream is a client.
        if (action.type === 'chat/turnStarted') {
          // The queued message the turn took up, which the queue drain admitted it for.
          const queued = channel === 'chat' ? ctx.takenUp(chatUri, turn) : undefined;
          void fire({
            type: 'turn_start',
            session: uri,
            chat: chatUri,
            turn,
            ...(sender === undefined ? {} : { sender }),
            ...(queued === undefined ? {} : { queuedMessageId: queued }),
          });
        }
        else if (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled' || action.type === 'chat/error') {
          raiseTurnEnd({ session: uri, channel: chatUri, turnId: turn, reason: endingOf(chatUri, action), ...(sender === undefined ? {} : { sender }) });
        }
        /*
         * And the run this session was started for, when its default chat's
         * turn ends, as VS Code's host settles a run on its sessions' default
         * chats: completed, cancelled, or failed with the chat error's own
         * `ErrorInfo`. One call per action, so a run is never settled twice for
         * one event.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostAutomationService.ts#L1249-L1297
         */
        if (chatUri === sessions.get(uri)?.defaultChat) {
          if (action.type === 'chat/turnComplete') ctx.settleRun(uri, { status: 'completed' });
          else if (action.type === 'chat/turnCancelled') ctx.settleRun(uri, { status: 'cancelled' });
          else if (action.type === 'chat/error') {
            const failure = ((action.part ?? {}) as Bag).error as Bag | undefined;
            ctx.settleRun(uri, {
              status: 'failed',
              ...(typeof failure?.errorType === 'string' && typeof failure.message === 'string'
                ? { error: failure as unknown as ErrorInfo }
                : {}),
            });
          }
        }
        /*
         * The harness a transcript is written under, kept as soon as the
         * backend has said what that id is.
         *
         * Claude names the transcript from the stream, so a fork, and a
         * session whose id the host chose and the backend did not, have no id
         * of their own until a turn has run - and a fork has none at all,
         * because `recordSessionProvider` is called before anything is said. Only when
         * the store does not already say it: a row rewritten on every turn is
         * a store written to for nothing.
         *
         * And the chat's own record, from the same answer: a chat whose URI
         * names no id the backend took, and a fork that was asked for a copy
         * under a name of its own, run under an id this host never chose. What
         * a restart resumes is read from the record, so a record holding the
         * name that was asked for instead is a resume of a conversation that
         * does not exist.
         */
        if (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled') {
          const own = byChat.get(chatUri)?.chat.agentId();
          /*
           * A chat of another backend's transcript is that backend's: the
           * session's provider is not what a resume of that id reads, and the
           * folder under it is the session's. The chat's own backend is on
           * `Held.backends` and its row, which is where a start reads it.
           */
          if (!foreign && own !== undefined && own !== '') {
            if (kept.provider(own) !== agent.provider) kept.setProvider(own, agent.provider);
            keepFolder(own, sessions.get(uri)?.workingDirectory);
          }
          if (own !== undefined && own !== '' && ctx.recordedChat(idOf(uri), chatUri)?.backendId !== own) {
            ctx.keepChat(uri, chatUri, own, false);
          }
        }
        /*
         * The title the backend derived, when it moved on the session's default
         * chat: it is the subject a commit would use, so the question the
         * changeset's commit asks has changed with it.
         */
        const owner = sessions.get(uri);
        const moved = owner?.chats.get(chatUri);
        if (moved !== undefined && owner !== undefined && chatUri === owner.defaultChat && (described.get(chatUri) ?? '') !== moved.title()) {
          described.set(chatUri, moved.title());
          operationsMoved(uri);
        }
        /*
         * The chat's read bit, and the session's at a turn's end.
         *
         * Cleared where the protocol's chat reducer clears it, so the bit kept
         * here is the one a client reduces, from the action the client reduces
         * it from: the reference host says nothing more at a turn's start.
         * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L358-L372
         *
         * At a turn's end the chat is said unread, whatever its bit, and then a
         * read session is marked unread with this host's own
         * `session/isReadChanged`, as the reference host's markUnread does at
         * every turn's end. A chat a tool opened, or a hidden one, keeps its
         * own bit and leaves the session's as it is, which is the reference's
         * `isChatInSessionReadAggregate`. After the action and the chat's row,
         * so a client applies those first. The bits move while the session
         * holds the chat, whose row they mark.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/markUnread/markUnreadContribution.ts#L27-L49
         * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/common/state/sessionState.ts#L2063-L2070
         *
         * A `!` command turn's end says nothing of either bit, as the
         * reference's leaves a local command's: the chat stays as its start
         * left it.
         *
         * A chat whose backend runs it on another host has its read bit, and
         * its session's, moved there, and said as the chat's and the session's
         * actions.
         */
        const commandKey = commandTurnKey(chatUri, turn);
        const ownBit = moved !== undefined && moved.flag === undefined;
        if (ownBit && clearsRead(action.type)) {
          kept.setChatFlags(idOf(uri), chatUri, kept.chatFlags(idOf(uri), chatUri) & ~Status.IsRead);
        }
        if (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled' || action.type === 'chat/error') {
          const command = ctx.commandTurns.has(commandKey);
          /*
           * A `!` command's turn is the host's, so no transcript holds it: the
           * host keeps it for its chat once it has ended, as the chat's state
           * holds it, which is the turn its clients reduced. The reference
           * records a local turn from its state the same way.
           * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/localCommands/localChatCommand.ts#L229-L247
           */
          if (moved !== undefined && command) {
            ctx.recordLocalTurn(uri, chatUri, (ctx.stateOf(chatUri)?.turns ?? []) as Bag[], turn);
          }
          ctx.commandTurns.delete(commandKey);
          if (moved !== undefined && !command && ownBit) {
            kept.setChatFlags(idOf(uri), chatUri, kept.chatFlags(idOf(uri), chatUri) & ~Status.IsRead);
            dispatch(chatUri, { type: 'chat/isReadChanged', isRead: false });
            const row = chatSummary(uri, chatUri, moved);
            if ((row.origin as Bag | undefined)?.['kind'] !== 'tool' && row.interactivity !== 'hidden') {
              sessionFlag(ctx, uri, Status.IsRead, false, { type: 'session/isReadChanged', isRead: false });
            }
          }
        }
        // A turn starting or finishing moves the catalogue too, and a client
        // watching only the list is the one that most needs telling.
        markSummaryDirty(uri);
        /*
         * And a turn that ended is when the branch is worth asking about
         * again: the agent may have changed it, or somebody may have in a
         * terminal. A turn that failed for good is one of those, and the files
         * it wrote before it died are as much the session's work as a finished
         * turn's. A turn that broke with an error the client may resume is
         * left as it is until it ends again, as VS Code's host leaves one.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/checkpointAndChangeset/checkpointAndChangesetContribution.ts#L30-L54
         *
         * The machine's own commits first, where the session is in one: a
         * machine that commits in a git directory of its own leaves the host's
         * branch where it was until ahpd fetches, so the facts read after this
         * are the facts of a folder whose branch holds the turn's work -
         * decision `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`.
         * A session in no machine has nothing to fetch, and its facts are read
         * without waiting for an answer nobody was asked for.
         */
        const resumable = action.type === 'chat/error' && ((action.part ?? {}) as Bag).resumable === true;
        if ((action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled' || action.type === 'chat/error') && !resumable) {
          const dir = dirOf(uri);
          if (dir !== undefined) {
            /*
             * The tree first, since what a session changed is a difference
             * between two of them: the counts read next are read against the
             * turn just written down, and the facts after those are read
             * against the same tree, so a row that moved because of the turn
             * says so once. A cancelled turn's
             * edits stay in the session's changes with no checkpoint of their
             * own, as VS Code's host keeps them, so the counts are read at once.
             */
            void (action.type === 'chat/turnCancelled' ? Promise.resolve() : checkpointOf(dir, uri, turn))
              .then(() => refreshSessionChangesSummary(uri))
              .then(() => {
                if (enteredIn.get(uri) === undefined) refreshFacts(dir);
                else void bringBackOf(uri).then(() => { refreshFacts(dir); });
              });
          }
        }
        // A turn starting or ending, however it ended, is the whole of what
        // disables and re-enables a changeset's operations, and it moves
        // nothing inside the changeset itself - so it has to be asked here or
        // it is never said.
        if (action.type === 'chat/turnStarted' || action.type === 'chat/turnComplete'
          || action.type === 'chat/turnCancelled' || action.type === 'chat/error') operationsMoved(uri);
        /*
         * And a move the agent asked for is made now, once its turn completed:
         * the one moment the backend can be started again without losing
         * anything. A turn that was cancelled or failed drops the move it
         * asked for, as VS Code's host carries out a workspace change only for
         * a turn that succeeded.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/sessionWorkspaceConversion/sessionWorkspaceConversionContribution.ts#L28-L37
         */
        if ((action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled' || action.type === 'chat/error')
          && ctx.moving.get(uri)?.chat === chatUri) {
          const move = ctx.moving.get(uri) as Move;
          ctx.moving.delete(uri);
          // Whether its chats may move, which the move asked for kept from them.
          for (const one of sessions.get(uri)?.chats.keys() ?? []) updateChatMovability(one);
          if (action.type === 'chat/turnComplete') {
            void ctx.moveSession(uri, move).catch((error: unknown) => {
              log(`${uri} could not move to ${move.directory}: ${error instanceof Error ? error.message : String(error)}`);
            });
          }
          else log(`${uri} dropped its move to ${move.directory}: its turn did not complete`);
        }
      },
      /*
       * A file the agent is about to change, on its way to the changeset.
       *
       * The session says which file and when, because it is the thing that
       * can see its own tools; the source reads it, because it is the thing
       * with a filesystem. Neither has to know about the other. What the
       * session already holds of a side is passed on, and what the source
       * answers for is returned, so a `before` is read before the write that
       * would truncate the file out from under it.
       */
      onFileEdit: (turnId, path, phase, text) => {
        const dir = dirOf(uri);
        if (dir === undefined) return;
        return options.changes?.observe?.(dir, uri, turnId, path, phase, text);
      },
      /*
       * A file a person is being asked about, on its way to the same source.
       *
       * The other direction of the seam above: this is a call the agent has
       * not run, so the source reads the file and keeps the text the tool
       * would leave rather than recording a side of a change already made.
       * The session names the call; the source mints the URI the client reads
       * it from, because the URI is the source's own scheme.
       *
       * Nothing where this session has no folder, which is the folder the
       * previews would be of. A session running in a computer is the same
       * case the changeset is: this source reads the daemon's own disk.
       */
      onEditProposed: (toolCallId, path, apply) => {
        const dir = dirOf(uri);
        if (dir === undefined) return undefined;
        return options.changes?.propose?.(dir, uri, toolCallId, path, apply);
      },
      onEditSettled: (toolCallId) => {
        options.changes?.settle?.(uri, toolCallId);
      },
      /*
       * An edit a call made, both sides of which the agent said: held by the
       * same source, which mints the URIs a client reads them from.
       */
      onEditCompleted: (toolCallId, path, before, after) => options.changes?.complete?.(uri, toolCallId, path, before, after),
      /*
       * Content a tool result or a part of the agent's message carries inline,
       * kept in the session's folder and answered by the reference a part
       * names it by.
       */
      storeToolResultResource: (resource) => ctx.toolResults.store(uri, resource),
      /*
       * A turn the backend has written under an id of its own.
       *
       * What the host keeps against a turn is kept against the id the client
       * chose it by, and a backend whose transcript names turns its own way -
       * Claude writes a turn whose id is not a UUID under a uuid of its own - is
       * read back by that other id after a restart, finding nothing. So the
       * record of the turns the chat began keeps it, the sender is kept under
       * it as well, and a `!` turn after it is anchored to it by that id, with
       * no host learning one backend's transcript format.
       *
       * The sender's in-memory entry first, because a turn still running is
       * only in that map, and the store after it for the turn a backend names
       * once the turn is over. Nothing where the two ids agree, which is every
       * backend that keeps the ids it was given and which the turn's start
       * recorded already, and no sender where nobody sent the turn.
       */
      onTurnRecorded: (turnId, transcriptId) => {
        if (transcriptId === turnId) return;
        // The origin the turn began with goes to the record under the id it
        // will be read back by.
        ctx.turnRecordedAs(uri, chatUri, turnId, transcriptId, ctx.turnOriginOf(chatUri, turnId));
        const sender = senderOf(turnId) ?? kept.sender(idOf(uri), turnId);
        if (sender !== undefined) kept.setSender(idOf(uri), transcriptId, sender);
      },
      onHandshake: () => {
        reported = true;
        setAgentModels(uri);
      },
      /*
       * The account the running CLI is signed in as, which is the only way this
       * host learns one for a backend that spawns nothing at boot. It is kept
       * and published the same way the probe's is, so a client sees one key
       * rather than two paths that could disagree about who is signed in.
       */
      onAccount: (account) => { publishAccountInfo(agent.provider, account); },
    };
    /*
     * Whether this chat is one the session's own backend does not serve.
     *
     * Read before the backend is created, because a backend may emit inside
     * `create`, and the emit below reads it: a chat of another backend is one
     * chat of the session and nothing else about the session is its.
     *
     * A first start takes its answer from `own` where the caller gave one: a
     * resume whose recorded default chat is one of another backend starts that
     * chat before the session exists, and the chat is not what the session is.
     * Without it, this start is the session's own chat, as every other road
     * here is.
     */
    const existing = sessions.get(uri);
    const foreign = existing !== undefined ? agent !== existing.agent : own !== undefined && agent !== own.agent;
    /*
     * A backend answers its session at once, and the rest of this start runs in
     * the same tick it was asked in; or it answers a promise, for a step to
     * make first, and the session is held once that step is made, the start's
     * failure being the failure of whatever asked for it.
     */
    const made = used.create(wired);
    const session = made instanceof Promise ? await made : made;
    titled = session;
    const now = new Date().toISOString();
    const held = existing ?? {
      agent: own?.agent ?? agent,
      chats: new Map<string, Session>(),
      defaultChat: chatUri,
      config: own?.config ?? config,
      backends: new Map<string, { agent: Agent; config: Record<string, unknown> }>(),
      workingDirectory,
      additional,
      // The catalogue's values for a session being resumed or woken; now, for
      // one being started, as VS Code's host dates a session it makes. A
      // second chat in a session that already exists takes the session's own,
      // because `sessions.get` answered above.
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L10712-L10713
      createdAt: births.get(uri) ?? now,
      modifiedAt: moves.get(uri) ?? now,
      quietSince: 0,
    };
    // Loaded now, which is activity: a session resumed a moment ago is not one
    // that has been quiet since before it slept.
    held.quietSince = (options.now?.() ?? new Date()).getTime();
    // Said back to the catalogue, so a row listed after this agrees with the
    // session channel about when it began.
    births.set(uri, held.createdAt);
    held.chats.set(chatUri, session);
    sessions.set(uri, held);
    /*
     * Started, or brought back, which is recent in the residency; one more
     * resident may put another past the limit, which is read once the start is
     * done.
     * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L6489-L6490
     * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13950-L13951
     */
    ctx.touch(uri);
    queueMicrotask(() => { ctx.reconcile(); });
    /*
     * A chat on a backend of its own, which the session's own agent does not
     * serve.
     *
     * The session keeps its own agent and config - what it is, what a resume
     * records and what its own chats run on - and a chat opened on another
     * backend keeps that one here, by its own URI. Every road that starts the
     * chat again reads it from here; a chat that is not in this map is served
     * by the session's backend.
     */
    if (foreign) held.backends.set(chatUri, { agent, config });
    /*
     * What this session's backends were told is let go of, because the one
     * starting now has been told nothing: it is a backend that found its own
     * customizations and is running them. This is every road to a running
     * backend, so it is the one place a chat starting again is noticed.
     */
    ctx.forgetTold(uri);
    /*
     * Written down, in the one place every road to a running backend goes
     * through.
     *
     * The store is what knows a session's chats: which session a chat's own
     * URI belongs to, which of them a client gets when it names none, and what
     * a restart starts again. The backend id is the one this start was handed,
     * and the session's own id for the chat that is the session - until the
     * backend answers with its own, which the chat's own emit records.
     */
    ctx.keepChat(
      uri, chatUri, chatId ?? idOf(uri), held.defaultChat === chatUri,
      foreign ? agent.provider : undefined, foreign ? config : undefined,
    );
    // And the folder it works in, which is where a backend is told to look for
    // it after a restart. Only on a change, so a chat started again in the
    // same folder writes nothing.
    keepFolder(idOf(uri), held.workingDirectory);
    /*
     * And the tree it found there, before its first turn can change it.
     *
     * The baseline is what a session's own changes are measured from, so it is
     * written as the session starts and left alone from then on - a session
     * started again finds the ref already there. This is the one road to a
     * running backend, so it is the one place every session is given one.
     *
     * The session's counts are read behind it, so that a row says what this
     * session did rather than what its folder holds: until a turn has ended
     * the two ends of that are the baseline and itself, which is a difference
     * of nothing and the right answer for a session that has done nothing yet.
     */
    if (held.workingDirectory !== undefined) {
      void checkpointOf(held.workingDirectory, uri, BASELINE_TURN).then(() => refreshSessionChangesSummary(uri));
    }
    /*
     * The name it had before, when it is being created again.
     *
     * A chat's title is its own and the catalogue's is derived, so the store
     * is what remembers it across a restart. Applied here, before the chat is
     * announced or handed to a backend, so a client never sees the derived
     * name first and then a correction. The default chat's backend holds the
     * session's title, so it is handed the one the session was given, an
     * empty one being none; a record that keeps no title of the session's
     * kept the session's name as its default chat's, and that is handed.
     */
    const given = held.defaultChat === chatUri ? kept.customTitle?.(idOf(uri)) : undefined;
    const named_ = given === undefined ? titleOf(uri, chatUri) : given === '' ? undefined : given;
    if (named_ !== undefined) session.setTitle?.(named_);
    // The name it is held under, which is the session's own and not its
    // provider's. Recorded so every other answer about it uses that same string.
    names.set(idOf(uri), uri);
    byChat.set(chatUri, {
      uri,
      chat: session,
      say: (action) => {
        booking = true;
        try { wired.emit('chat', action); }
        finally { booking = false; }
      },
    });
    /*
     * Whether this chat may move, said where what its state or its session's
     * row holds differs. Both are built from `movable` as they are read, so a
     * chat whose state or row was built before this start is told what it is
     * now, and one built now is told nothing more. This is the one road every
     * start of a backend goes through.
     */
    updateChatMovability(chatUri);
    /*
     * The draft the session's record keeps for this chat, handed to the chat
     * as it opens, as VS Code's host restores a chat's draft when it opens
     * the chat: it was typed into this conversation, before this start or
     * before the last process stopped.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/chatDraft/chatDraftContribution.ts#L54-L67
     */
    const typed = kept.chatDraft?.(idOf(uri), chatUri);
    if (typed !== undefined) session.setDraft(typed);
    /*
     * The session's own backend, which claims the session where it was built
     * from a record rather than started: a chat of another backend is one chat
     * of the session and does not change whose the session is, which is what
     * the catalogue, a resume and a charge read.
     */
    if (!foreign) owners.set(uri, agent);
    /*
     * The models of a backend that reported them before it was held, learned
     * now that the session they are read from is, as VS Code's host seeds a
     * session's offers before its first state is served.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2476-L2493
     */
    if (reported) setAgentModels(uri);
    /*
     * The machine this session is now running in, told to the plugin that owns
     * it.
     *
     * Here rather than in each caller, because `spawn` is the one place every
     * road to a running backend goes through: a session created, one resumed
     * from the list after a daemon restart, a restart, a chat started again, a
     * fork and a truncate all call it, and a disposable machine whose last
     * session has left is waiting out its delay. A road that reached a backend
     * without saying so would have its machine removed under it.
     */
    const inside = computerId(config.computer);
    if (inside !== undefined) {
      inMachine(inside, uri, true);
      enteredIn.set(uri, inside);
    }
    /*
     * A nested session's record, which is what lists it after a restart: its
     * transcript is in the machine and no backend here can list it.
     */
    if (used !== agent && inside !== undefined) {
      const id = idOf(uri);
      const was = kept.nested?.(id);
      const now = new Date().toISOString();
      kept.setNested?.(id, {
        provider: agent.provider,
        machine: inside,
        inner: resuming?.resume ?? id,
        title: named_ ?? was?.title ?? session.title(),
        createdAt: was?.createdAt ?? now,
        modifiedAt: now,
        workingDirectories: workingDirectory !== undefined ? [uriOf(workingDirectory)] : was?.workingDirectories ?? [],
      });
    }
    /*
     * The chat's state opens here, once, from what its backend holds now and
     * what this host keeps beside it: every road to a running backend comes
     * through this one, and a chat already open - a backend started again
     * under it - keeps the state it holds. The delta window is emptied first,
     * so a word the backend already holds is not reduced into it again. The
     * session's row is brought into step with what the chat opened with.
     */
    ctx.flushDeltas();
    const open = ctx.stateOf(chatUri);
    if (open === undefined) ctx.openState(chatUri, 'chat', ctx.resolveChatState(uri, chatUri));
    else if (open.activeTurn === undefined && (!Array.isArray(open.turns) || open.turns.length === 0)) {
      /*
       * A chat that opened with no conversation - its record read nothing, as
       * one inside a machine reads before its host there answers - takes the
       * one its backend holds once it starts, as `chat/truncated` and then
       * `chat/turnsLoaded`: the two actions the reference host refreshes a
       * chat's persisted history with.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L759-L767
       */
      const turns = ctx.resolveChatState(uri, chatUri).turns;
      if (Array.isArray(turns) && turns.length > 0) {
        dispatch(chatUri, { type: 'chat/truncated' });
        dispatch(chatUri, { type: 'chat/turnsLoaded', turns });
      }
    }
    ctx.onChatSummaryChanged(chatUri);
    /*
     * A session whose state this host holds already - read from its record, or
     * kept across a sleep - is told the customizations of the backend that now
     * leads it, where they are not what the state says. The reference host
     * says an agent's list on a held state whenever it differs from the one
     * the state holds, and says a new session's first list to the clients that
     * subscribed while it was read.
     * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L609-L647
     * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L6419-L6422
     */
    const state = ctx.stateOf(uri);
    if (state !== undefined && held.defaultChat === chatUri) {
      const reported = session.customizations();
      const laid = ctx.laidCustomizations(uri, reported) ?? [];
      if (JSON.stringify(laid) !== JSON.stringify(state.customizations ?? [])) {
        dispatch(uri, { type: 'session/customizationsChanged', customizations: reported });
      }
    }
    return session;
  };

  return {
    unstamped, withWorkerUri, stampedCalls, withSender, withSenderSaid, asSentChat,
    sendSubagent, endedWorkers, raiseTurnEnd,
    openSubagent, mintSubagentChatUri, workerOf, legacyChatUri, titleOf, persistChatTitle, persistSessionTitle, recordSessionProvider,
    spawn, wirePlan, completePlan,
  };
}