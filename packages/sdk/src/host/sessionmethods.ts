import { INTERNAL_ERROR, INVALID_PARAMS, RpcError } from '../rpc.js';
import { idOf, Status, uriFor } from '../sessions/catalog.js';
import { computerId } from '../machines/computers.js';
import { older } from '../sessions/paging.js';
import { namesOf } from '../usage/scopes.js';
import { localPath } from '../resources/fileuri.js';
import { bag, ownerFilter } from '../utils/values.js';
import { configOf } from '../sessions/remotesession.js';
import { CLOSING, noProvider, turnedOff } from './common.js';
import { isDisabled, mayUseAgent, ownershipOf } from '../agents/usable.js';
import { chatIdFor, named, ROOT, schemeOf, spaceOf } from './channels.js';
import { getAgentHostChatId } from '../vscode/chatid.js';
import { chatUriFormatOf, isShapedChatUri } from '../vscode/chatminting.js';
import { preambleOf, withPreamble } from './preamble.js';
import { readAggregate, sessionFlag, settledMessage, startsRead } from './chatactions.js';
import { needsAsyncRewrite } from './attachments.js';
import { fileCompletions } from './filecompletions.js';
import { SEEDS } from './sessionconfig.js';
import { gapLine, schemaGaps } from '../plugins/schemagaps.js';
import { readSkillArgumentHint } from '../vscode/skillcustomizationmeta.js';
import { AhpErrorCodes } from '@microsoft/agent-host-protocol';
import type { ChatOrigin, ChatSummary, SubscribeView } from '@microsoft/agent-host-protocol';
import type { Bag } from '../types/common.js';
import type { Agent } from '../types/agent.js';
import type { Session } from '../types/session.js';
import type { Claimed, Held, LiveSubagent } from './state.js';
import type { ConnectionContext, HostContext } from './context.js';
import type { Connection } from '../types/host.js';
import { formIn, hostCatalogs } from './formlocale.js';

/**
 * The backends whose session config schema has been walked.
 *
 * A backend's schema is made when a client asks for it, so there is no
 * registration to check it at. Each backend is walked once rather than once
 * per client: a form with a hole is one problem line, not one per ask. Keyed by
 * the backend object, because that is the thing whose schema is walked.
 */
const walked = new WeakSet<Agent>();

/**
 * The sessions and chats a connection reads and writes.
 *
 * The snapshot and the turns, the catalogue, the four commands that start and
 * stop a session or a chat, and the two that answer a config before one
 * exists.
 */
export interface SessionMethods {
  subscribe: (params: Record<string, unknown>) => Promise<unknown>;
  fetchTurns: (params: Record<string, unknown>) => Promise<unknown>;
  completions: (params: Record<string, unknown>) => Promise<unknown>;
  listSessions: (params: Record<string, unknown>) => Promise<unknown>;
  createSession: (params: Record<string, unknown>) => Promise<unknown>;
  createChat: (params: Record<string, unknown>) => Promise<unknown>;
  moveChat: (params: Record<string, unknown>) => Promise<unknown>;
  disposeChat: (params: Record<string, unknown>) => Promise<unknown>;
  disposeSession: (params: Record<string, unknown>) => Promise<unknown>;
  resolveSessionConfig: (params: Record<string, unknown>) => Promise<unknown>;
  sessionConfigCompletions: (params: Record<string, unknown>) => Promise<unknown>;
}

/**
 * The protocol's `moveChat`, and the move a session tool is made of.
 *
 * One function, because a chat moves the same way whichever door it is asked
 * at: the protocol's method and a tool's call resolve the destination, refuse
 * in the reference's words, and change the chat's ownership in one act - see
 * `movedTo`. The connection and the credentials are the caller's, since a tool
 * runs in a turn rather than a method, and the connection is what an older
 * window's visibility is read against. A caller with no connection - a turn
 * this host holds no record of - is refused none of it, and spends no
 * credentials it does not have.
 */
export function createChatMover(ctx: HostContext): (
  connection: Connection | undefined,
  tokensFor: (provider: string) => Record<string, string>,
  params: Record<string, unknown>,
) => Promise<{ session: string }> {
  const {
    activeSessionsChanged, beside, byChat, chatIdOf, chatMoveRefusal, chatSummary, chatsReordered, claims,
    dispatch, getProviderForChat, hasActiveTurn, isStructurallyMovable, keepChat, kept, log, markSessionProvisional,
    markSummaryDirty, options, orderChats, recordSessionProvider, sessionAdded, sessionMoveRefusal, sessionVisible,
    sessions, subagentSummary, subagents, unheld, updateChatMovability,
  } = ctx;

  /**
   * The anchor that places a moved chat after the destination's last chat.
   *
   * A client's `moveChat` names a chat, or names none for the beginning of the
   * catalogue, as the protocol says. `move_session` offers a model "omit
   * `after` to place it at the end" instead, and VS Code resolves that to the
   * destination's last visible chat before it moves. So a tool passes this
   * word, and the beginning stays what a client's absent `after` means.
   * https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentService.ts#L7733-L7751
   */
  const END = 'end';

  /**
   * Where a moved chat goes in the destination's order, the chat itself taken
   * out: after the named chat, after the last one, or first.
   */
  const placedAt = (order: string[], anchor: string | undefined): number => {
    if (anchor === undefined) return 0;
    if (anchor === END) return order.length;
    return order.indexOf(anchor) + 1;
  };

  /**
   * A chat taken out of the session it is in and given to another.
   *
   * The two destinations the protocol serves beyond a reorder: a session this
   * host is already running, or one made for the chat. Both are the same act,
   * as the reference host moves a chat: its ownership changes in one step,
   * and the chat keeps its state, its canvases and its runtime, which goes on
   * under the session it was launched for until the chat's next turn
   * boundary starts it again under the session that holds it now. The store
   * and this host's own maps are changed first, and then everything is
   * published, so a client that is told `session/chatRemoved` on the source
   * is looking at a chat the destination already holds.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1893-L1904
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/AGENTS.md#L374
   *
   * `to` is the destination session, or nothing where the move asked for a
   * session of the chat's own. That one is made here with the source's agent,
   * owner and config and the chat's folders, its id the chat's own backend id,
   * so the session a restart resumes it by is the name the conversation is
   * already kept under.
   */
  const movedTo = async (
    chatUri: string,
    found: { uri: string; chat: Session },
    held: Held,
    to: string | undefined,
    anchor: string | undefined,
    tokensFor: (provider: string) => Record<string, string>,
  ): Promise<{ session: string }> => {
    /*
     * The name its backend keeps the conversation under, which a session made
     * for the chat is named by and which its relaunch resumes.
     */
    const own = found.chat.agentId() as string;
    /*
     * The folders the chat works in, which travel with it: its root is the
     * session's own and its peers are the ones it was opened with, so a chat
     * moved beside a session working somewhere else goes on where it was.
     */
    const folders = beside.get(chatUri) ?? held.additional;
    const into = to ?? uriFor(own);
    if (to === undefined) {
      named(into, 'session');
      unheld(into);
      // Its row goes out whole once it is added, and moves from then on.
      markSessionProvisional(into);
      /*
       * The owner and the config are the source session's: a session made for
       * one of its chats is the same person's work under the same settings.
       */
      kept.setOwner(idOf(into), kept.owner(idOf(found.uri)));
      kept.setConfig(idOf(into), { ...held.config });
    }
    /*
     * Out of the source, in the store and here: the chat's own record - its
     * title, its senders and its entry on the session's chat list - and the two
     * maps that say which session is holding it. The store is told the turns
     * the chat owns, because it cannot find them itself: a sender is kept per
     * session and turn, and every chat of a session writes into the same map.
     *
     * The claim is set as well as dropped, and the order matters: `drop` keeps
     * the claim a key already has, and `Claiming.set` will not overwrite one,
     * so a chat that has just left `byChat` still answers as the source's chat
     * until this line puts it where it now belongs.
     */
    const turns = ctx.liveTurnsOf(found.uri, chatUri, found.chat.allTurns() as Bag[]).map((one) => String(one.id ?? ''));
    /*
     * What it runs on for the properties a chat may set, read before it leaves
     * and kept as its own where it goes, as VS Code's move gives a moved chat
     * its effective values as its own: the session it joins has a config of
     * its own, and the chat goes on as it was.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/AGENTS.md#L376
     */
    const ownValues = held.backends.has(chatUri) ? {} : ctx.effectiveChatConfigValues(found.uri, held, chatUri);
    kept.moveChat(idOf(found.uri), idOf(into), chatUri, turns);
    // And the outputs its terminals kept and its local turns, which are the
    // chat's own.
    ctx.moveChatOutputs(found.uri, into, chatUri);
    ctx.moveChatLocalTurns(found.uri, into, chatUri);
    const road = byChat.get(chatUri);
    held.chats.delete(chatUri);
    byChat.drop(chatUri);
    claims.set(chatUri, { kind: 'chat', of: into });
    if (to === undefined) {
      const now = options.now?.() ?? new Date();
      const made: Held = {
        agent: held.agent,
        chats: new Map<string, Session>(),
        defaultChat: chatUri,
        config: { ...held.config },
        backends: new Map(),
        workingDirectory: held.workingDirectory,
        additional: folders,
        // Dated now, as VS Code's host dates the session it makes for a moved chat.
        // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L9141-L9142
        createdAt: now.toISOString(),
        modifiedAt: now.toISOString(),
        quietSince: now.getTime(),
      };
      sessions.set(into, made);
      ctx.births.set(into, made.createdAt);
      ctx.names.set(idOf(into), into);
      ctx.touch(into);
    }
    const there = sessions.get(into) as Held;
    there.chats.set(chatUri, found.chat);
    if (road !== undefined) byChat.set(chatUri, { ...road, uri: into });
    // Written down as the destination's, which a restart starts it again in,
    // the default chat of a session made for it.
    keepChat(into, chatUri, chatIdOf(into, chatUri, own), there.defaultChat === chatUri);
    ctx.keepChatOwnConfigValues(into, chatUri, ownValues);
    // The peers it works beside, which are the chat's own from here on.
    if (folders !== undefined) beside.set(chatUri, folders);
    ctx.chatRelaunches.set(chatUri, {
      credentials: tokensFor(held.agent.provider),
      directory: ctx.chatRelaunches.get(chatUri)?.directory ?? held.workingDirectory,
    });
    /*
     * The chat's canvases stay with it, as the reference host's move keeps a
     * chat's state, changesets, canvases and in-progress turn: a canvas's
     * resource names the chat, and the chat keeps its URI.
     */
    if (to === undefined) recordSessionProvider(into, held.agent, found.chat);
    /*
     * And every worker chat the moved chat carries, which the protocol says
     * goes with it: a worker is a conversation inside a call of this chat, and
     * one left behind would be a chat whose call is in another session.
     *
     * Walked to the bottom, because a worker's own call can open another one.
     * The URI is left exactly as it is - it names the session the worker was
     * opened in, and a client holding that name must not be handed a second
     * one. What moves is the claim, which is what a later read of the worker,
     * and of the session holding it, is answered from.
     */
    const carried: string[] = [];
    const seen = new Set([chatUri]);
    let frontier = [chatUri];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const [one, ref] of subagents) {
        if (ref.session !== found.uri || !frontier.includes(ref.parentChat) || seen.has(one)) continue;
        seen.add(one);
        carried.push(one);
        next.push(one);
      }
      frontier = next;
    }
    for (const one of carried) {
      const ref = subagents.get(one) as LiveSubagent;
      ref.session = into;
      claims.set(one, { kind: 'chat', of: into });
    }
    /*
     * Where the chat sits in the destination, which is after the anchor, after
     * the last chat, or first: an absent `after` means the beginning, and the
     * order the session holds is the one the next process starts its chats
     * again in.
     */
    const order = [...there.chats.keys()].filter((one) => one !== chatUri);
    order.splice(placedAt(order, anchor), 0, chatUri);
    const before = new Map(there.chats);
    there.chats.clear();
    for (const one of order) there.chats.set(one, before.get(one) as Session);
    orderChats(into, order);
    /*
     * Published in the order the protocol gives: the chat leaves the source,
     * arrives at the destination, the destination's list is said whole, and
     * both rows are re-read. Removal first, because a client that hears the
     * chat arrive before it hears it leave is a client holding it twice. A
     * destination that was there before has its default chat take its own
     * title first, as the reference host's move does.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1921
     *
     * A session made for the chat is announced once the chat has left the
     * source, ready and holding it in its catalogue, as VS Code's host
     * promotes a chat: its state is made ready with the chats it takes, so
     * neither a ready nor a chat added is said on it.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2025-L2079
     */
    if (to !== undefined) ctx.snapshotDefaultChatTitle(into);
    dispatch(found.uri, { type: 'session/chatRemoved', chat: chatUri });
    for (const one of carried) dispatch(found.uri, { type: 'session/chatRemoved', chat: one });
    if (to === undefined) {
      sessionAdded(into);
      activeSessionsChanged();
    }
    else {
      dispatch(into, { type: 'session/chatAdded', summary: chatSummary(into, chatUri, found.chat) });
      for (const one of carried) {
        const ref = subagents.get(one);
        if (ref !== undefined) dispatch(into, { type: 'session/chatAdded', summary: subagentSummary(one, ref) });
      }
      await chatsReordered(into);
    }
    /*
     * The read bits, where an unread chat that counts toward its session's
     * read state moved: a destination that was read is unread now, and a
     * source that was unread is read once every chat left in it that counts
     * is, as the reference host synchronizes them after a move. A session
     * made for the chat starts with the chat's own.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2131-L2145
     */
    const counted = readAggregate(ctx, into).find((one) => one.uri === chatUri);
    if (counted !== undefined && !counted.read) {
      const left = readAggregate(ctx, found.uri);
      if ((kept.flags(idOf(found.uri)) & Status.IsRead) === 0 && left.every((one) => one.read)) {
        sessionFlag(ctx, found.uri, Status.IsRead, true, { type: 'session/isReadChanged', isRead: true });
      }
      if (to !== undefined && (kept.flags(idOf(into)) & Status.IsRead) !== 0) {
        sessionFlag(ctx, into, Status.IsRead, false, { type: 'session/isReadChanged', isRead: false });
      }
    }
    markSummaryDirty(found.uri);
    markSummaryDirty(into);
    // Whether it may move again, which a chat that became its session's own
    // chat may not.
    updateChatMovability(chatUri);
    log(`moved ${chatUri} from ${found.uri} to ${into}`);
    return { session: into };
  };

  return async (
    connection: Connection | undefined,
    tokensFor: (provider: string) => Record<string, string>,
    params: Record<string, unknown>,
  ): Promise<{ session: string }> => {
    const chatUri = String(params.channel ?? '');
    const found = byChat.get(chatUri);
    if (!found)
      throw new RpcError(-32001, `No chat at ${chatUri}`);
    const held = sessions.get(found.uri);
    if (!held)
      throw new RpcError(AhpErrorCodes.SessionNotFound, `No agent for session: ${found.uri}`);
    /*
     * Each refusal is the reference's: InvalidParams, its words, and the
     * `reason` from its fixed set in `data`, for a client to explain it by.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L222-L230
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatMove.ts#L90-L144
     */
    const refused = (reason: string, message: string): RpcError => new RpcError(INVALID_PARAMS, message, { reason });
    /*
     * Moving chats is `chatMoves.enabled`, off until a window turns it on,
     * and asked first, as the reference host asks it.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7892-L7896
     */
    if (ctx.rootConfig['chatMoves.enabled'] !== true) throw refused('disabled', 'Moving chats is not enabled.');
    /*
     * A chat of another backend stays where it is.
     *
     * A move starts the chat again in the session it lands in, on that
     * session's backend - which for a chat of another backend is a harness
     * that has never seen its transcript. Refused by saying whose the chat
     * is, before anything has been touched - and said here rather than only
     * by `movable`, which answers the client's move control with no room for
     * a reason.
     */
    const serving = getProviderForChat(held, chatUri);
    if (serving !== held.agent) {
      throw refused('differentProvider', 'Chats can only move between sessions of the same agent.'
        + ' Turn on chats with their own agents to move it to a session of another agent.');
    }
    /*
     * A chat whose agent is off stays where it is. The session it moves into
     * is of that same agent, which the check below requires, so one answer
     * covers both ends.
     * https://github.com/microsoft/vscode/blob/1564f100807a/src/vs/platform/agentHost/node/agentService.ts#L9736-L9738
     */
    if (isDisabled(options.disabledAgents?.(), held.agent.provider)) {
      throw refused('agentUnavailable', turnedOff(held.agent.provider));
    }
    /*
     * A chat a move is made of, checked now rather than read from `movable`,
     * which also says the chat's state: a move refuses that with its own
     * reason. Running nothing is this host's, since a move here closes a
     * process and starts another (plan host/47-p1).
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L9214-L9223
     */
    if (!isStructurallyMovable(chatUri) || hasActiveTurn(chatUri)) throw refused('notMovable', `Chat ${chatUri} can't be moved.`);
    const destination = (typeof params.destination === 'object' && params.destination !== null
      ? params.destination
      : {}) as Record<string, unknown>;
    const kind = String(destination.kind ?? '');
    if (kind !== 'session' && kind !== 'newSession') {
      throw new RpcError(INVALID_PARAMS, kind === ''
        ? 'a move needs a destination'
        : `a ${kind} destination is not one this host serves yet`);
    }
    // A chat with no turn yet, refused before anything else is asked of the
    // move, as VS Code's host refuses it.
    const unstarted = chatMoveRefusal(chatUri, kind === 'newSession');
    if (unstarted?.reason === 'notStarted') throw refused(unstarted.reason, unstarted.message);
    // The anchor, which the protocol requires to be another chat of the
    // destination and never the chat itself. `end` is the last chat, which a
    // destination that holds none resolves to the beginning.
    const anchor = destination.after === undefined ? undefined : String(destination.after);
    if (anchor !== undefined && anchor === chatUri) throw refused('invalidAnchor', 'A chat can\'t be placed after itself.');
    /*
     * What the sessions and the chat itself refuse a move between sessions
     * for, in VS Code's order: each session archived or changing its
     * workspace, the source first, then the chat with no folder. A reorder
     * within the session is refused none of them.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L9505-L9525
     */
    const refuseState = (target: string | undefined): void => {
      for (const one of target === undefined ? [found.uri] : [found.uri, target]) {
        const refusal = sessionMoveRefusal(one);
        if (refusal !== undefined) throw refused(refusal.reason, refusal.message);
      }
      const refusal = chatMoveRefusal(chatUri, target === undefined);
      if (refusal !== undefined) throw refused(refusal.reason, refusal.message);
    };
    // A session made for the chat, which has no chats to be placed among yet.
    if (kind === 'newSession') {
      refuseState(undefined);
      return await movedTo(chatUri, found, held, undefined, anchor, tokensFor);
    }
    /*
     * The source's own session, which is the reorder. Anywhere else is a move
     * between sessions, and this host makes one only where it can start the
     * chat there - which is a session of the same agent, on the same machine.
     */
    const to = String(destination.session ?? '');
    /*
     * A session this client may not see is not one it can move a chat
     * into, as the reference host answers an older VS Code window. A call
     * from a turn this host holds no connection for has no window to be
     * older than, so nothing is hidden from it.
     * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2348-L2350
     */
    if (connection !== undefined && !sessionVisible(connection, to)) throw new RpcError(-32001, `Session not found: ${to}`);
    if (to === found.uri) {
      if (anchor !== undefined && anchor !== END && !held.chats.has(anchor))
        throw refused('invalidAnchor', `Chat ${anchor} is not a visible chat of ${found.uri}.`);
      /*
       * The new order, which is the old one with this chat taken out and put
       * back where it was asked for. First when no anchor was named, which is
       * what the protocol says an absent `after` means; last for `end`, which
       * is what `move_session` means by it.
       */
      const order = [...held.chats.keys()].filter((one) => one !== chatUri);
      order.splice(placedAt(order, anchor), 0, chatUri);
      const chats = new Map(held.chats);
      held.chats.clear();
      for (const one of order) held.chats.set(one, chats.get(one) as Session);
      /*
       * And written down, so the order is the one the next process starts
       * them again in. A move a restart undid would be a move that lasted
       * until the daemon was restarted, which a person would find out about
       * days later.
       */
      orderChats(found.uri, order);
      // The catalogue's own list, which names every chat the session lists -
      // the workers included, because they are chats of the session too.
      await chatsReordered(found.uri);
      markSummaryDirty(found.uri);
      log(`moved ${chatUri} in ${found.uri}`);
      return { session: found.uri };
    }
    /*
     * Somewhere else, then: another session this host is running, of the same
     * agent and on the same machine.
     *
     * The same agent because a conversation belongs to the harness that wrote
     * it, in that harness's own format and on that harness's own disk, and
     * the same machine because the chat's folders are paths on the machine
     * its backend ran on. Both are refused with a sentence that names the
     * difference, and refused before anything has been touched.
     */
    const dest = sessions.get(to);
    if (dest === undefined) throw refused('destinationNotFound', `Session ${to} is not available.`);
    if (held.agent.provider !== dest.agent.provider) {
      throw refused('differentProvider', 'Chats can only move between sessions of the same agent.'
        + ' Turn on chats with their own agents to move it to a session of another agent.');
    }
    // Machines are this host's own, so the reference has no word for this
    // one: its reason is the set's for a move a host does not make.
    const mine = computerId(held.config.computer);
    const theirs = computerId(dest.config.computer);
    if (mine !== theirs) {
      throw refused('unsupported', `a move between computers is not supported yet: ${chatUri} runs on`
        + ` ${mine ?? 'this host'} and ${to} on ${theirs ?? 'this host'}`);
    }
    refuseState(to);
    if (anchor !== undefined && anchor !== END && !dest.chats.has(anchor))
      throw refused('invalidAnchor', `Chat ${anchor} is not a visible chat of ${to}.`);
    return await movedTo(chatUri, found, held, to, anchor, tokensFor);
  };
}

export function createSessionMethods(ctx: HostContext, conn: ConnectionContext): SessionMethods {
  const { connection } = conn;
  const {
    about, activeSessionsChanged, admitted, agents, projectSnapshot, backendsOwn, beginOrRun, beginTurn, beside, byChat,
    charged, getProviderForChat, chatConfig, chatIdOf, chatShown,
    chatSummary, chatsReordered, claimable, claims, dir, dispatch, dropChat, flushDeltas,
    forWhom, forgetSendersIn, formOrdered, hold,
    isolating, keepChat, recordSessionProvider, kept, leadOf, log, madeFrom, meantBy, messageAttachments, messageFrom, modelIn,
    isStructurallyMovable, sessionMoveRefusal, chatMoveRefusal, hasActiveTurn, updateChatMovability, createProviderSession, openedBy, options, orderChats, oweTree,
    ownerFor, owners, restoreSession, placedIn, presence, replayable, removeSession, retool, scoping, scratchFolder, seeded,
    projectActionForClient, sessionAdded, sessionChannel, markSessionProvisional, sessionFor, sessionSchema, sessionVisible, sessions, resolveCreatedSessionConfig,
    snapshotOf, spawn, subagentSummary, subagents, markSummaryDirty, unheld, visible, unavailableProvider, wake,
  } = ctx;

  /**
   * The most rows this host will serve in one page, however many were asked for.
   *
   * The protocol says a server MAY impose its own cap, and one exists so that a
   * client asking for a million does not turn a page into the whole catalogue
   * plus the work of slicing it.
   */
  const PAGE_CAP = 500;

  /**
   * The most rows a client that asked for no page size is handed at once.
   *
   * Deliberately far above any real catalogue rather than at a page's size:
   * neither client that connects to this host reads `nextCursor`, so anything
   * smaller would be a catalogue silently cut down to it. This is not a page
   * size - it is the point past which a single frame stops being servable at
   * all, and reaching it is written to the log because the client cannot see it.
   */
  const PAGE_MOST = 1_000;

  /**
   * The most chats `#chat:` will offer in one answer.
   *
   * VS Code's `MAX_RESULTS`, unchanged: a person picking a chat is looking at a
   * list in a box, and the newest twenty of a session's chats are the ones they
   * are reaching for.
   */
  const CHAT_MOST = 20;

  /** What a `#` says to introduce a chat reference, as VS Code spells it. */
  const CHAT_PREFIX = 'chat:';

  /**
   * A pagination cursor, which is opaque by contract.
   *
   * It is the resource of the last row served, encoded - so it says nothing a
   * client is invited to read, parse or keep. The protocol says cursors are
   * server-defined and MUST be treated as opaque; encoding is what makes that
   * true rather than merely asked for.
   */
  const sealed = (resource: string): string => Buffer.from(resource, 'utf8').toString('base64url');

  /** The resource a cursor named, or nothing a row will match. */
  const opened = (cursor: string): string => {
    try { return Buffer.from(cursor, 'base64url').toString('utf8'); }
    catch { return ''; }
  };

  /**
   * A title on one line.
   *
   * Ported from VS Code's `sanitizeChatTitle`: the inserted `#chat:<title>`
   * token and the attachment's `label` both stop being one token when a title
   * carries a newline or a run of spaces, and neither is a difference the person
   * reading the list can see.
   */
  const oneLine = (title: string): string => title.replace(/\s+/g, ' ').trim();

  /**
   * What a `#` token is asking a chat for, or nothing when it is a file.
   *
   * VS Code's `extractChatToken` answers this by walking back from the cursor;
   * the walk is already done here - the pattern the caller matched found the
   * token and its range - so what is left of the port is the same three answers
   * on the text after the `#`: a filter once the word says `chat:`, an empty
   * filter while the rest of it is still a prefix of `chat:` (`#`, `#ch`,
   * `#chat`), and nothing at all otherwise, which leaves the word to the file
   * list rather than answering a file to somebody reaching for a chat.
   */
  const chatFilter = (raw: string): string | undefined => {
    const lower = raw.toLowerCase();
    if (lower.startsWith(CHAT_PREFIX)) return raw.slice(CHAT_PREFIX.length);
    if (CHAT_PREFIX.startsWith(lower)) return '';
    return undefined;
  };

  /**
   * A chat's first message, begun as the chat's first turn.
   *
   * Its attachments written, its start said as this host's, and the turn
   * begun as a client's is: one this host will not run, or whose preparation
   * fails, ends in an error on the chat, which keeps the prompt, as VS Code's
   * host accepts an initial message once the chat is made. Answered once the
   * start is said, whatever the turn comes to.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7670-L7698
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTurnService.ts#L70-L73
   */
  const acceptInitialMessage = async (uri: string, chat: Session, provider: string, message: Bag): Promise<void> => {
    const turnId = crypto.randomUUID();
    const since = Date.now();
    const start = (said: Bag): void => {
      dispatch(chat.chatUri, { type: 'chat/turnStarted', turnId, startedAt: new Date(since).toISOString(), message: said });
    };
    /*
     * The turn ended in an error, with its `turn_end`: `rejected` for a start
     * refused, which nobody holds the message of once the chat is made, as the
     * reference host starts a chat's first turn, and `error` for a preparation
     * or a send that failed.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7697
     */
    const ended = (ending: 'rejected' | 'error', errorType: string) => (why: string): void => {
      dispatch(chat.chatUri, {
        type: 'chat/error',
        turnId,
        duration: Math.max(0, Date.now() - since),
        part: { kind: 'error', error: { errorType, message: why } },
      });
      const error = { errorType, message: why };
      ctx.raiseTurnEnd({
        session: uri, channel: chat.chatUri, turnId,
        reason: ending === 'rejected' ? { kind: 'rejected', error, recoverable: false } : { kind: 'error', error, resumable: false },
      });
    };
    let settled: Bag;
    try {
      settled = needsAsyncRewrite(message, kept, idOf(uri)) ? await settledMessage(ctx, connection, message, uri) : message;
    }
    catch (error) {
      start(message);
      ended('error', 'attachmentPreparationFailed')(error instanceof Error ? error.message : String(error));
      return;
    }
    start(settled);
    const attached = messageAttachments(settled, connection);
    if (attached.refusal !== undefined) {
      ended('error', 'sendFailed')(attached.refusal);
      return;
    }
    void beginTurn(
      () => beginOrRun(chat, provider, turnId, String(settled.text ?? ''), modelIn(settled.model), messageFrom(settled), connection,
        attached.attachments, () => undefined, () => ctx.cancelledTurns.get(chat.chatUri)?.has(turnId) === true),
      ended('rejected', 'rejected'),
      ended('error', 'sendFailed'),
    );
  };

  // The protocol's own move, which the mover above serves and a session tool reaches too.
  const moveChat = createChatMover(ctx);

  const methods: SessionMethods = {
    /**
     * A snapshot, and everything that happened while it was being taken.
     *
     * `snapshotOf` is asynchronous, and until it returns this connection
     * is not on the watch list - so an action dispatched in that window
     * goes to nobody, and is in no snapshot taken before it happened. It
     * is a small window and it is wide enough: a client that subscribes
     * and sends in the same breath - which is what opening a session from
     * a composer *is* - loses the `chat/turnStarted` its own message
     * caused. What follows is worse than one missing action, because
     * every delta after it names a turn the client was never told about
     * and the reducer drops each one in turn: the transcript stays empty
     * for the rest of the session, and nothing anywhere reports an error.
     *
     * Replayed from the buffer rather than closed by joining the watch
     * list first, because that order has a hole of its own - the client
     * would be sent actions the snapshot already contains, and a
     * `chat/delta` applied twice is the word written twice. The sequence
     * number is what tells "already in the snapshot" from "after it", and
     * this host keeps one for exactly this reason.
     */
    /**
     * Watch a channel, and answer with what it holds now.
     *
     * Subscribing twice to one channel answers twice. Nothing here marks a
     * subscription pending while its snapshot is taken, so a second
     * request that arrives during the first is an ordinary second request
     * rather than a replacement - the reference host cancels the earlier
     * one and answers it `-32001` naming a channel it is actively serving,
     * which reads like a session that does not exist.
     */
    subscribe: async (params) => {
      const channel = String(params.channel ?? '');
      /*
       * Text still in the window goes out before the snapshot is read.
       *
       * A snapshot of a chat is built from the parts the backend is writing
       * into, so it already carries the words a held delta would say. Sent
       * after it, that delta writes them a second time - and the sequence
       * number is exactly what says so: flushed first, the delta is at or
       * below the number the snapshot is taken at, and no client is replayed
       * a word it was handed.
       */
      flushDeltas();
      /*
       * A channel an older VS Code window may not see is refused, before
       * anything is read for it, as the reference host refuses it.
       * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1270-L1273
       */
      // What it means here: the channel it watches whatever its spelling, as
      // every envelope goes under the host's own channel.
      const meant = meantBy(channel);
      if (!visible(connection, meant)) throw new RpcError(-32001, `Resource not available to this client: ${channel}`);
      /*
       * The view, read here because the snapshot is what it shapes.
       *
       * A subscribe that names none is owed every turn a chat retains, so the
       * difference between no view and a view has to survive this call. Read
       * as a view only when it is an object: any other value names no window
       * rather than a window of nothing.
       */
      const asked = params.view;
      const view = typeof asked === 'object' && asked !== null ? asked as SubscribeView : undefined;
      /*
       * A state channel's place on this connection, taken before the snapshot
       * is read: a watched channel's that stands, or a new one. A subscribe
       * whose place another subscribe or an unsubscribe took while it was read
       * is refused, as the reference host refuses one, and its snapshot
       * answers nobody. A telemetry channel and a resource watch are answered
       * at once there, and hold no place here.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2130-L2199
       */
      const placed = schemeOf(channel) !== 'ahp-otlp' && schemeOf(channel) !== 'ahp-resource-watch';
      const watched = connection.activeSubscriptions.has(meant);
      const place = (watched ? conn.subscriptions.get(meant) : undefined) ?? {};
      if (placed) conn.subscriptions.set(meant, place);
      const kept = (): boolean => !placed || conn.subscriptions.get(meant) === place;
      const overtaken = (): RpcError => new RpcError(INTERNAL_ERROR, `Subscription cancelled: ${channel}`);
      let snapshot: Awaited<ReturnType<typeof snapshotOf>>;
      try {
        snapshot = await snapshotOf(meant, connection, view);
      }
      catch (error) {
        if (!kept()) throw overtaken();
        if (placed && !watched) conn.subscriptions.delete(meant);
        throw error;
      }
      if (!kept()) throw overtaken();
      if (placed) conn.subscriptions.set(meant, {});
      // A stateless channel is watched from here on and answered with no
      // snapshot, and nothing of it is held to replay.
      if (snapshot === undefined) {
        connection.activeSubscriptions.add(meant);
        return {};
      }
      // Answered to this connection after the snapshot is taken: a session's
      // chats the ones it may see.
      projectSnapshot(connection, channel, snapshot);
      connection.activeSubscriptions.add(meant);
      // Given a baseline, so it owes this client none.
      ctx.clearBaselineDebt(connection.clientId, meant);
      // A client is now in this session, which is the moment a plugin that
      // reaches whoever is working in one hears about. Said after the
      // snapshot, so a subscription that was refused for the session it named
      // has opened nothing.
      openedBy(meant, connection.clientId);
      // The session it is of is the most recent, and one it opened may put
      // another past the residency limit.
      // https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L11633-L11634
      ctx.touch(meant);
      ctx.reconcile();
      // Nothing is awaited between the line above and this one, so
      // nothing can be dispatched in between: what the filter finds is
      // the whole of what was missed, and what it leaves is already in
      // the snapshot or still to come by the ordinary route.
      const at = typeof snapshot.fromSeq === 'number' ? snapshot.fromSeq : 0;
      for (const held of replayable) {
        if (held.channel === meant && held.serverSeq > at) {
          const envelope = projectActionForClient(connection, held);
          if (envelope !== undefined) connection.peer.notify('action', envelope);
        }
      }
      return { snapshot };
    },
    /**
     * Older turns, on demand.
     *
     * The result is deliberately empty: the turns arrive as
     * `chat/turnsLoaded` on the channel, so every client watching the chat
     * gets the page - not only the one that asked for it. A host that
     * answered in the result would be telling one client something the
     * others would never learn.
     */
    fetchTurns: async (params) => {
      const channel = meantBy(String(params.channel ?? ''));
      /*
       * A chat's or a session's, and never another kind of name that carries
       * an id.
       *
       * The transcript a page is read from is chosen by the id of the session
       * behind the channel, so a terminal, a file or a watch called after a
       * session's id would be answered with that session's turns - sent, as
       * `turnsLoaded` is, to everyone watching *that* name. Never a session's
       * id read out of a file, a terminal or a watch, which is the guard
       * `snapshotOf` makes and this is the same one. A chat no session holds
       * or records is no chat here, and neither is a session whose agent this
       * host is not serving. Each is refused as the reference host refuses a
       * channel it holds no chat state for, in its words.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2455-L2459
       */
      const notFound = (): RpcError => new RpcError(AhpErrorCodes.SessionNotFound, `Session not found: ${channel}`);
      if (!sessionChannel(channel)) throw notFound();
      const live = byChat.get(channel);
      const owning = live?.uri ?? sessionFor(channel);
      if (spaceOf(owning) === 'chat' || unavailableProvider(idOf(owning)) !== undefined) throw notFound();
      const all = live ? live.chat.allTurns() : await restoreSession(idOf(owning));
      if (!all) throw notFound();
      const asked = typeof params.cursor === 'string' ? params.cursor : undefined;
      /*
       * No cursor asks for whatever is next, and the host keeps no record of
       * which window a connection was given. A snapshot that named no view
       * holds every retained turn, so nothing is older than it; the protocol
       * asks for that page "if any", so none is an answer.
       */
      if (asked === undefined) return {};
      const page = older(all, asked);
      if (!page) {
        // Guessing at a cursor this host did not issue would answer a
        // question about old turns with new ones, and the client would
        // page for ever without noticing.
        throw new RpcError(INVALID_PARAMS, `Unrecognised cursor ${String(asked)}`);
      }
      dispatch(channel, {
        type: 'chat/turnsLoaded',
        // The action declares no `_meta` of its own, so the turns are the
        // whole of it: a client paging back through a conversation must not
        // find the sender gone on the oldest page.
        turns: ctx.withSender(idOf(owning), page.turns),
        ...(page.turnsNextCursor ? { turnsNextCursor: page.turnsNextCursor } : {}),
      });
      return {};
    },
    /**
     * Completions for the text a person is composing.
     *
     * Answers `/` with the commands available to the session, or the
     * harness-wide list when it has none yet. Answers `#chat:` with the other
     * chats of the session, and a `#` still on its way there - `#`, `#ch` -
     * with those chats and then the files, because VS Code asks every provider
     * at once and a client shows both. `@` and a `#` that cannot become
     * `#chat:` are a file, and both are answered with the same items.
     */
    completions: async (params) => {
      if (String(params.kind ?? '') !== 'userMessage')
        return { items: [] };
      const text = String(params.text ?? '');
      const offset = typeof params.offset === 'number'
        ? Math.max(0, Math.min(params.offset, text.length))
        : text.length;
      const before = text.slice(0, offset);
      /*
       * An at-sign or a hash at the start of a word, and a path since.
       *
       * Answered before the slash, because the two cannot both match and
       * a file is the more specific question. What follows may contain
       * slashes - `@src/ho` is a path being typed, not a command - so the
       * pattern stops at whitespace rather than at a separator.
       *
       * The hash is VS Code's other spelling of "a file here", which its own
       * host answers from the same provider and with the same items as the
       * at-sign - so this answers both with one body, and the only thing the
       * trigger changes is the character put back in front of the path. It is
       * also how `#chat:` begins, which is not a file at all, so the hash is
       * read first for that and answered with the session's chats.
       */
      const asked = /(?:^|\s)([@#])(\S*)$/.exec(before);
      if (asked) {
        const trigger = asked[1] ?? '@';
        const typed_ = asked[2] ?? '';
        const from = offset - typed_.length - 1;
        const asking = meantBy(String(params.channel ?? ''));
        const here = byChat.get(asking);
        const held_ = sessions.get(here?.uri ?? asking);
        const chat_ = here?.chat ?? (held_ === undefined ? undefined : leadOf(held_));
        /*
         * The files the word names, which is what an at-sign and a hash both
         * ask for: the files under every working directory of the session,
         * ranked as VS Code's provider ranks them. Each is a reference, not
         * the bytes: the file is fetched with `resourceRead` if anything needs
         * it, and a completion that carried a megabyte would carry it per
         * keystroke.
         *
         * Nothing rather than an error where there is no listing: this same
         * command serves `/`, and a host with none still has commands to offer.
         */
        const files = async (): Promise<Bag[]> => {
          if (!options.workspaceFiles) return [];
          const stated = ctx.stateOf(here?.uri ?? asking)?.workingDirectories;
          const roots = chat_?.workingDirectories() ?? (Array.isArray(stated) ? stated.filter((one): one is string => typeof one === 'string') : []);
          return fileCompletions(
            roots.map((one) => localPath(one)),
            { token: typed_, triggerChar: trigger, rangeStart: from, rangeEnd: offset },
            options.workspaceFiles,
            log,
          );
        };
        /*
         * A hash reaching for a chat rather than a file.
         *
         * Answered with the chats of the session the channel names, or with
         * none when the channel names no session. `chatFilter` above decides
         * whether the word is a chat at all, and a hash that cannot become
         * `#chat:` - `#src/` - is a file like any other.
         */
        const wanted = trigger === '#' ? chatFilter(typed_) : undefined;
        /*
         * Whether the word is still on its way to `chat:`, and so asks for a
         * chat and a file at once.
         *
         * VS Code fans one completions request out to every provider and a
         * client shows the items merged, so `#`, `#ch` and `#chat` are answered
         * with the chats and the files both. Whoever is about to type `chat:`
         * was choosing a file a keystroke ago, and the list must not empty
         * itself out under them. Only a word that already says `chat:` is
         * answered with chats alone - and a path that happens to begin with
         * `chat:` is not what such a word means.
         */
        const partial = wanted !== undefined && !typed_.toLowerCase().startsWith(CHAT_PREFIX);
        if (wanted !== undefined) {
          if (held_ === undefined) return { items: partial ? await files() : [] };
          /*
           * Which chat is the one being typed in, so it is not offered to
           * itself. A session channel is answered as the chat that session
           * hands a client naming none, so the two spellings a client sends are
           * one exclusion - which is what VS Code's `_canonicalChatId` does by
           * folding them onto one value.
           */
          const current = here === undefined ? held_.defaultChat : asking;
          // Case blind, on the title as it will be written: what a person reads
          // in the list is what they can match, and an empty filter keeps all.
          const filter = oneLine(wanted).toLowerCase();
          const chats = [...held_.chats]
            .filter(([uri, chat]) => {
              if (uri === current) return false;
              /*
               * A chat a tool started is a worker - read-only, and not a
               * conversation to attach. This host keeps a worker outside
               * `held.chats` altogether, since a `LiveSubagent` has no `Session`
               * of its own, so this cannot fire today. It is kept because the
               * question is the one VS Code asks: a chat of this session
               * carrying a tool's origin would be one to leave out.
               */
              const made = madeFrom.get(uri);
              if (made !== undefined && made.kind === 'tool') return false;
              /*
               * A chat with no completed turn has nothing to pin the reference
               * to, and VS Code's provider skips it; one a client attaches all
               * the same is taken, `endTurn` being optional.
               * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostChatCompletionProvider.ts#L170-L182
               */
              if (chat.allTurns().length === 0) return false;
              return filter === '' || oneLine(chat.title()).toLowerCase().includes(filter);
            })
            // Newest first, as VS Code sorts them: the chat somebody means is
            // almost always the one they were last in.
            .sort(([, a], [, b]) => Date.parse(b.modifiedAt()) - Date.parse(a.modifiedAt()))
            .slice(0, CHAT_MOST);
          /*
           * The chats first and the files after: a `#` still on its way to
           * `chat:` asks for both, and the chat is the more specific answer.
           */
          return {
            items: [...chats.map(([uri, chat]) => {
              const title = oneLine(chat.title());
              /*
               * The last turn that finished, pinned now rather than when the
               * message is sent: what gets attached is what the person saw when
               * they picked the chat, and a turn run in it afterwards must not
               * extend that, as VS Code pins it.
               */
              const endTurn = String((chat.allTurns().at(-1) as Bag).id ?? '');
              return {
                insertText: `#chat:${title} `,
                rangeStart: from,
                rangeEnd: offset,
                attachment: { type: 'chat', resource: uri, endTurn, label: title },
              };
            }), ...(partial ? await files() : [])],
          };
        }
        return { items: await files() };
      }
      // A slash at the start of a word, and nothing but word characters
      // since. A slash mid-sentence is a path, not a command.
      const found = /(?:^|\s)\/([\w:-]*)$/.exec(before);
      if (!found)
        return { items: [] };
      const typed = (found[1] ?? '').toLowerCase();
      const start = offset - typed.length - 1;
      const asked_ = meantBy(String(params.channel ?? ''));
      /*
       * The session behind the channel, and the backend it runs.
       *
       * Both kinds of channel are read, because a chat carries its session's
       * URI and a session channel is the session itself. The backend is what
       * the fallback list below belongs to.
       */
      const chat = byChat.get(asked_);
      const held = chat === undefined ? sessions.get(asked_) : sessions.get(chat.uri);
      const session = chat?.chat ?? (held === undefined ? undefined : leadOf(held));
      // A live session's own list wins: two sessions in one directory can
      // be handed different things.
      /*
       * Inside the containers, because that is where a leaf lives.
       *
       * A top-level customization is a plugin or a directory and a skill
       * or a prompt is one of its `children` - so a filter that looked
       * only at the top level found nothing, every time, and this fell
       * back to the backend-wide list on every keystroke. Which answered
       * correctly and by accident: the whole point of `own` is that two
       * sessions in one directory can be handed different things.
       */
      const leaves = (session?.customizations() ?? []).flatMap((entry) => {
        const children = Array.isArray(entry.children) ? entry.children as Bag[] : [];
        return children.length > 0 ? children : [entry];
      });
      const own = leaves
        // Skills as well as prompts, and not the ones the CLI keeps for
        // the agent: offering one it will refuse is worse than not
        // offering it.
        .filter((entry) => (entry.type === 'prompt' || entry.type === 'skill')
          && entry.disableUserInvocation !== true)
        .map((entry) => ({
          name: String(entry.name),
          description: typeof entry.description === 'string' ? entry.description : undefined,
          // Under `_meta`, in the key VS Code's host publishes a skill's hint
          // under: neither `PromptCustomization` nor `SkillCustomization`
          // declares one.
          argumentHint: readSkillArgumentHint(entry as { _meta?: Record<string, unknown> }),
          isSkill: entry.type === 'skill',
        }));
      /*
       * Which of the backend-wide commands are skills.
       *
       * The probe's flat command list cannot say - the CLI reports a
       * skill behind a slash as a command like any other - but its
       * customizations can, and a skill is a leaf of one of them. Read
       * once per answer rather than per item.
       */
      const skillsOf = (provider: string): Set<string> => {
        const out = new Set<string>();
        for (const entry of about(provider).customizations) {
          const children = Array.isArray(entry.children) ? entry.children as Bag[] : [];
          for (const leaf of children.length > 0 ? children : [entry]) {
            if (leaf.type === 'skill' && typeof leaf.name === 'string') out.add(leaf.name);
          }
        }
        return out;
      };
      const skilled = (provider: string) => {
        const skills = skillsOf(provider);
        return about(provider).commands.map((command) => ({ ...command, isSkill: skills.has(command.name) }));
      };
      /*
       * ...but an empty list means *not known yet*, not *none*.
       *
       * A session created a moment ago has not heard back from its
       * backend, and preferring its silence over the backend-wide list is
       * a slash menu that is empty for exactly as long as somebody is
       * likely to use it.
       *
       * The fallback list is the client's own `provider`, when it names
       * one, because it is composing for that backend and this is the only
       * thing that knows.
       * Otherwise the session's own - a session whose CLI has not answered yet
       * is handed its backend's commands rather than every backend's, which is
       * a menu full of items that session would refuse. With no session and no
       * provider it is the root channel being asked, and the answer is every
       * backend's.
       */
      const named = String(params.provider ?? '');
      const mine = held?.agent.provider;
      const one = named !== '' && agents.has(named) ? named : mine;
      const wide = one !== undefined && agents.has(one)
        ? skilled(one)
        : [...agents.keys()].flatMap((provider) => skilled(provider));
      /*
       * One item per name, because two backends can offer one command.
       *
       * Five Claude presets report the same `batch`, so the every-backend
       * answer above carries one copy per preset - a menu where `/batch` is
       * drawn five times and picking the second is picking the first. The
       * first is kept: the backends are read in registration order, so which
       * of two commands with one name is offered does not move between
       * keystrokes.
       */
      const seen = new Set<string>();
      const offered = (own.length > 0 ? own : wide).filter((command) => {
        if (seen.has(command.name)) return false;
        seen.add(command.name);
        return true;
      });
      const matches = offered
        .filter((command) => command.name.toLowerCase().includes(typed))
        // What was typed a prefix of, first. A substring match is useful
        // and is not what somebody typing `de` is looking for.
        .sort((a, b) => {
        const rank = Number(b.name.toLowerCase().startsWith(typed))
          - Number(a.name.toLowerCase().startsWith(typed));
        return rank !== 0 ? rank : a.name.localeCompare(b.name);
      })
        /*
         * A menu's worth when something was typed; the list when nothing
         * was.
         *
         * A bare slash is a client asking what there is, and it may well
         * filter the answer itself rather than ask again per keystroke -
         * so truncating that to a screenful drops commands it would then
         * never offer, silently and always the same ones. A narrowing
         * query is the interactive case and stays bounded.
         */
        .slice(0, typed === '' ? 500 : 50);
      return {
        items: matches.map((command) => ({
          // The space only when it takes an argument: a trailing space on
          // a command that takes none is a character somebody deletes.
          insertText: command.argumentHint ? `/${command.name} ` : `/${command.name}`,
          rangeStart: start,
          rangeEnd: offset,
          attachment: {
            type: 'simple',
            label: `/${command.name}`,
            ...(command.description ? { modelRepresentation: command.description } : {}),
            /*
             * What makes it a *command* rather than a line of text.
             *
             * The protocol declares `SimpleMessageAttachment` with a label
             * and no notion of a slash command, so the reference client
             * reads one out of `_meta`: a bag carrying `command` is a
             * slash command, one carrying `uri` is a skill, and a bag
             * carrying neither is dropped without a word. That is the
             * whole reason a menu can come back full and draw empty -
             * every item was answered and none was a command.
             *
             * `description` is the second column and `argumentHint` is
             * the ghost text after an accepted one.
             */
            _meta: {
              command: command.name,
              // A skill, said so: the reference client keeps a runtime
              // skill in an automation's text only when the flag is
              // there, and drops it as a command it cannot find a file
              // for otherwise. `true` or absent, the way it is read.
              ...(command.isSkill ? { isSkill: true } : {}),
              ...(command.description ? { description: command.description } : {}),
              ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
            },
          },
        })),
      };
    },
    /**
     * The catalogue, in pages when a client asks for one.
     *
     * Only when it asks. `limit` omitted is the protocol's own "let the
     * server choose the page size", and the size this host chooses is all
     * of them - because neither client that connects to it reads
     * `nextCursor`: VS Code's `listSessions` sends `{ channel }` and takes
     * `items`, and so does ahpc. A default page would silently be the
     * whole catalogue to both of them.
     */
    listSessions: async (params) => {
      /*
       * The running sessions' summaries built now and the held ones behind
       * them.
       *
       * Neither half waits for the other: a live summary is read out of memory
       * and is never stale, and the listed ones are whatever the last refresh
       * found. So a client is answered in the time it takes to sort, however
       * long a pass over the machine's transcripts takes.
       */
      const every = await ctx.listSessions();
      /*
       * The caller's own rows, where they asked for them.
       *
       * One filter and one reading of it wherever a listing takes it: no
       * `_meta` is every row, `me` is the rows this connection's principal
       * owns, and a value nobody meant is refused as a wrong param. It is
       * applied before the cursor and the limit, so a page is a page of the
       * rows the caller asked for rather than the caller's rows out of a page.
       */
      const askedOwner = bag(params._meta)['ahpd.owner'];
      const owner = ownerFilter(
        askedOwner === undefined ? '' : `owner=${encodeURIComponent(String(askedOwner))}`,
        connection.principal,
      );
      const owned = owner === undefined
        ? every
        : owner === null
          ? []
          : every.filter((row) => kept.owner(idOf(row.resource)) === owner);
      /*
       * And the rows this connection may see: an older VS Code window is
       * listed no session it may not see, and of each it may see only the
       * chats it may see, as the reference host lists for it. Every other
       * client is listed every row whole.
       * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2383-L2392
       */
      const rows = owned
        .filter((row) => sessionVisible(connection, row.resource, row.defaultChat))
        .map((row) => (row.chats === undefined || connection.legacyChatUris !== true
          ? row
          : { ...row, chats: row.chats.filter((chat) => chatShown(connection, chat.resource, row.resource)) }));
      /*
       * And a refresh behind that answer.
       *
       * The catalogue is held rather than listed per question, so what brings
       * it up to date is somebody's job. `refresh` shares a listing that is
       * already running and says what moved to every client, so a client that
       * asks again while this is in flight is answered from the rows it has
       * and told about the rest rather than waiting for the same pass twice.
       */
      void ctx.refresh().catch(() => {});
      const cursor = typeof params.cursor === 'string' ? params.cursor : undefined;
      const after = cursor === undefined
        ? 0
        : rows.findIndex((row) => row.resource === opened(cursor)) + 1;
      // Refused rather than guessed at, the way an unrecognised turn
      // cursor is: a cursor whose row has been disposed would otherwise
      // resume from the top, and the client would page for ever.
      if (cursor !== undefined && after === 0)
        throw new RpcError(INVALID_PARAMS, `Unrecognised cursor ${cursor}`);
      const limit = typeof params.limit === 'number' && Number.isFinite(params.limit)
        ? Math.max(1, Math.min(Math.floor(params.limit), PAGE_CAP))
        : PAGE_MOST;
      const items = rows.slice(after, after + limit);
      // Said out loud, because it is the one case a client cannot see: a
      // catalogue past the bound is one this host can no longer hand over
      // whole, and neither client that connects to it reads `nextCursor`.
      if (limit === PAGE_MOST && rows.length - after > PAGE_MOST) {
        log.warn(`${String(rows.length)} sessions is past ${String(PAGE_MOST)}: paging, which no client here asks for`);
      }
      const last = items[items.length - 1];
      return {
        items,
        ...(last && after + items.length < rows.length ? { nextCursor: sealed(last.resource) } : {}),
      };
    },
    /**
     * Start one.
     *
     * The **client** chooses the URI and sends it as `channel` - which is
     * what makes the session addressable before this host has answered, so
     * the client can subscribe to it without a round trip in between.
     *
     * Held under that URI and answered under it alone, whatever scheme it
     * takes, as the reference host holds a client's new session under the
     * channel it named: `ahp-session:/<id>` from a VS Code window that
     * declares it can address one, `<provider>:/<id>` from an older one.
     * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2213-L2221
     */
    createSession: async (params) => {
      if (ctx.closed) throw new RpcError(INTERNAL_ERROR, CLOSING);
      const uri = named(String(params.channel ?? ''), 'session');
      const provider = params.provider === undefined ? ctx.first?.provider : String(params.provider);
      if (provider === undefined) throw new RpcError(-32002, noProvider(provider));
      // An agent whose record is off starts no session, said with the one
      // sentence every refusal of it uses.
      if (isDisabled(options.disabledAgents?.(), provider)) throw new RpcError(-32002, turnedOff(provider));
      /*
       * An agent this caller may not use answers as one this host does not
       * serve, before anything is claimed or made: an id it is refused is an
       * id it is not told exists.
       */
      if (!mayUseAgent(connection.principal, ownershipOf(options.agentOwners?.(), provider), {
        root: connection.root === true,
        hasDirectory: options.users !== undefined,
      }))
        throw new RpcError(-32002, noProvider(provider));
      /*
       * The creator's entry names the creator. The protocol says its
       * `clientId` MUST match the one this connection gave at `initialize`,
       * and VS Code's host refuses a request whose entry names another client
       * or none, before anything is made for it.
       * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/commands.ts#L77-L85
       * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2209-L2213
       */
      const claimed = typeof params.activeClient === 'object' && params.activeClient !== null
        ? params.activeClient as Bag
        : undefined;
      const clientId = connection.clientId;
      if (claimed !== undefined && claimed.clientId !== clientId)
        throw new RpcError(INVALID_PARAMS, 'createSession.activeClient.clientId must match the connection\'s clientId');
      /*
       * A session this host holds under this name, made again for the agent
       * it is held under, is answered as made and kept as it is, recent in
       * the residency, as VS Code's host runs a creation of a URI registered
       * to the same provider over the state it keeps: a window whose
       * subscription a reconnect reported missing creates the session again
       * before it subscribes.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L6166-L6174
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L6323-L6328
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1239-L1246
       */
      if ((sessions.get(uri)?.agent ?? owners.get(uri))?.provider === provider) {
        ctx.touch(uri);
        return null;
      }
      unheld(uri);
      /*
       * The name, claimed before anything is made for the session, so a second
       * creation of it while this one waits on a worktree or a machine is
       * refused; let go again unless the session was made.
       */
      const pending: Claimed = { kind: 'session', of: uri };
      claims.set(uri, pending);
      const release = (): void => {
        if (claims.get(uri) === pending) claims.delete(uri);
      };
      try {
        const config = configOf(params) as Record<string, string>;
        /*
         * Where the client asked the agent to work.
         *
         * A list on the wire and one directory to a session, so the first is
         * the answer. `file://` comes off: everything below here deals in
         * paths, and a backend handed a URI would open a directory called
         * `file:`.
         */
        const wanted = (Array.isArray(params.workingDirectories) ? params.workingDirectories : [])
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => localPath(entry));
        const asked = wanted[0];
        // None named, the daemon's `workspacelessFolder` says where it works.
        const where = asked ?? await scratchFolder(uri);
        // The peers of the first, which the protocol says are equal to each
        // other and to it in everything but which one the process is rooted
        // at. A backend that cannot take them is told none.
        const peers = agents.get(provider)?.multipleDirectories === true ? wanted.slice(1) : [];
        /*
         * A worktree session runs in the folder the client picked until its
         * first send, which makes the tree and starts the session again in
         * it, as VS Code's host resolves a session's worktree on the first
         * send: a tree git cannot make fails that send.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2195-L2201
         */
        const running = where;
        await resolveCreatedSessionConfig(uri, where, config, connection.principal);
        /*
         * Checked before the machine is made, so a refused session makes
         * none, against the computer the client asked for and the scope the
         * session is charged to.
         */
        const refused = await admitted(connection.principal, charged.get(uri)?.scope, config, provider, uri, ownerFor(connection));
        if (refused !== undefined) throw new RpcError(-32009, refused);
        // A `disposable:<profile>` setting is a machine made for this
        // session, with this harness's needs and this folder, before the
        // backend is started with it.
        await placedIn(uri, provider, config, running, ownerFor(connection));
        // This connection's tokens and no other's. A client that pushed
        // nothing gets a session on the daemon's own credentials, which is
        // how every session worked before there was anything to push.
        // Handed over, since `createProviderSession` refuses a name this still holds.
        release();
        /*
         * The creator claiming its place in the session it is making.
         *
         * The protocol's own words: "equivalent to dispatching a
         * `session/activeClientSet` immediately after creation". Answered
         * here rather than left to that dispatch because it saves the round
         * trip the field exists to save, and because a client that has to
         * announce itself afterwards owns a session that is briefly empty
         * of it.
         *
         * In before the backend is started, and not after: the tools a chat
         * is handed and what the model is told beside them are both read
         * once, when that chat starts, and a client announcing itself in the
         * same breath as the session has to be there for either to reach it.
         * The announcement is dispatched after, because a session nobody can
         * subscribe to yet has nobody to tell.
         *
         * The entry is the one the creator sent, `tools` included or left
         * out, as the reference host holds a creator's entry.
         * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L6404
         */
        const activeClient: Bag | undefined = claimed;
        let here: Map<unknown, Bag> | undefined;
        if (activeClient !== undefined) {
          here = presence.get(idOf(uri)) ?? new Map<unknown, Bag>();
          presence.set(idOf(uri), here);
          here.set(clientId, activeClient);
        }
        // Whose this is: this connection's person, kept beside the session
        // so a scope change before the first turn is resolved against who
        // owns the work rather than against whoever sent it.
        try {
          await createProviderSession(uri, provider, config, running, undefined, conn.tokensFor(provider), peers, undefined,
            { ...forWhom(ownerFor(connection), connection.principal), sender: connection });
        }
        catch (error) {
          // Nothing came of it, so nothing is in it: the presence written
          // above is this request's, and a client left in a session that was
          // never opened is one for a row that is not there.
          here?.delete(clientId);
          if (here?.size === 0) presence.delete(idOf(uri));
          throw error;
        }
        // The tree its first send makes, owed as the start again that send runs.
        oweTree(uri, conn.tokensFor(provider), conn.tokensFor);
        if (activeClient !== undefined) {
          dispatch(uri, { type: 'session/activeClientSet', activeClient });
          retool(uri);
        }
        return null;
      }
      finally { release(); }
    },
    /**
     * A second conversation in one session.
     *
     * Same backend, same directory, same config - which is what makes the
     * chats peers rather than one being the other's child. `source` is
     * accepted: a `fork` resumes at the turn and seeds the copy from the
     * source transcript, and a `sideChat` copies nothing and carries that
     * turn's text on its first prompt.
     */
    createChat: async (params) => {
      const uri = String(params.channel ?? '');
      const chatUri = String(params.chat ?? '');
      const held = sessions.get(uri);
      /*
       * A session asleep whose state this host still holds, woken for the
       * chat and the call made again on the session that is live, as every
       * other action on a sleeping session is. A fork needs it live: the
       * point it is cut at is the source chat's to name. Held from before the
       * wake until the chat is made, so the sweep cannot let it go in between.
       * A session with no state held here is refused as VS Code's host
       * refuses one it has no state for.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2260-L2264
       */
      if (!held && owners.has(uri) && ctx.stateOf(uri) !== undefined) {
        if (unavailableProvider(idOf(uri)) !== undefined) throw new RpcError(AhpErrorCodes.SessionNotFound, `No agent for session: ${uri}`);
        const release = hold(uri);
        try {
          await wake(uri, undefined, connection);
          if (!sessions.has(uri))
            throw new RpcError(AhpErrorCodes.SessionNotFound, `Session not found: ${uri}`);
          return await methods.createChat(params);
        }
        finally { release(); }
      }
      if (!held)
        throw new RpcError(AhpErrorCodes.SessionNotFound, `Session not found: ${uri}`);
      /*
       * The default chat is made with its session, so asking for it again with
       * no first message makes nothing and is answered `null`, as the
       * reference host answers it.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2272-L2282
       */
      if (chatUri === held.defaultChat && params.initialMessage === undefined) return null;
      // A chat whose agent its record turned off starts nothing, said with the
      // sentence every refusal of it uses.
      if (isDisabled(ctx.options.disabledAgents?.(), held.agent.provider))
        throw new RpcError(-32002, turnedOff(held.agent.provider));
      if (idOf(chatUri) === '' || chatUri.indexOf(':') <= 0)
        throw new RpcError(INVALID_PARAMS, `${chatUri} is not a chat URI`);
      /*
       * A chat on an agent of its own is VS Code's `multipleChatProviders`,
       * which this host does not advertise, so a request naming one is refused
       * in VS Code's words.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2287-L2289
       */
      if (params.provider !== undefined)
        throw new RpcError(INVALID_PARAMS, 'This host does not support chats with their own agent.');
      /*
       * A first message is a person's, or nothing is made, as the reference
       * host refuses one before it creates the chat.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7350-L7352
       */
      const first_ = (typeof params.initialMessage === 'object' && params.initialMessage !== null
        ? params.initialMessage
        : undefined) as Record<string, unknown> | undefined;
      if (first_ !== undefined && bag(first_.origin).kind !== 'user')
        throw new RpcError(INVALID_PARAMS, 'An initial chat message must have user origin.');
      /*
       * A chat that is there already. The default chat takes a first message
       * as its own turn; a fork made with one onto a chat that is there, and
       * any other chat that is there, is refused AlreadyExists, as the
       * reference host refuses a fork's target it finds.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7354-L7365
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7663-L7668
       */
      const there = byChat.get(chatUri);
      if (there !== undefined) {
        if (chatUri === held.defaultChat && first_ !== undefined && bag(params.source).kind !== 'fork') {
          await acceptInitialMessage(uri, there.chat, held.agent.provider, first_);
          return null;
        }
        throw new RpcError(AhpErrorCodes.AlreadyExists, `Chat already exists: ${chatUri}`);
      }
      /*
       * A new chat's URI is an `ahp-chat:` one, refused InvalidParams in the
       * reference host's words otherwise.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatMinting.ts#L57-L60
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2283-L2285
       */
      if (!chatUri.startsWith('ahp-chat:'))
        throw new RpcError(INVALID_PARAMS, `Chat URI must use the ahp-chat scheme: ${chatUri}`);
      // Nor an opaque one in a session whose default chat is shaped, which an
      // older window that sees the session could not address.
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatMinting.ts#L61-L63
      if (chatUriFormatOf(held.defaultChat) === 'shaped' && !isShapedChatUri(chatUri))
        throw new RpcError(INVALID_PARAMS, `Opaque chat URI is not allowed in a session with a shaped default chat: ${chatUri}`);
      // Nor one whose chat id another chat of the session has, as VS Code reads
      // a chat's id off its URI.
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatMinting.ts#L64-L69
      const chatId = getAgentHostChatId(chatUri);
      const collision = [held.defaultChat, ...held.chats.keys()]
        .find((existing) => existing !== chatUri && getAgentHostChatId(existing) === chatId);
      if (collision !== undefined)
        throw new RpcError(INVALID_PARAMS, `Chat URI ${chatUri} has the same chat id as the existing chat ${collision}`);
      claimable(chatUri, 'chat');
      /*
       * Made out of another chat, when a client asks for that.
       *
       * A fork copies the conversation through one turn and continues it,
       * under an id of its own so the chat it came from is untouched. A
       * side chat copies nothing and is *told* what that turn said - the
       * protocol is explicit that the source transcript stays out of its
       * visible history, so the context rides on its first prompt.
       */
      const source = (typeof params.source === 'object' && params.source !== null
        ? params.source
        : undefined) as { kind?: unknown; chat?: unknown; turnId?: unknown } | undefined;
      let made: { resume?: string; seed?: Bag[]; forkAt?: string; context?: string } | undefined;
      let origin: Bag | undefined;
      /*
       * The backend a chat cut out of another runs on, which is the source
       * chat's: the conversation being copied is in that backend's format and
       * its own disk, so the copy is that backend's to make and to continue.
       */
      let fromChat: string | undefined;
      if (source !== undefined) {
        const kind = String(source.kind ?? '');
        // The kind first, because it decides whether the rest of the
        // source means anything: an unknown one is a client asking for
        // something this host has never heard of, and saying "no such
        // turn" about it would send somebody looking at the turn.
        if (kind !== 'fork' && kind !== 'sideChat')
          throw new RpcError(INVALID_PARAMS, `${kind} is not a chat source this host knows`);
        const from = byChat.get(String(source.chat ?? ''));
        if (!from || from.uri !== uri)
          throw new RpcError(INVALID_PARAMS, `${String(source.chat ?? '')} is not a chat in ${uri}`);
        fromChat = from.chat.chatUri;
        const turnId = String(source.turnId ?? '');
        // The backend's turns with this host's local turns in their places,
        // as the reference reads a chat's turns, a local one among them.
        const all = ctx.liveTurnsOf(uri, from.chat.chatUri, from.chat.allTurns() as Bag[]);
        const at = all.findIndex((one) => String((one as Bag).id ?? '') === turnId);
        /*
         * A side chat's turn is a completed one or the one running, taken as
         * it stands, as the reference host bounds a side chat by either.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7715-L7720
         */
        const running = kind === 'sideChat' && at < 0 ? ctx.stateOf(from.chat.chatUri)?.activeTurn as Bag | undefined : undefined;
        const live = running !== undefined && String(running.id ?? '') === turnId ? running : undefined;
        if (at < 0 && kind !== 'fork' && live === undefined)
          throw new RpcError(INVALID_PARAMS, `${turnId} is not a turn in ${String(source.chat ?? '')}`);
        /*
         * A fork at a turn the chat does not hold is a fresh chat on the
         * source chat's backend, as the reference host drops a fork whose
         * point it cannot find rather than seed nothing under a fork.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7427-L7433
         */
        if (at >= 0 || live !== undefined) {
          /*
           * The backend that serves the chat this one is cut from, which is
           * the one that has to be able to cut it: a chat of another backend
           * is a conversation in that backend's own format, and the session's
           * backend has never seen it.
           */
          const sourceAgent = getProviderForChat(held, from.chat.chatUri);
          if (kind === 'fork') {
            if (sourceAgent.chats?.fork !== true)
              throw new RpcError(INVALID_PARAMS, `${sourceAgent.provider} cannot fork a chat from a turn`);
            // The backend's own name for where that turn ended, which is
            // the only one it can be asked to continue from. For a local
            // turn, which the backend never saw, it is the nearest earlier
            // turn's, as the reference forks at a local turn.
            // https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L7183-L7195
            const concrete = ctx.resolveConcreteTurnId(uri, from.chat.chatUri, all as Bag[], at);
            const point = concrete === undefined ? undefined : from.chat.forkPoint?.(concrete);
            const started = from.chat.agentId();
            /*
             * A turn the backend names no point for, one read back by a
             * backend that names only the turns it watched, is forked all the
             * same: the new chat holds the turns up to it and its backend
             * begins a conversation of its own, as the reference host hands
             * its provider the host's turns and forks what the provider can.
             * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7424-L7476
             */
            if (point === undefined || started === undefined) {
              ctx.log.warn(`${String(source.chat ?? '')}: its backend names no point for ${turnId}, so the fork begins a conversation of its own`);
              made = { seed: all.slice(0, at + 1) as Bag[] };
            }
            else made = { resume: started, forkAt: point, seed: all.slice(0, at + 1) as Bag[] };
          }
          else {
            if (sourceAgent.chats?.sideChat !== true)
              throw new RpcError(INVALID_PARAMS, `${sourceAgent.provider} cannot start a side chat from a turn`);
            const message = (live ?? all[at] as Bag | undefined)?.message;
            const said = typeof message === 'object' && message !== null
              ? (message as { text?: unknown }).text
              : undefined;
            made = { context: typeof said === 'string' ? said : '' };
          }
          /*
           * What the new chat says it was made from, kept for as long as it
           * is: the summary is re-sent whole on every change, so an origin
           * given only on `session/chatAdded` would be said once and then
           * overwritten with `user`. A selection is kept as the protocol
           * declares it, and only when it has text.
           */
          const picked = (source as { selection?: unknown }).selection as { text?: unknown; responsePartId?: unknown } | undefined;
          const selection = kind === 'sideChat' && typeof picked === 'object' && picked !== null
            && typeof picked.text === 'string' && picked.text !== ''
            ? { text: picked.text, ...(typeof picked.responsePartId === 'string' ? { responsePartId: picked.responsePartId } : {}) }
            : undefined;
          origin = { kind, chat: String(source.chat ?? ''), turnId, ...(selection !== undefined ? { selection } : {}) };
        }
      }
      /*
       * The directories this chat is about, when it is about fewer.
       *
       * The protocol requires every entry to be in the owning session's
       * set: a chat cannot reach anywhere its session cannot, and one that
       * named somewhere else would be asking the host to widen a session
       * through a chat. The first entry is the process root and is the
       * session's, so what a chat chooses among is the peers. A fork is made
       * from its source alone, and takes none, as the reference host makes one.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2302-L2310
       */
      const asked = (origin?.['kind'] !== 'fork' && Array.isArray(params.workingDirectories) ? params.workingDirectories : [])
        .filter((one): one is string => typeof one === 'string')
        .map((one) => localPath(one));
      const own = [held.workingDirectory, ...(held.additional ?? [])].filter((one) => one !== undefined);
      const stray = asked.find((one) => !own.includes(one));
      if (stray !== undefined)
        throw new RpcError(INVALID_PARAMS, `${stray} is not a working directory of ${uri}`);
      /*
       * What the plugins give a chat a person opens, ahead of its first turn.
       *
       * Asked after every check, so a refused call asks nobody. The session and
       * the name are checked again after, because both can change while the
       * plugins answer. A fork is not asked: it resumes a conversation that
       * already began with the preamble.
       */
      const preambles = origin?.['kind'] === 'fork' ? [] : options.chatPreambles ?? [];
      if (preambles.length > 0) {
        const preamble = await preambleOf(preambles, {
          session: uri,
          chat: chatUri,
          ...(origin === undefined ? {} : { origin: origin as unknown as ChatOrigin }),
          chats: [...held.chats].map(([one, chat]) => chatSummary(uri, one, chat) as unknown as ChatSummary),
        }, log);
        if (sessions.get(uri) !== held)
          throw new RpcError(AhpErrorCodes.SessionNotFound, `No agent for session: ${uri}`);
        if (byChat.has(chatUri))
          throw new RpcError(AhpErrorCodes.AlreadyExists, `Chat already exists: ${chatUri}`);
        claimable(chatUri, 'chat');
        const context = withPreamble(preamble, made?.context);
        if (context !== undefined) made = { ...made, context };
      }
      const peers = asked.length > 0
        ? asked.filter((one) => one !== held.workingDirectory)
        : held.additional;
      if (asked.length > 0) beside.set(chatUri, peers ?? []);
      /*
       * What this chat was made from, written down before it is opened.
       *
       * The record `spawn` writes takes its origin from here, so the store the
       * next process reads says what the live summary says rather than learning
       * it on the next write.
       */
      if (origin !== undefined) madeFrom.set(chatUri, origin);
      /*
       * A fork's copied local turns, kept for the new chat before it opens, as
       * the reference records the forked ones before it creates the chat.
       * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L9828-L9838
       */
      if (fromChat !== undefined && made?.seed !== undefined) ctx.persistForkedLocalTurns(uri, fromChat, chatUri, made.seed);
      const agent = fromChat === undefined ? held.agent : getProviderForChat(held, fromChat);
      /*
       * The values it starts with as its own and the config they put it on: a
       * chat of the session's backend runs on the session's config with them
       * laid over it, and a fork of a chat of another backend on that chat's.
       */
      const ownValues = agent === held.agent ? ctx.initialChatConfig(uri, held, chatUri, origin) : {};
      const config = agent === held.agent ? { ...held.config, ...ownValues } : chatConfig(uri, held, fromChat as string);
      // Read until something is said in it, written before its state opens.
      startsRead(ctx, uri, chatUri);
      /*
       * Its name, written before its state opens too: the request's title,
       * trimmed, and a fork given none named after the chat it came from,
       * "Forked: <title>" with the prefix said once, or "Forked Chat" where
       * that chat and its session have none, as VS Code's host names one.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7370
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7458-L7461
       */
      const forked = 'Forked: ';
      const given = typeof params.title === 'string' ? params.title.trim() : '';
      const from = fromChat === undefined ? '' : String(ctx.stateOf(fromChat)?.title || ctx.stateOf(uri)?.title || '');
      const title = given !== '' ? given
        : origin?.['kind'] !== 'fork' ? undefined
          : from === '' ? 'Forked Chat'
            : from.startsWith(forked) ? from : `${forked}${from}`;
      if (title !== undefined) kept.setChatTitle(idOf(uri), chatUri, title);
      /*
       * The chat is answered once its backend holds it: a fork whose copy its
       * backend could not make is this request's failure, as VS Code's agent
       * provisions a fork inside the `createChat` that asked for it, and what
       * was kept for the chat ahead of it goes.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L7132-L7132
       */
      let chat: Session;
      try {
        chat = await spawn(agent, uri, chatUri, chatIdFor(uri, chatUri), backendsOwn(config), made, held.workingDirectory, undefined, peers, connection);
      }
      catch (error) {
        madeFrom.delete(chatUri);
        if (asked.length > 0) beside.delete(chatUri);
        if (fromChat !== undefined && made?.seed !== undefined) ctx.deleteLocalTurns(uri, chatUri, made.seed);
        kept.setChatFlags(idOf(uri), chatUri, 0);
        if (title !== undefined) kept.setChatTitle(idOf(uri), chatUri, '');
        throw new RpcError(INVALID_PARAMS, error instanceof Error ? error.message : String(error));
      }
      log(`opened ${chatUri} in ${uri}`);
      ctx.keepChatOwnConfigValues(uri, chatUri, ownValues);
      if (title !== undefined) ctx.persistChatTitle(uri, chatUri, title);
      /*
       * The default chat takes its own title from here, before the new chat
       * is said, as the reference host's addChat snapshots it.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1733-L1738
       */
      ctx.snapshotDefaultChatTitle(uri);
      // `summary`, not `chat`: the reducer reads `action.summary.resource`,
      // and a chat named any other way arrives as a TypeError inside it.
      dispatch(uri, { type: 'session/chatAdded', summary: chatSummary(uri, chatUri, chat) });
      // And the row, which lists the session's chats: a client that is only
      // listing sessions reads the new chat from there.
      markSummaryDirty(uri);
      if (first_ !== undefined) await acceptInitialMessage(uri, chat, held.agent.provider, first_);
      return null;
    },
    moveChat: (params) => moveChat(connection, conn.tokensFor, params),
    /*
     * A chat this host runs taken out of its session, answered `null`, as the
     * reference host answers it. A chat with no owner here, and a session's
     * default chat, are answered the same with nothing removed: the reference
     * host finds no owner for the first and its state refuses to remove the
     * second, so a session's default chat never changes this way.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2380-L2389
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1871-L1880
     */
    disposeChat: async (params) => {
      const chatUri = String(params.channel ?? '');
      const found = byChat.get(chatUri);
      if (!found) return null;
      const held = sessions.get(found.uri);
      if (held?.defaultChat === chatUri) return null;
      // A client removing a chat is a removal, and one of the two roads that
      // dispose: the chat is not started again, so nothing of it is kept.
      forgetSendersIn(found.chat.chatState());
      found.chat.close('dispose');
      byChat.delete(chatUri);
      ctx.chatRelaunches.delete(chatUri);
      madeFrom.delete(chatUri);
      ctx.links.forgetChat(chatUri);
      // After `byChat` has let the chat go, so the store says nothing on a
      // channel nobody can reach any more.
      ctx.canvases.forgetChat(chatUri);
      held?.chats.delete(chatUri);
      // And the name this chat was given, its draft and its counts: the store
      // keeps a chat's own of each, and a chat that has gone takes them with
      // it, so a chat opened under that name later starts with none of them.
      kept.setChatTitle(idOf(found.uri), chatUri, '');
      kept.setChatDraft?.(idOf(found.uri), chatUri, undefined);
      kept.setChatChanges?.(idOf(found.uri), chatUri, undefined);
      /*
       * The name the backend keeps this chat's conversation under, read before
       * the record goes: a fork and a chat whose URI names no id the backend
       * took run under an id the record is the only place to hold.
       */
      const own = found.chat.agentId() ?? ctx.recordedChat(idOf(found.uri), chatUri)?.backendId;
      dropChat(found.uri, chatUri);
      // And the outputs its terminals kept, its local turns and the state its
      // channel held: a chat that is gone names nothing, a default chat's
      // derived URI included once the role has moved on.
      ctx.forgetChatOutputs(found.uri, chatUri);
      ctx.forgetChatLocalTurns(found.uri, chatUri);
      ctx.closeState(chatUri);
      /*
       * And what the backend holds of it, when a closed chat is deleted rather
       * than hidden. The chat
       * is closed either way: a backend that would not remove the conversation
       * is a line in the log, raised by the delete itself, rather than a client
       * told its request failed.
       */
      if (ctx.closedChats === 'delete' && held !== undefined && own !== undefined && own !== '') {
        await ctx.disposeProviderChat(own, getProviderForChat(held, chatUri), ctx.dirOf(found.uri), ctx.ranIn(found.uri));
      }
      log(`closed ${chatUri}`);
      dispatch(found.uri, { type: 'session/chatRemoved', chat: chatUri });
      // Last, and once: the row's chat list just moved.
      markSummaryDirty(found.uri);
      // A chat closed while its turn ran leaves the root's count of sessions
      // running a turn, as VS Code's host drops it there.
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1881-L1887
      activeSessionsChanged();
      // Nothing is holding this chat's answer any more, so nothing is holding
      // the chat.
      updateChatMovability(chatUri);
      return null;
    },
    disposeSession: async (params) => {
      // The caller, because a delete is not a write: `session:write` lets a
      // member change their own sessions and says nothing about ending
      // somebody else's, and this one cannot be undone.
      await removeSession(String(params.channel ?? ''), connection.principal);
      return null;
    },
    /**
     * The configuration a session would have, before one exists.
     *
     * Separate from a session's own config precisely because it has to be
     * answerable with no session: what a composer offers has to be
     * offerable before anything has been created.
     */
    /**
     * The schema, and what it defaults to.
     *
     * `schema`, not `properties` at the top level: a client reads
     * `result.schema.properties`, and putting them one level up draws no
     * controls at all - no permission mode, no model, no effort. Which is
     * exactly what it did.
     */
    resolveSessionConfig: async (params) => {
      const provider = params.provider === undefined ? ctx.first?.provider : String(params.provider);
      if (provider === undefined) throw new RpcError(-32002, noProvider(provider));
      const agent = agents.get(provider);
      if (!agent)
        throw new RpcError(-32002, noProvider(provider));
      const answered = (typeof params.config === 'object' && params.config !== null
        ? params.config
        : {}) as Record<string, unknown>;
      /*
       * The host's own properties, merged over the backend's.
       *
       * Over rather than under: `isolation` and its two companions are
       * this host's to answer, and a backend that happened to advertise
       * the same names would be advertising control of a directory it
       * does not choose.
       */
      /*
       * `workingDirectory`, singular, because that is the field this
       * command declares.
       *
       * `createSession` takes `workingDirectories` and this one does not,
       * and reading the plural here meant the answer was always computed
       * against the host's own first path instead of the folder the
       * question was about - so a client asking about a repository was
       * told what a non-repository offers, which is no isolation at all.
       * The plural is still read after it, for a client that sends what
       * the neighbouring command takes.
       */
      const one = typeof params.workingDirectory === 'string' ? params.workingDirectory : undefined;
      const asked = one ?? (Array.isArray(params.workingDirectories)
        ? params.workingDirectories.find((entry) => typeof entry === 'string')
        : undefined);
      const mine = await isolating(
        typeof asked === 'string' ? localPath(asked) : dir,
        typeof answered.isolation === 'string' ? answered.isolation : undefined,
      );
      /*
       * The same picker a session of this host's own is created with, asked
       * for the person asking: `resolveSessionConfig` is what a client
       * draws its new-session form from, so a scope missing from it is a
       * scope nobody can pick before the session exists.
       */
      const scoped = scoping(connection.principal);
      const theirs = sessionSchema(agent);
      /*
       * The form this client is about to draw, walked once for this backend.
       *
       * The backend's own schema is made when it is asked for rather than
       * registered, so this is the one place it can be read. A hole is a line
       * in the log and nothing else: the client still gets the form, and the
       * backend still runs.
       */
      if (!walked.has(agent)) {
        walked.add(agent);
        for (const gap of schemaGaps(theirs)) log.warn(gapLine(agent.provider, 'session config', gap));
      }
      /*
       * A contributed key's own values, asked for here rather than left
       * to the first client that opens its picker: this is the answer a
       * composer draws itself from, and a key marked `enumDynamic` with
       * nothing in its `enum` is a control with no label for the value it
       * is already holding.
       */
      // In the caller's language, and translated before `seeded` fills the
      // dynamic keys, so an answerer's labels are never read as text.
      const locale = ctx.localeOf(connection.clientId);
      const contributed = await seeded(
        formIn(
          (typeof theirs.properties === 'object' && theirs.properties !== null ? theirs.properties : {}) as Bag,
          'session', locale, (key) => ctx.catalogsOf(key, provider),
        ),
        {
          provider,
          ...(asked === undefined ? {} : { workingDirectory: asked }),
          config: answered,
          ...(connection.principal === undefined ? {} : { reader: connection.principal }),
        },
        agent.completions,
      );
      const hostProperties = formIn((typeof mine.schema.properties === 'object' && mine.schema.properties !== null
        ? mine.schema.properties
        : {}) as Bag, 'session', locale, hostCatalogs);
      /*
       * In the order the reference host composes the schema: the computer and
       * isolation, then whatever the backend and another plugin offered, then
       * this host's other keys, and what wins a shared name is the host's
       * value, and then the scoped one.
       */
      const scopedProperties = formIn(scoped.properties, 'session', locale, hostCatalogs);
      const properties = formOrdered(
        { ...contributed, ...hostProperties, ...scopedProperties },
        [...Object.keys(hostProperties), ...Object.keys(scoped.properties)],
      );
      /*
       * Iterative, as a real host's is: what has been answered comes back
       * answered, so re-asking does not quietly undo a choice. The backend's
       * defaults sit under a contributed key's, and a key this host owns comes
       * back only where its property takes it and the default where it does
       * not, the backend's value for it taken out, as VS Code's host sets its
       * own values over the provider's and validates them.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L11035-L11055
       */
      return {
        schema: { ...theirs, properties },
        values: {
          ...ctx.omitHostOwnedSessionConfig({ ...agent.defaults(), ...ctx.contributedDefaults(), ...answered }),
          ...mine.defaults,
          ...scoped.defaults,
          ...ctx.hostOwnedSessionConfig(answered, { ...hostProperties, ...scopedProperties }),
        },
      };
    },
    /**
     * The values behind a property whose list is too long to send.
     *
     * `branch` is the host's, for every agent, as VS Code's host answers it
     * from the one git-backed list; any other property is the answer of the
     * backend the client named, or of the plugin that contributed the key, a
     * failure of it let through to the client; a property nothing here looks
     * up answers with nothing.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L11070-L11081
     */
    sessionConfigCompletions: async (params) => {
      const property = String(params.property ?? '');
      const asked = typeof params.workingDirectory === 'string' ? params.workingDirectory : undefined;
      const port = options.worktrees;
      if (property === 'branch' && port) {
        // The client's URI is decoded; the host's own directory is already a
        // path, so it is the fallback rather than a URI built to be read back.
        const where = asked === undefined ? dir : localPath(asked);
        const repository = await port.repository(where).catch(() => undefined);
        if (repository === undefined) return { items: [] };
        const query = typeof params.query === 'string' ? params.query.toLowerCase() : '';
        const branches = await port.branches(repository).catch(() => [] as string[]);
        /*
         * Substring rather than prefix, and capped.
         *
         * Somebody looking for `softov/agents/1a2b` types `1a2b`, and a
         * prefix match would answer nothing. The cap is the same one the
         * schema seeds with, because the list is ordered by most recent
         * commit and a picker showing four hundred rows is one nobody reads.
         */
        const found = branches.filter((name) => name.toLowerCase().includes(query));
        return { items: found.slice(0, SEEDS).map((name) => ({ value: name, label: name })) };
      }
      /*
       * A key a backend answers for itself, then a contributed key.
       *
       * A backend's schema is its own account of its settings; the ask names
       * the provider, so the answerer is this backend's only when the client
       * asked about this backend. A key a plugin named is answered by the
       * answerer registered beside it, and the fold is what marks the property
       * `enumDynamic`, so a client asking is a client that was told to ask.
       */
      const named = typeof params.provider === 'string' ? agents.get(params.provider) : undefined;
      const answerer = named?.completions?.[property] ?? options.sessionConfigCompletions?.[property];
      if (answerer !== undefined) {
        return {
          items: await answerer({
            property,
            query: typeof params.query === 'string' ? params.query : '',
            ...(typeof params.provider === 'string' ? { provider: params.provider } : {}),
            ...(asked === undefined ? {} : { workingDirectory: asked }),
            ...(typeof params.config === 'object' && params.config !== null
              ? { config: params.config as Record<string, unknown> }
              : {}),
            ...(connection.principal === undefined ? {} : { reader: connection.principal }),
          }),
        };
      }
      if (property === 'scope') {
        /*
         * The choices are the asking person's, so asked for here rather
         * than offered in the enum alone: a person with a `team:*` holds
         * one choice per project, and a client that would rather not draw
         * them all asks. A host with nobody signed in has nothing to offer
         * and says so with an empty list, like any other property here.
         */
        const who = connection.principal;
        if (who === undefined) return { items: [] };
        const query = typeof params.query === 'string' ? params.query.toLowerCase() : '';
        const found = namesOf(who).filter((one) => one.toLowerCase().includes(query));
        return { items: found.map((name) => ({ value: name, label: name })) };
      }
      return { items: [] };
    },
  };
  return methods;
}
