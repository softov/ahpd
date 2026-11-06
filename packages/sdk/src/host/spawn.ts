import { chatReducer } from '@microsoft/agent-host-protocol';
import type { ChatAction, ChatState, ErrorInfo, ToolCallConfirmationReason } from '@microsoft/agent-host-protocol';
import { CommandAutoApprover, DEFAULT_TERMINAL_AUTO_APPROVE_RULES, splitCommand } from '../access/commandautoapprover.js';
import type { CommandShell, CommandSplit, CommandSplitter, SensitiveEditLocation, TerminalAutoApprovePatterns, TerminalAutoApproveRules } from '../access/commandautoapprover.js';
import { RpcError, INTERNAL_ERROR } from '../rpc.js';
import { reason } from '../utils/values.js';
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
import { chatUriFor, subagentChatUri, toolCallOfSubagentChat } from './channels.js';
import { CLOSING } from './common.js';
import { commandTurnKey, sessionFlag, sessionFollows, startsRead } from './chatactions.js';
import { sameFolder, trusted } from './trust.js';
import { BASELINE_TURN } from '../types/changes.js';
import type { Bag } from '../types/common.js';
import type { Agent, AutoApproval, AutoApprovalKind, Start } from '../types/agent.js';
import type { Connection } from '../types/host.js';
import type { Session, SubagentChat, SubagentRequest } from '../types/session.js';
import type { MessageAttachment } from '@microsoft/agent-host-protocol';
import type { ResourceStore } from '../types/resources.js';
import type { MayRunTool, RunClientTool, ToolsChanged, ToolsEndpoint } from '../tools/server.js';
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
  /** A chat's state with the attachments its clients sent back on its messages. */
  asSentChat(state: Bag): Bag;
  /** Write one action on a worker's chat. */
  sendSubagent(uri: string, given: Bag): void;
  /** Workers whose turn has been ended, so a second ending is not a second turn. */
  endedWorkers: Set<string>;
  /** The worker chat for one tool call of a backend's, made on first ask. */
  openSubagent(session: string, lead: string, toolCallId: string, request: SubagentRequest): SubagentChat;
  /** A chat of a session in the session's `ahp-session:/<id>` spelling, when it has one. */
  formerChatUri(uri: string, chatUri: string): string | undefined;
  /** A chat's stored title. */
  titleOf(uri: string, chatUri: string): string | undefined;
  /** Store a chat's title under its name. */
  keepTitle(uri: string, chatUri: string, title: string): void;
  /** Store the title a session was given, beside its chats' own. */
  keepSessionTitle(uri: string, title: string): void;
  /** Write down which harness a session runs on, under every id it answers to. */
  keepProvider(uri: string, agent: Agent, session: Session): void;
  /**
   * Start one backend's session, and the worker chats it goes on to ask for.
   *
   * `sender` is the connection that sent the turn this start is for, when a
   * client sent it. It is what the start's `trusted` and `getAutoApproval` are
   * read from and nothing else is, so a start nobody's connection asked for -
   * an automation, a host tool, a daemon restarting what it held - is a start
   * with no trust and no rules at all.
   *
   * `askedInstructions` is what the request that asked for this session says,
   * added to `Start.instructions` after what the host's tools say. It is not
   * kept, so a session started again after a restart is not told it: what has
   * to hold for the whole life of a session belongs on a tool's instruction.
   *
   * `own` is the session's own backend and config, for the one start that
   * creates the session with a chat another backend serves: a resume whose
   * recorded default chat is one of those. The chat lands on `Held.backends`
   * and the session stays the one `own` names. Every other road starts the
   * session's own chat, which says whose the session is by itself.
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
  ): Session;
  /**
   * Set every plugin plan's `changed` on the entry it closes over.
   *
   * Run at start and again from `replace`, because a plugin a live fold brings
   * holds an entry nothing has set this on yet.
   */
  wirePlan(): void;
}

/**
 * Whether an action is one the protocol's chat reducer clears a chat's read
 * bit on: a turn that starts or is resumed, and a question put to a person.
 */
const clearsRead = (type: unknown): boolean =>
  type === 'chat/turnStarted' || type === 'chat/turnResume' || type === 'chat/inputRequested';

/**
 * Whether the operator's rule makes a tool ask every time.
 *
 * `eligibleForAutoApproval` is VS Code's map of tool name to boolean, kept in
 * root config, and `false` is the one value that asks. An exact name is read
 * first and answers on its own: a `true` there keeps the tool eligible even
 * when its server is named with `false`. A name that is not there falls back
 * to `<server>/*`, one key for every tool of that server - the part of the
 * name before its first slash.
 *
 * A value that is not a boolean is not the `false` that asks, and a rule that
 * is not an object names nothing: both leave the call as it was. The rule is
 * read where it is kept on each call rather than remembered at a start, so a
 * push reaches a session already running.
 */
export const asksForTool = (rootConfig: Record<string, unknown>, tool: string): boolean => {
  const held = rootConfig.eligibleForAutoApproval;
  if (held === null || typeof held !== 'object' || Array.isArray(held)) return false;
  const rules = held as Record<string, unknown>;
  if (Object.hasOwn(rules, tool)) return rules[tool] === false;
  const slash = tool.indexOf('/');
  if (slash <= 0) return false;
  return rules[`${tool.slice(0, slash)}/*`] === false;
};

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
    options, sessions, byChat, subagents, owners, kept, names, births, about,
    dispatch, log, described, links, resumedSessions,
    sessionHolding, dirOf, operationsMoved, refreshWatched, refreshFacts,
    fire, charged, senders, senderOf, sentBy, forgetSender, keysOf, forgetKeys, enteredIn, inMachine, bringBackOf,
    contributedDefaults, runningSchema, chatSummary, subagentSummary, summaryMoved, summaryKept, learnModels,
    learnAccount, movableMoved,
  } = ctx;

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
    const uri = linked ?? subagentChatUri(session, action.toolCallId);
    return { ...action, _meta: { ...action._meta, subagentChatUri: uri } };
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
   * sent. A backend's state is the agent's answer and not a place this host
   * writes into, so what moves is copied and what did not is the backend's own
   * object.
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
      return { ...part, toolCall: { ...call, _meta: { ...call._meta, subagentChatUri: linked ?? subagentChatUri(session, call.toolCallId) } } };
    });
    return touched ? { ...turn, responseParts: next } : turn;
  });

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

  const sendSubagent = (uri: string, given: Bag): void => {
    const ref = subagents.get(uri);
    if (ref === undefined) return;
    const action = withWorkerUri(uri, given);
    if (decidedAlready(uri, action)) return;
    const was = ctx.stateOf(uri)?.status;
    dispatch(uri, action);
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
      movableMoved(at);
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
    const uri = subagentChatUri(session, toolCallId);
    /*
     * The chat the call is in. A nested worker's call is in the worker chat
     * that spawned it, which is why the parent names a call and not a chat.
     */
    const parentChat = request.parentToolCallId !== undefined && request.parentToolCallId !== ''
      ? subagentChatUri(session, request.parentToolCallId)
      : lead;
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
      summaryMoved(session);
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
   * for `ahp-session:/<id>`, or nothing for any other chat.
   *
   * A default or worker chat's URI embeds its session's, and a session store
   * may hold a chat's title under that URI of it, so a title is looked for
   * there too.
   */
  const formerChatUri = (uri: string, chatUri: string): string | undefined => {
    const former = uriFor(idOf(uri));
    if (former === uri) return undefined;
    if (chatUri === chatUriFor(uri)) return chatUriFor(former);
    const callId = toolCallOfSubagentChat(chatUri);
    return callId !== undefined && chatUri === subagentChatUri(uri, callId) ? subagentChatUri(former, callId) : undefined;
  };
  /** A chat's stored title: under its URI, or else under `formerChatUri`. */
  const titleOf = (uri: string, chatUri: string): string | undefined => {
    const former = formerChatUri(uri, chatUri);
    return kept.chatTitle(idOf(uri), chatUri) ?? (former === undefined ? undefined : kept.chatTitle(idOf(uri), former));
  };
  /** A nested session's record with a new title or a new time, where it has one. */
  const moveNested = (id: string, change: { title?: string }): void => {
    const was = kept.nested?.(id);
    if (was === undefined) return;
    kept.setNested?.(id, { ...was, ...change, modifiedAt: new Date().toISOString() });
  };
  /** Store a chat's title under its URI, and clear one kept under `formerChatUri`. */
  const keepTitle = (uri: string, chatUri: string, title: string): void => {
    kept.setChatTitle(idOf(uri), chatUri, title);
    const former = formerChatUri(uri, chatUri);
    if (former !== undefined && kept.chatTitle(idOf(uri), former) !== undefined) kept.setChatTitle(idOf(uri), former, '');
    // And on the session's own list of chats, so a session served read-only
    // after a restart lists this one under the name it was given.
    ctx.keepChat(uri, chatUri, undefined, false);
  };
  /**
   * Store the title a session was given, beside its chats' own: the name its
   * backend is handed as its default chat starts, and the title a nested
   * session's record lists it by. An empty one is kept as the session having
   * none, and its backend's own title stands.
   */
  const keepSessionTitle = (uri: string, title: string): void => {
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
   * Which harness a session runs on, written down under every id it answers to.
   *
   * The host's own and the agent's, which are one name unless the backend chose
   * a different id for the transcript it writes. Written when a session starts
   * rather than when it is listed: two agents can read the same transcripts, a
   * listing is a read, and a session that was never recorded still has to open
   * somewhere. A backend that names its own id only once a turn has run is
   * recorded at the end of that turn instead, in the chat's own emit.
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
  const keepProvider = (uri: string, agent: Agent, session: Session): void => {
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

  const spawn = (
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
  ): Session => {
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
    if (resuming?.resume !== undefined) resumedSessions.add(uri);
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
     */
    const toolsServer = (ask?: {
      runClient?: RunClientTool;
      toolsChanged?: ToolsChanged;
      mayRun?: MayRunTool;
    }): ToolsEndpoint | undefined => {
      if (bare) return undefined;
      const opened = options.toolsServers?.open(
        ctx.boundTools(uri, chatUri, agent.provider),
        ask?.runClient,
        ask?.toolsChanged,
        ask?.mayRun,
      );
      if (opened === undefined) return undefined;
      const held = ctx.served.get(uri) ?? [];
      held.push(opened);
      ctx.served.set(uri, held);
      return opened;
    };
    /*
     * What this backend is told about the folders it is handed.
     *
     * Read from the host's one `workspaceTrust`, which the last push from any
     * window set, as the reference host reads it for every session it starts,
     * and from the folders the window that sent the turn said yes to one at a
     * time.
     * https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostSessionPrewarmer.ts#L162
     *
     * On a host with people, only a turn the session's owner sends reads it. A
     * turn somebody else sends into this session is not theirs to widen, which
     * is why the two are compared; and an automation, a host tool and a daemon
     * coming back up send nothing, so what they start there is untrusted.
     * Where the host has no people directory there is nobody to compare:
     * `ownerFor` answers `undefined` for every connection, and every start
     * reads the host's value.
     *
     * A worktree this host made is read as the repository it was cut from: it
     * is a folder the window has never opened and so cannot have pushed, and
     * one the host made is trusted exactly when its repository is.
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
      if (options.users !== undefined) {
        const who = sender === undefined ? undefined : ctx.ownerFor(sender);
        if (who === undefined || who !== kept.owner(idOf(uri))) return false;
      }
      const made = ctx.worktreeOf(uri);
      const vouched = made !== undefined && sameFolder(made.path, folder) ? made.repository : folder;
      return trusted(vouched, ctx.rootConfig.workspaceTrust, sender?.trustedFolders);
    };
    /*
     * Whether a command or tool this session runs is answered by the host's
     * rules, or asks every time because the operator said so.
     *
     * The operator's `eligibleForAutoApproval` rule is read first, and without
     * a connection: it is the host's setting rather than a window's, so it
     * applies to every session on the host, an automation's among them. A tool
     * it names is `ask`, which is a call that asks every time and offers no
     * "always" option - before any terminal rule could approve it.
     *
     * The terminal rules and the edit patterns are the host's one value each,
     * which the last push from any window set, as the reference host reads
     * them for every session it runs; on a host with people they answer the
     * owner's turns alone, as `trustedBy` reads trust. Where no window pushed
     * rules the daemon's setting applies - VS Code's table or none - and a
     * pushed empty table is no rules: an empty object is a table with nothing
     * in it, not a window that never spoke.
     * https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/sessionPermissions.ts#L361
     * https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/sessionPermissions.ts#L884
     *
     * Only `approved` is an approval. A command a deny rule named, and a line no
     * rule could read, are both `undefined`, which leaves the backend to ask.
     */
    const getAutoApproval = (kind: AutoApprovalKind, line: string, shell?: CommandShell, tool?: string): AutoApproval | undefined => {
      /* The tool's name: its own for `tool`, and the one that runs the line for `shell`. */
      const named = kind === 'tool' ? line : tool;
      if (named !== undefined && asksForTool(ctx.rootConfig, named)) return 'ask';
      if (kind === 'tool') return undefined;
      if (shell === undefined) return undefined;
      if (options.users !== undefined) {
        const who = sender === undefined ? undefined : ctx.ownerFor(sender);
        if (who === undefined || who !== kept.owner(idOf(uri))) return undefined;
      }
      if (ctx.rootConfig['terminalAutoApproveEnabled'] === false) return undefined;
      const pushed = ctx.rootConfig['terminalAutoApproveRules'];
      const rules = pushed !== null && typeof pushed === 'object'
        ? pushed as TerminalAutoApproveRules
        : options.terminalAutoApproveDefaults === 'none' ? {} : DEFAULT_TERMINAL_AUTO_APPROVE_RULES;
      const patterns = ctx.rootConfig['editAutoApprovePatterns'];
      /*
       * The session's sensitive edit locations, and a write into one asks.
       * Read whole, as the reference host reads a key: the value is the
       * locations where every entry has the string `path` and the boolean
       * `isDirectory` its property requires, and any other value is skipped
       * for the root's config, which declares no such key here, so it is none.
       * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentConfigurationService.ts#L544-L566
       * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/agentHostSchema.ts#L194-L230
       */
      const held: unknown = sessions.get(uri)?.config['sensitiveEditLocations'];
      const sensitive = Array.isArray(held) && held.every((one: unknown) => typeof one === 'object' && one !== null && !Array.isArray(one)
        && typeof (one as Bag).path === 'string' && typeof (one as Bag).isDirectory === 'boolean')
        ? held as SensitiveEditLocation[]
        : [];
      const result = approver.evaluate(line, {
        rules,
        ...(patterns !== null && typeof patterns === 'object' ? { editPatterns: patterns as TerminalAutoApprovePatterns } : {}),
        shell,
        ...(workingDirectory === undefined ? {} : { workingDirectory }),
        sensitive,
      });
      // The protocol's enum is ambient, so its one value is written out rather
      // than reached for: `verbatimModuleSyntax` will not let this file import
      // a const enum at runtime.
      return result === 'approved' ? ('not-needed' as ToolCallConfirmationReason) : undefined;
    };
    /*
     * What the model is told before it starts, in the order it is told.
     *
     * The host's tools' own instructions come first, because they are about
     * tools every session is offered; what the session was asked for joins
     * them after, which is where a request's own words belong - it may name a
     * tool that only its session has, so nothing in front of it could account
     * for that.
     */
    const told = [...ctx.instructions(uri), ...(askedInstructions ?? [])];
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
    const wired: Start = {
      uri,
      chatUri,
      trusted: trustedBy,
      getAutoApproval,
      ...(userSettings === undefined ? {} : { userSettings }),
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
      seedCustomizations: about(agent.provider).seeds,
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
      /*
       * The background tasks this backend reports.
       *
       * Always offered, because a task is a record and needs no store: the
       * host builds the row from what the backend says, and a backend that
       * emitted `chat/backgroundWorkSet` itself has it dropped below.
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
        // A turn the chat began, under its own id: the id a read after a
        // restart holds it by, unless the backend says it wrote it otherwise.
        if (channel === 'chat' && action.type === 'chat/turnStarted') ctx.turnRecordedAs(uri, chatUri, turn, turn);
        const sender = senderOf(turn);
        /*
         * A Plan call the host drew is closed by the turn ending, the way the
         * ACP bridge closes its own: the protocol never closes this row, so
         * nothing else would. Sent before the ending action, which is what a
         * client reads as the turn being over.
         */
        if (channel === 'chat' && (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled'
          || action.type === 'chat/error')) {
          completePlan(chatUri, turn);
        }
        /*
         * The bits of a chat whose backend runs it on another host, as that
         * host says them: kept here, where every row and state of the chat
         * reads them, and the session's read bit follows a read, as it follows
         * any chat's.
         */
        const bit = channel === 'chat' && sessions.get(uri)?.chats.get(chatUri)?.flag !== undefined
          ? (action.type === 'chat/isReadChanged' ? Status.IsRead : action.type === 'chat/isArchivedChanged' ? Status.IsArchived : undefined)
          : undefined;
        const readBefore = (kept.chatFlags(idOf(uri), chatUri) & Status.IsRead) !== 0;
        if (bit !== undefined) {
          const flags = kept.chatFlags(idOf(uri), chatUri);
          const on = bit === Status.IsRead ? action.isRead === true : action.isArchived === true;
          kept.setChatFlags(idOf(uri), chatUri, on ? flags | bit : flags & ~bit);
        }
        dispatch(where, asSent(action), answering);
        if (bit === Status.IsRead) sessionFollows(ctx, uri, chatUri, readBefore);
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
            void summaryKept(uri, true);
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
        // The two ends of a turn, as the host sees them: the backend saying it
        // began, and saying it finished, was stopped or failed. A per-token
        // delta is not an event, because a plugin that wants the stream is a
        // client.
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
        else if (action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled') {
          void fire({
            type: 'turn_end',
            session: uri,
            chat: chatUri,
            turn,
            status: action.type === 'chat/turnCancelled' ? 'cancelled' : 'complete',
            ...(sender === undefined ? {} : { sender }),
          });
        }
        else if (action.type === 'chat/error') {
          const failure = (((action.part ?? {}) as Bag).error ?? {}) as Bag;
          void fire({
            type: 'turn_end',
            session: uri,
            chat: chatUri,
            turn,
            status: 'error',
            error: typeof failure.message === 'string' ? failure.message : 'The turn failed',
            ...(typeof failure.errorType === 'string' ? { errorType: failure.errorType } : {}),
            ...(sender === undefined ? {} : { sender }),
          });
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
         * because `keepProvider` is called before anything is said. Only when
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
         * A chat whose backend runs it on another host has its read bit moved
         * there, and said as the chat's action.
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
            ctx.keepLocalTurn(uri, chatUri, (ctx.stateOf(chatUri)?.turns ?? []) as Bag[], turn);
          }
          ctx.commandTurns.delete(commandKey);
          if (moved !== undefined && !command) {
            if (ownBit) {
              kept.setChatFlags(idOf(uri), chatUri, kept.chatFlags(idOf(uri), chatUri) & ~Status.IsRead);
              dispatch(chatUri, { type: 'chat/isReadChanged', isRead: false });
            }
            const row = chatSummary(uri, chatUri, moved);
            if ((row.origin as Bag | undefined)?.['kind'] !== 'tool' && row.interactivity !== 'hidden') {
              sessionFlag(ctx, uri, Status.IsRead, false, { type: 'session/isReadChanged', isRead: false });
            }
          }
        }
        // A turn starting or finishing moves the catalogue too, and a client
        // watching only the list is the one that most needs telling.
        summaryMoved(uri);
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
              .then(() => summaryKept(uri))
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
         * And whether this chat may be moved, which a turn is the whole of.
         *
         * `chat/error` is here with the two endings the protocol names: it is
         * how a turn that failed ends, and a chat left unmovable by one would
         * be a chat nobody could ever move again.
         */
        if (action.type === 'chat/turnStarted' || action.type === 'chat/turnComplete'
          || action.type === 'chat/turnCancelled' || action.type === 'chat/error') movableMoved(chatUri);
        // And a move the agent asked for is made now, once its turn is over:
        // the one moment the backend can be started again without losing
        // anything.
        if ((action.type === 'chat/turnComplete' || action.type === 'chat/turnCancelled' || action.type === 'chat/error')
          && ctx.moving.get(uri)?.chat === chatUri) {
          const move = ctx.moving.get(uri) as Move;
          ctx.moving.delete(uri);
          void ctx.moveSession(uri, move).catch((error: unknown) => {
            log(`${uri} could not move to ${move.directory}: ${error instanceof Error ? error.message : String(error)}`);
          });
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
       * A turn the backend has written under an id of its own.
       *
       * What the host keeps against a turn is kept against the id the client
       * chose it by, and a backend whose transcript names turns its own way -
       * Claude writes a turn whose id is not a UUID under a uuid of its own - is
       * read back by that other id after a restart, finding nothing. So the
       * record of the turns the chat began keeps it, and a `!` turn after it is
       * anchored to it by that id, with no host learning one backend's
       * transcript format. Nothing where the two ids agree, which is every
       * backend that keeps the ids it was given and which the turn's start
       * recorded already.
       */
      onTurnRecorded: (turnId, transcriptId) => {
        if (transcriptId === turnId) return;
        ctx.turnRecordedAs(uri, chatUri, turnId, transcriptId);
      },
      onHandshake: () => { learnModels(uri); },
      /*
       * The account the running CLI is signed in as, which is the only way this
       * host learns one for a backend that spawns nothing at boot. It is kept
       * and published the same way the probe's is, so a client sees one key
       * rather than two paths that could disagree about who is signed in.
       */
      onAccount: (account) => { learnAccount(agent.provider, account); },
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
    const session = used.create(wired);
    titled = session;
    const held = existing ?? {
      agent: own?.agent ?? agent,
      chats: new Map<string, Session>(),
      defaultChat: chatUri,
      config: own?.config ?? config,
      backends: new Map<string, { agent: Agent; config: Record<string, unknown> }>(),
      workingDirectory,
      additional,
      // The catalogue's value for a session being resumed; now, for one being
      // started. A second chat in a session that already exists takes the
      // session's own, because `sessions.get` answered above.
      createdAt: births.get(uri) ?? new Date().toISOString(),
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
      void checkpointOf(held.workingDirectory, uri, BASELINE_TURN).then(() => summaryKept(uri));
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
     * The answer this chat is born with, written down and not said.
     *
     * A move is offered for a chat by its own state and by its session's row,
     * and both are built from `movable` read now - so nothing has been
     * announced for a change to be compared against, and a chat that can move
     * from its first moment needs no `chat/movableChanged` to say so. This is
     * the one road every start of a backend goes through, so it is also the
     * only place the baseline can be set without a second one to keep in step.
     */
    movableMoved(chatUri);
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
    if (open === undefined) ctx.openState(chatUri, 'chat', ctx.chatSeed(uri, chatUri));
    else if (open.activeTurn === undefined && (!Array.isArray(open.turns) || open.turns.length === 0)) {
      /*
       * A chat that opened with no conversation - its record read nothing, as
       * one inside a machine reads before its host there answers - takes the
       * one its backend holds once it starts, as `chat/truncated` and then
       * `chat/turnsLoaded`: the two actions the reference host refreshes a
       * chat's persisted history with.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L759-L767
       */
      const turns = ctx.chatSeed(uri, chatUri).turns;
      if (Array.isArray(turns) && turns.length > 0) {
        dispatch(chatUri, { type: 'chat/truncated' });
        dispatch(chatUri, { type: 'chat/turnsLoaded', turns });
      }
    }
    ctx.chatMoved(chatUri);
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
    unstamped, withWorkerUri, stampedCalls, asSentChat,
    sendSubagent, endedWorkers,
    openSubagent, formerChatUri, titleOf, keepTitle, keepSessionTitle, keepProvider,
    spawn, wirePlan,
  };
}