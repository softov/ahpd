import { isDeepStrictEqual } from 'node:util';
import { idOf, Status } from '../sessions/catalog.js';
import { localPath } from '../resources/fileuri.js';
import { filesOf, needsWriting, snapshot } from './attachments.js';
import { chatIdFor, chatUriFor, isRootChannel, MARKS, RELAYED, ROOT, toolCallOfSubagentChat, WORKER_ACTIONS } from './channels.js';
import { HOSTS_OWN, HOSTS_TAKEN } from './common.js';
import { autoApproved, requireTrust } from './trust.js';
import type { Bag } from '../types/common.js';
import type { Session } from '../types/session.js';
import type { ClientCallAnswer } from '../tools/clientcalls.js';
import type { Origin } from './state.js';
import type { ConnectionContext, HostContext } from './context.js';

/**
 * Set or clear one of a session's own two bits, and say so.
 *
 * A session's `IsRead` and `IsArchived` are this host's rather than a
 * backend's: a harness asked would have no idea whether a person had read a
 * transcript. `session/isReadChanged` and `session/isArchivedChanged` reach
 * this, a client's on a session channel and this host's own.
 *
 * A read bit moved here is the session's. The chats it moves with, and when,
 * are `readAggregate`'s and `sessionFollows`'s, and the session's own action
 * moves a sole chat where `session/isReadChanged` is applied.
 *
 * An archived bit is the session's alone, and each chat keeps its own, as the
 * reference host keeps a session's flags apart from its chats'.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3369-L3374
 *
 * `origin` is the client's whose action `action` is, and this host's own
 * action has none.
 *
 * Answers whether anything moved. A bit handed the value it already had is not
 * a change, and a client told about one is a client woken for a message that
 * moved nothing.
 */
export function sessionFlag(
  ctx: HostContext,
  uri: string,
  bit: number,
  on: boolean,
  action: Record<string, unknown>,
  origin?: Origin,
): boolean {
  const before = ctx.kept.flags(idOf(uri));
  const after = on ? before | bit : before & ~bit;
  if (after === before) return false;
  ctx.kept.setFlags(idOf(uri), after);
  ctx.keepName(idOf(uri));
  // Every client watching, and the catalogue: a flag one client sets is a flag
  // the others have to see, which is what having a host for this buys over
  // each client keeping its own.
  ctx.dispatch(uri, action, origin);
  ctx.summaryMoved(uri);
  // Archived: asleep, or its tree given back where it is asleep already, and
  // let go by the residency where nothing holds it.
  // https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L1457-L1464
  if (bit === Status.IsArchived && on) {
    queueMicrotask(() => {
      void ctx.sleep(uri).catch(() => undefined);
      ctx.reconcile();
    });
  }
  // Unarchived: the tree back before anything wakes the session into it, and
  // the session is no longer one the host archived.
  if (bit === Status.IsArchived && !on) {
    ctx.kept.setAutoArchivedAt?.(idOf(uri), undefined);
    void ctx.restore(uri);
  }
  return true;
}

/**
 * Set or clear one of a chat's own two bits, and say so.
 *
 * Said on the chat, and on the session's list of chats, which is where a
 * client watching the session rather than this one chat reads that chat's
 * status. The value there is the chat's own status with its bits laid over
 * it - the exact number the chat's own state now answers with, which is what
 * the protocol requires of it.
 *
 * `action` is what goes out on the chat: a client's own action, under its
 * `origin`, where a client sent one, and this host's where nobody did.
 *
 * Answers whether the bit moved, for the same reason `sessionFlag` does.
 */
export function chatFlag(
  ctx: HostContext,
  session: string,
  chat: string,
  bit: number,
  on: boolean,
  action?: Record<string, unknown>,
  origin?: Origin,
): boolean {
  const before = ctx.kept.chatFlags(idOf(session), chat);
  const after = on ? before | bit : before & ~bit;
  if (after === before) return false;
  ctx.kept.setChatFlags(idOf(session), chat, after);
  ctx.dispatch(chat, action ?? (bit === Status.IsRead
    ? { type: 'chat/isReadChanged', isRead: on }
    : { type: 'chat/isArchivedChanged', isArchived: on }), origin);
  /*
   * A running chat's row follows its state as every action on it moves it. A
   * chat of a session nothing is running has no backend to follow, so its row
   * is said here: idle, with its bits, or what its held state says.
   */
  if (ctx.sessionHolding(chat) === undefined) {
    const status = Number(ctx.stateOf(chat)?.status ?? (Status.Idle | after));
    ctx.dispatch(session, { type: 'session/chatUpdated', chat, changes: { status } });
    ctx.summaryMoved(session);
  }
  return true;
}

/**
 * The chats a session's read bit is made of, each with its own read bit.
 *
 * Every open chat of the session but one whose origin is a tool and one that
 * is hidden: those keep their own bits and move nothing of the session's, as
 * the reference host has it. A running session's chats are the ones it holds;
 * one nothing is running has the chats its state opens with, its default
 * first, as the reference host reads a session it has not loaded off its
 * catalog row. A session the catalogue does not list has none, as the
 * reference host has no row to read for one.
 * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/common/state/sessionState.ts#L2063-L2070
 * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L12042-L12078
 */
export function readAggregate(ctx: HostContext, session: string): { uri: string; read: boolean }[] {
  const id = idOf(session);
  const held = ctx.sessions.get(session);
  if (held === undefined && !ctx.owners.has(session)) return [];
  const recorded = held !== undefined || ctx.kept.nested?.(id) !== undefined ? [] : ctx.recordedChats(id);
  const chats: Bag[] = held !== undefined
    ? [...held.chats].map(([uri, chat]) => ctx.chatSummary(session, uri, chat))
    : [
      { resource: recorded.find((one) => one.default === true)?.uri ?? chatUriFor(ctx.nameOf(id)) },
      ...recorded.filter((one) => one.default !== true).map((one) => ({ resource: one.uri, origin: one.origin })),
    ];
  return chats
    .filter((one) => (one.origin as Bag | undefined)?.['kind'] !== 'tool' && one.interactivity !== 'hidden'
      && toolCallOfSubagentChat(String(one.resource)) === undefined)
    .map((one) => ({ uri: String(one.resource), read: (ctx.kept.chatFlags(id, String(one.resource)) & Status.IsRead) !== 0 }));
}

/**
 * A session's read bit, moved after a read action on one of its chats.
 *
 * A chat of its `readAggregate` that is unread marks a read session unread.
 * One that is read marks an unread session read once every chat of it is
 * read, unless it was read already and has a sibling: a read said again keeps
 * a session of several chats unread, and a sole chat's bit is its session's.
 * Each with this host's own `session/isReadChanged`, after the chat's action,
 * whether or not the chat's own bit moved; a chat outside the aggregate moves
 * nothing.
 * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2993-L3008
 */
export function sessionFollows(ctx: HostContext, session: string, chat: string, wasRead: boolean): void {
  const chats = readAggregate(ctx, session);
  const own = chats.find((one) => one.uri === chat);
  if (own === undefined) return;
  const sessionRead = (ctx.kept.flags(idOf(session)) & Status.IsRead) !== 0;
  if (!own.read && sessionRead) {
    sessionFlag(ctx, session, Status.IsRead, false, { type: 'session/isReadChanged', isRead: false });
  } else if (own.read && !sessionRead && (!wasRead || chats.length === 1) && chats.every((one) => one.read)) {
    sessionFlag(ctx, session, Status.IsRead, true, { type: 'session/isReadChanged', isRead: true });
  }
}

/**
 * A chat that is new, marked read before anybody is told about it.
 *
 * Nothing has been said in it yet, so there is nothing in it to read.
 */
export function startsRead(ctx: HostContext, session: string, chat: string): void {
  const id = idOf(session);
  ctx.kept.setChatFlags(id, chat, ctx.kept.chatFlags(id, chat) | Status.IsRead);
}

/**
 * The key a `!` command's turn is held under in `commandTurns`: its chat, then
 * the turn's id.
 *
 * A client names its own turns, so two chats can each run a turn of the same
 * id at once, and one chat's command turn says nothing about the other's.
 */
export const commandTurnKey = (chat: string, turn: string): string => `${chat}\u0000${turn}`;

/**
 * A session's and a chat's actions.
 *
 * The part of a dispatch that needs the session the action is about: a
 * worker's chat, which is read-only, a session being started again, and the
 * switch that acts on the action once both are known.
 */
export function chatAction(
  ctx: HostContext,
  conn: ConnectionContext,
  params: Record<string, unknown>,
  channel: string,
  action: Record<string, unknown>,
  type: string,
  origin: Origin,
  no: (reason: string) => void,
): Promise<void> | undefined {
  const { connection } = conn;
  const { refuse } = ctx;
  const {
    admitted, beginOrRun, beginTurn, beside, byChat, charge, charged, chatAgent, chatConfig,
    contributedDefaults, decided,
    described, dispatch, drafts, fire, kept, known, leadOf, lifeOf, lives, log, messageAttachments,
    messageFrom, modelIn, names, ownerFor, owners, past, pluginsMoved, principalFor, propertyOf, putIn, renameChat,
    renameSession, restart, restartChat, restarting, rootConfig, served, sessionFor, sessionMachines, sessions, spawn, starting,
    statusOf, subagents, summaryMoved, value, waitingFor, wake, hold,
  } = ctx;

  /** The message an action carries, which its text and its attachments ride on. */
  const messageOf = (one: Record<string, unknown>): Record<string, unknown> =>
    (typeof one.message === 'object' && one.message !== null ? one.message : {}) as Record<string, unknown>;
  /**
   * A message whose attachments are files before anything reads them.
   *
   * The bytes a client pasted are written under the session's own folder and
   * the message names them, so what is applied, stored and echoed is the path.
   * A store that keeps no files has no folder to write into, and every message
   * is then the one that arrived.
   *
   * A session running in a machine is handed the files it was told about, at
   * the paths the message names, so a path is a file on both sides. The copy
   * comes after the writing and before the action is applied, which is where
   * the machine's session is handed the same paths this one read. A copy that
   * fails is said in a line and the message goes on: the bytes are here
   * whether or not the machine took its copy of them.
   */
  const settledMessage = async (message: Record<string, unknown>, uri: string): Promise<Record<string, unknown>> => {
    const settled = await snapshot({
      message,
      id: idOf(uri),
      store: kept,
      connection,
      onProblem: (line) => log(`${uri}: ${line}`),
    });
    const dir = kept.attachmentsDir?.(idOf(uri));
    if (dir !== undefined) await putIn(uri, filesOf(settled, dir));
    return settled;
  };

  /*
   * The two bits a chat carries of its own.
   *
   * Read and archived are this host's, the way a session's are, kept per
   * chat: a session is a container for conversations and a person reads one
   * of them at a time. A read action on a chat moves its session's read bit
   * after it, as `sessionFollows` says, and the reference host does.
   * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2993-L3008
   *
   * Handled above the worker guard, because a worker chat carries them too.
   * Read-only says nobody types into it; it does not say nobody may file it
   * away. Only a chat of a session this host is running has anywhere to keep
   * one - a chat read back off a disk is a row nothing was recorded for, and
   * the guard below answers for it.
   */
  const bitOf = type === 'chat/isReadChanged' ? Status.IsRead
    : type === 'chat/isArchivedChanged' ? Status.IsArchived
    : undefined;
  const flagSession = bitOf === undefined ? undefined : sessionFor(channel);
  /*
   * A session's default chat is not archived on its own.
   *
   * The reference host refuses an archive of a default chat, in a session it
   * runs and in one it has not loaded, and its window sends one on the chat's
   * channel. A session is archived by its own `session/isArchivedChanged`.
   * The default chat is the running session's, or the one a session not
   * running records, or the one its catalogue row names. Refused before
   * anything wakes the session, as the reference host refuses one without
   * restoring it.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L13453-L13464
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L12120-L12122
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L7838-L7856
   */
  if (bitOf === Status.IsArchived && flagSession !== undefined) {
    const id = idOf(flagSession);
    const recorded = sessions.has(flagSession) || kept.nested?.(id) !== undefined ? [] : ctx.recordedChats(id);
    const lead = sessions.get(flagSession)?.defaultChat
      ?? recorded.find((one) => one.default === true)?.uri
      ?? chatUriFor(ctx.nameOf(id));
    if (lead === channel) {
      refuse(connection.peer, channel, action, origin, 'Only a known independently manageable non-default chat can be archived.');
      return;
    }
  }
  if (bitOf !== undefined && flagSession !== undefined && sessions.has(flagSession)) {
    const on = type === 'chat/isReadChanged' ? action.isRead === true : action.isArchived === true;
    /*
     * Said again, a bit that did not move keeps the catalogue as it is. The
     * action is still accepted, and goes to every client of the chat. A read
     * action moves the session after it all the same: the reference host reads
     * the chat's bit after every read action, moved or not.
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/subscriptions.md#L140-L143
     * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2968-L2970
     */
    const wasRead = (kept.chatFlags(idOf(flagSession), channel) & Status.IsRead) !== 0;
    const moved = chatFlag(ctx, flagSession, channel, bitOf, on, action, origin);
    if (!moved) dispatch(channel, action, origin);
    // A chat whose backend runs it on another host has its bits there too.
    byChat.get(channel)?.chat.flag?.(bitOf === Status.IsRead ? 'read' : 'archived', on);
    if (bitOf === Status.IsRead) {
      sessionFollows(ctx, flagSession, channel, wasRead);
      return;
    }
    /*
     * A chat filed away is read: nobody is going to come back to it for what
     * is new in it, and the reference host marks it so, with the read action
     * that moves its session after it. Taking one back out leaves its read bit
     * as it is.
     * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/chatContributions/chatArchive/chatArchiveContribution.ts#L50-L51
     */
    if (moved && on && chatFlag(ctx, flagSession, channel, Status.IsRead, true)) sessionFollows(ctx, flagSession, channel, false);
    return;
  }
  /**
   * A client's start that this host will not send, said on `where` and ended
   * there in an error carrying `errorType` and `message`, with the time since
   * it was said at `since`: as the reference host's admission ends a request
   * it refuses, and its send ends a turn whose preparation failed, with
   * `chat/error` on the turn the request started.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTurnStarter.ts#L95-L110
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2328-L2336
   */
  const unsent = (where: string, errorType: string, message: string, since = Date.now()): void => {
    if (!ctx.answered(origin)) dispatch(where, action, origin);
    dispatch(where, {
      type: 'chat/error',
      turnId: String(action.turnId ?? ''),
      duration: Math.max(0, Date.now() - since),
      part: { kind: 'error', error: { errorType, message } },
    });
  };
  /*
   * The command a start's text runs in a chat of `on`'s session, as this
   * host's local command: run once the client's start is said and before the
   * turn is admitted, so it runs in a chat that is read-only, archived or
   * whose agent has ended as much as in any other, as the reference host runs
   * its local commands ahead of its admission.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/localCommand/localCommandContribution.ts#L14-L41
   */
  const commandOf = (on: Session): string | undefined =>
    (type === 'chat/turnStarted' ? ctx.commandIn(on, String(messageOf(action).text ?? '')) : undefined);
  /**
   * The client's start said, and its command `run` as the turn on `chat`, a
   * chat of `on`'s session. While an embedder is on its way out the turn ends
   * unrun in the embedder's words, as every other turn is refused then.
   */
  const bang = (on: Session, chat: string, run: string): void => {
    if (ctx.refusing !== undefined) {
      unsent(chat, 'rejected', ctx.refusing);
      return;
    }
    const turnId = String(action.turnId ?? '');
    if (!ctx.answered(origin)) dispatch(chat, action, origin);
    void fire({ type: 'message', session: on.uri, chat, turn: turnId, text: String(messageOf(action).text ?? '') });
    const by = ownerFor(connection);
    if (by !== undefined) ctx.senders.set(turnId, by);
    ctx.sentBy.set(turnId, connection);
    ctx.bang(on, chat, turnId, run);
  };
  /*
   * A worker's chat is read-only, whichever side of a restart it is on.
   *
   * Nobody types into a subagent: its conversation is the harness's work
   * inside somebody else's call. What a client may still send on one is
   * an answer to what the worker asked there and a stop, and those are
   * the lead chat's backend's to act on, since that backend runs the
   * worker. A command typed into one runs as this host's local command,
   * ahead of the admission that refuses any other start in the reference
   * host's words for a read-only chat; anything else is refused here, before
   * the resume below, which would start an agent for a chat the client
   * cannot write to.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/turnAdmission/turnAdmissionContribution.ts#L29-L42
   */
  const worker = toolCallOfSubagentChat(channel) !== undefined;
  if (worker && type === 'chat/turnStarted') {
    const owning = sessions.get(sessionFor(channel));
    const lead = owning === undefined ? undefined : leadOf(owning);
    const command = lead === undefined ? undefined : commandOf(lead);
    if (lead !== undefined && command !== undefined) bang(lead, channel, command);
    else unsent(channel, 'readOnly', 'This chat is read-only.');
    return;
  }
  if (worker && !WORKER_ACTIONS.has(type)) {
    refuse(connection.peer, channel, action, origin, `${channel} is a read-only subagent chat`);
    return;
  }
  /*
   * A client's action on a session another host runs, carried there as the
   * client sent it, whose echo there answers the client, as a relay forwards
   * each frame as sent: nothing is said of it here. A start is admitted first,
   * by its session's bits, its policy and its machine, refused in this host's
   * words where it is not, and the client's later actions wait behind its
   * admission, so they reach the host there in the order they were sent.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/relayTransport.ts#L123-L137
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2792-L2798
   */
  const named = sessions.get(channel);
  const relaying = worker || !RELAYED.has(type) ? undefined
    : byChat.get(channel)?.chat ?? (named === undefined ? undefined : leadOf(named));
  if (relaying?.relay !== undefined) {
    const kind = byChat.has(channel) ? 'chat' : 'session';
    if (type !== 'chat/turnStarted') {
      relaying.relay(kind, action, origin);
      return;
    }
    if ((kept.flags(idOf(relaying.uri)) & Status.IsArchived) !== 0) {
      no('This session is archived and read-only. Restore the session to continue the conversation.');
      return;
    }
    const message = messageOf(action);
    const turnId = String(action.turnId ?? '');
    void fire({ type: 'message', session: relaying.uri, chat: relaying.chatUri, turn: turnId, text: String(message.text ?? '') });
    return beginTurn(
      () => beginOrRun(relaying, sessions.get(relaying.uri)?.agent.provider ?? 'This provider', turnId, String(message.text ?? ''),
        modelIn(message.model), messageFrom(message), connection, undefined, undefined, undefined,
        () => { relaying.relay?.('chat', action, origin); }),
      (why) => { no(why); },
      (why) => { no(why); },
    );
  }
  /*
   * A message's attachments, written before the action is applied.
   *
   * A pasted picture arrives as its own bytes and a file only the client has
   * does not arrive at all, so both are written under the session's own folder
   * and the message names them.
   * Here, ahead of everything else this action does, because a session resumed
   * for it reads a transcript and a turn started by it runs a model, and
   * neither should be reached with bytes the host means to write.
   *
   * Writing them is a file's worth of work, so the action waits and its
   * client's later dispatches wait behind it: a client that sends a
   * message and then a stop means that order. The settled action goes back
   * through `conn.applyNow`, which applies it as this client's own dispatch -
   * so its echo carries the `clientSeq` the client sent, exactly as if the
   * message had arrived naming a file.
   *
   * A message with nothing to write is applied here and now, in the tick it
   * arrived in, which is every message that carries no attachment.
   */
  if ((type === 'chat/turnStarted' || type === 'chat/pendingMessageSet')) {
    const uri = sessionFor(channel);
    const message = messageOf(action);
    if (needsWriting(message, kept, idOf(uri))) {
      return settledMessage(message, uri).then((settled) => conn.applyNow({ ...params, action: { ...action, message: settled } }, origin));
    }
  }
  /*
   * Which chat a client action is about.
   *
   * A chat channel names one; a session channel names the default,
   * because that is what a client talking to a session without having
   * asked for a chat means. A worker's chat names its session's lead,
   * whose backend runs the worker.
   */
  const owning = worker ? sessionFor(channel) : channel;
  const holding = sessions.get(owning);
  const held = byChat.get(channel)?.chat ?? (holding ? leadOf(holding) : undefined);
  /*
   * A session being started again waits for the start to finish.
   *
   * Moving a fixed key restarts the backend, and the first send pushes
   * the whole config and then the first turn without waiting for the
   * host between them. The turn is applied when the session it was
   * meant for is the one that exists - a backend started again is a new
   * object under the same URI - and a restart that failed answers every
   * action that waited on it with its own failure, which is the same
   * thing a refused action reads.
   *
   * Asked of the session the channel names rather than of what is
   * running, and before anything that reads "nothing is running" as a
   * session to browse: while it restarts, the session is out of
   * `sessions` and its chats out of `byChat`. The wait is returned, so
   * its client's later dispatches go behind it.
   */
  const running = restarting.get(sessionFor(channel));
  /*
   * Except a start, said at once, with the restart its preparation: the turn
   * is handed to the session that comes up, ended in an error with the
   * restart's failure, or left unsent once it is stopped, as the reference
   * host shows a turn running while the work its send needs is done. Its stop
   * is said at once too, and nothing has the turn to stop.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2180-L2350
   */
  if (running !== undefined && type === 'chat/turnStarted') {
    const since = Date.now();
    const turnId = String(action.turnId ?? '');
    if (!ctx.answered(origin)) dispatch(channel, action, origin);
    void running
      .then((failure) => {
        if (ctx.cancelledTurns.get(channel)?.has(turnId) === true) return undefined;
        if (failure !== undefined) unsent(channel, 'sendFailed', failure, since);
        else return conn.applyNow(params, origin);
        return undefined;
      })
      .catch((error: unknown) => { unsent(channel, 'sendFailed', error instanceof Error ? error.message : String(error), since); });
    return;
  }
  if (running !== undefined && type === 'chat/turnCancelled') {
    dispatch(channel, action, origin);
    return;
  }
  if (running !== undefined) {
    return running.then((failure) => {
      if (failure !== undefined) refuse(connection.peer, channel, action, origin, failure);
      else return conn.applyNow(params, origin);
      return undefined;
    });
  }
  /*
   * Config for a session with no agent yet: remembered, not refused.
   *
   * It is applied when the session is resumed, which is what makes the
   * controls on a browsed row mean something. Starting an agent here
   * instead would start one per setting somebody tried.
   */
  if (!held && type === 'session/configChanged') {
    const config = (typeof action.config === 'object' && action.config !== null
      ? action.config
      : {}) as Record<string, unknown>;
    /*
     * Only for a session this host runs, has listed, or finds in the
     * catalogue with a transcript: the store is keyed by id, and a
     * channel that names none would be a row for nothing. This host's
     * own keys decide a directory when a session is created, which a
     * browsed row was long ago, so they are not the store's.
     */
    const keep = (): void => {
      const uri = sessionFor(channel);
      const taken = Object.fromEntries(Object.entries(config).filter(([key]) => !HOSTS_OWN.includes(key)));
      if (Object.keys(taken).length > 0) {
        kept.setConfig(idOf(uri), { ...kept.config(idOf(uri)), ...taken });
        ctx.keepName(idOf(uri));
      }
      dispatch(uri, action, origin);
    };
    const known = (): boolean => sessions.has(sessionFor(channel)) || owners.has(sessionFor(channel));
    // Before `past`, which answers nothing for a session waiting for its
    // agent and would have this one say it is not a session at all.
    const waiting = waitingFor(idOf(sessionFor(channel)));
    if (waiting !== undefined) {
      no(`${waiting} is not loaded on this host`);
      return;
    }
    if (known()) {
      keep();
      return;
    }
    // `past` reads the catalogue first, which is what lists it, under the one
    // name the session is published by.
    return past(idOf(sessionFor(channel))).then(() => {
      if (known()) keep();
      else no(`${channel} is not a session here`);
    });
  }
  /*
   * A turn on a session this host is not running yet.
   *
   * This is where browsing becomes continuing: the row was readable
   * from its transcript, and saying something is what makes it worth
   * a subprocess. Resumed rather than replayed - the agent gets the
   * context it built before, not a transcript it has been shown.
   *
   * Woken for it, and the turn applied again as this client's dispatch to
   * the session that is live, the way any other action on a sleeping
   * session is: the turn is begun on its chat by the road every turn takes,
   * and its echo carries the `clientSeq` the client sent. Held awake from
   * the wake until the turn has been applied. The wait is returned, so its
   * client's later dispatches go behind it.
   */
  if (!held && type === 'chat/turnStarted') {
    // The session the chat belongs to, which is not the chat's own name:
    // a chat URI carries its session rather than being derived from it.
    const uri = sessionFor(channel);
    const release = hold(uri);
    return wake(uri, channel, connection).then(
      () => {
        if (!byChat.has(channel) && !sessions.has(channel)) {
          no(`${channel} is not a chat of ${uri}`);
          return;
        }
        return conn.applyNow(params, origin);
      },
      (error: unknown) => {
        refuse(connection.peer, channel, action, origin, error instanceof Error ? error.message : String(error));
      },
    ).finally(release);
  }
  const session = held;
  /*
   * A draft in a session this host is not running.
   *
   * The one client action worth taking without starting anything: it
   * moves no conversation, costs a map entry, and starting a CLI
   * because somebody typed a character would be a session opened by
   * accident. Everything else still needs a session, and says so.
   *
   * Checked against the catalogue rather than taken on trust, the way
   * `chat/turnStarted` is - a chat URI is a client's to spell, and a
   * draft held for a session nobody has is a map that only grows. The read
   * is returned, so its client's later dispatches go behind it, as the
   * reference host queues an action on a chat whose session it has not
   * restored.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L12492-L12507
   */
  if (!session && type === 'chat/draftChanged') {
    const uri = sessionFor(channel);
    const id = idOf(uri);
    return (async () => {
      const missing = waitingFor(id);
      if (missing !== undefined) {
        refuse(connection.peer, channel, action, origin, `${missing} is not loaded on this host`);
        return;
      }
      // The session the chat belongs to, under the name it is published by,
      // which the catalogue's read names.
      const found = await past(id);
      if (!found || ctx.nameOf(id) !== uri) {
        refuse(connection.peer, channel, action, origin, `${channel} is not a session this host knows`);
        return;
      }
      const next = typeof action.draft === 'object' && action.draft !== null
        ? action.draft as Bag
        : undefined;
      // The draft this host holds already moves nothing kept, and goes to
      // every client of the chat, as a flag that did not move does.
      if (JSON.stringify(next) === JSON.stringify(drafts.get(channel))) {
        dispatch(channel, action, origin);
        return;
      }
      if (next === undefined) drafts.delete(channel);
      else drafts.set(channel, next);
      // Echoed, because the point of a draft being on the wire at all is
      // that the other clients watching this chat see it.
      dispatch(channel, action, origin);
    })();
  }
  // With its keys, because the useful half of this line is what was in the
  // action nobody read - a type alone says only that a client wanted
  // something.
  const nothing = (): void => {
    const carried = Object.keys(action).filter((key) => key !== 'type');
    no(`${type} names nothing here${carried.length > 0 ? ` (${carried.join(', ')})` : ''}`);
  };
  const asleep = !session && !worker && !sessions.has(sessionFor(channel)) && owners.has(sessionFor(channel));
  /*
   * A stop on a session asleep in the catalogue.
   *
   * A session with no backend runs no turn, so the stop has nothing to stop.
   * It goes to every client of the chat as the client's own action, as the
   * reference host answers a stop of no active turn, and the chat's reducer
   * leaves the chat as it was. Nothing is woken to find that out.
   * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L13530-L13535
   */
  if (asleep && type === 'chat/turnCancelled') {
    dispatch(channel, action, origin);
    return;
  }
  /*
   * Any other action on a session asleep in the catalogue.
   *
   * Woken for it, and the action applied again to the session that is live,
   * the same way an action waits for a session being started again. A config
   * change and a draft are kept above without a wake. The wait is returned, so
   * its client's later dispatches go behind it.
   */
  if (asleep) {
    const uri = sessionFor(channel);
    const release = hold(uri);
    return wake(uri, channel, connection).then(
      () => {
        if (!byChat.has(channel) && !sessions.has(channel)) {
          nothing();
          return;
        }
        return conn.applyNow(params, origin);
      },
      (error: unknown) => {
        refuse(connection.peer, channel, action, origin, error instanceof Error ? error.message : String(error));
      },
    ).finally(release);
  }
  if (!session) {
    nothing();
    return;
  }
  const command = commandOf(session);
  if (command !== undefined) {
    bang(session, session.chatUri, command);
    return;
  }
  /*
   * A session whose agent has gone for good refuses everything that follows
   * with the sentence it ended with, a draft included, since nothing will
   * read it.
   */
  const over = session.ended?.();
  if (over !== undefined && type === 'chat/turnStarted') {
    // As the reference host ends a turn it finds no agent for.
    // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTurnStarter.ts#L119-L136
    unsent(session.chatUri, 'noAgent', over);
    return;
  }
  if (over !== undefined) {
    refuse(connection.peer, channel, action, origin, over);
    return;
  }
  /*
   * The chat this action is about, as this host holds it: the state every
   * client of the chat was served. The protocol states its checks of a client
   * action over the chat's state, so they read this one, and a refusal names
   * a condition a client can see. A worker's chat is its own channel; any
   * other chat action is about the chat its backend serves.
   * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L345-L359
   * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentService.ts#L13526-L13535
   */
  const chatHeld = (ctx.stateOf(worker ? channel : session.chatUri) ?? {}) as Bag;
  const activeHeld = chatHeld.activeTurn as Bag | undefined;
  /**
   * A stop of `turn`, the held running turn of the chat it was sent on and
   * the turn the stop names, said when it is taken, so the turn ends in every
   * client's state at once: the client's own stop as it sent it, and a resumed
   * turn's with the time it ran across both its runs, as the reference host
   * measures it. The backend is told to stop after, and what it says of that
   * turn then reduces to nothing.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13555-L13565
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1586-L1589
   */
  const stopped = (turn: string): void => {
    const resumed = ctx.resumedTurns.get(`${channel}\n${turn}`);
    dispatch(channel, resumed === undefined ? action : { ...action, duration: resumed.duration + (Date.now() - resumed.since) }, origin);
  };
  /** `running`'s backend told to stop what it runs; one that cannot is a line in the log. */
  const aborted = (running: NonNullable<typeof held>): void => {
    const failed = (error: unknown): void => { log(`${running.chatUri} could not be stopped: ${error instanceof Error ? error.message : String(error)}`); };
    try { void Promise.resolve(running.abort()).catch(failed); }
    catch (error) { failed(error); }
  };
  /**
   * Whether the held running turn has an input request by this id that has
   * no response yet, which is what an input action answers.
   * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/elicitation.md#L67-L76
   */
  const asking = (requestId: string): boolean => (Array.isArray(activeHeld?.responseParts) ? activeHeld.responseParts as Bag[] : [])
    .some((part) => part.kind === 'inputRequest' && part.response === undefined
      && (part.request as Bag | undefined)?.id === requestId);
  /**
   * The client a call of the held running turn names as its contributor, which
   * is the one client the protocol lets say what the call did.
   * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L306-L318
   */
  const clientRunning = (toolCallId: string): string | undefined => {
    const call = (Array.isArray(activeHeld?.responseParts) ? activeHeld.responseParts as Bag[] : [])
      .map((part) => (part.kind === 'toolCall' ? part.toolCall as Bag | undefined : undefined))
      .find((one) => one?.toolCallId === toolCallId);
    const contributor = call?.contributor as Bag | undefined;
    return contributor?.kind === 'client' && typeof contributor.clientId === 'string' ? contributor.clientId : undefined;
  };
  switch (type) {
    case 'chat/turnStarted': {
      const message = (typeof action.message === 'object' && action.message !== null
        ? action.message
        : {}) as Record<string, unknown>;
      const text = String(message.text ?? '');
      const turnId = String(action.turnId ?? '');
      /*
       * The client's start, said as it sent it once this host's own checks of
       * it have passed, and then admitted: a turn this host will not run ends
       * in `chat/error` on it, as the reference host's admission ends one. A
       * session or a chat filed away is read-only, in the reference host's
       * words.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/turnAdmission/turnAdmissionContribution.ts#L29-L42
       */
      const since = Date.now();
      if (!ctx.answered(origin)) dispatch(session.chatUri, action, origin);
      if ((kept.flags(idOf(session.uri)) & Status.IsArchived) !== 0) {
        unsent(session.chatUri, 'archived', 'This session is archived and read-only. Restore the session to continue the conversation.');
        break;
      }
      if (session.chatUri !== sessions.get(session.uri)?.defaultChat && (kept.chatFlags(idOf(session.uri), session.chatUri) & Status.IsArchived) !== 0) {
        unsent(session.chatUri, 'archived', 'This chat is archived and read-only. Restore the chat to continue the conversation.');
        break;
      }
      // Before it is started or queued, so a handler sees it once
      // whether or not the backend is free to run it this moment.
      void fire({ type: 'message', session: session.uri, chat: session.chatUri, turn: turnId, text });
      const owner = sessions.get(session.uri);
      /*
       * A set of client plugins that moved since this agent started.
       *
       * A backend takes its plugins when its CLI starts and offers no way to
       * open another after, so a chat handed a different set is one started
       * again, resumed - the same conversation, with the plugins the session
       * has now. This is the first moment a chat is between turns, and the
       * only one where starting it again is safe: a send that arrives during
       * a turn waits its turn, and the sets are compared again at the next.
       */
      let live = session;
      if (owner !== undefined && (statusOf(session.uri) & Status.InProgress) === 0 && pluginsMoved(session.uri, session.chatUri)) {
        restartChat(session.uri, session.chatUri, conn.tokensFor(chatAgent(owner, session.chatUri).provider), connection);
        // The chat that was running is closed and this is the one that took its
        // place, so the turn below goes to the agent listening now.
        live = owner.chats.get(session.chatUri) ?? session;
      }
      const provider = owner?.agent.provider ?? 'This provider';
      /*
       * Its preparation before its prompt goes out: the chats it attaches read
       * out, a policy check, and a machine set where this host's branch is. A
       * check that refuses it ends it in an error in the check's words, a
       * preparation or a send that throws ends it in a `sendFailed` one, and a
       * turn stopped meanwhile is never handed to the backend, as the reference
       * host prepares and sends a turn.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2241-L2346
       */
      const attached = messageAttachments(message, connection);
      if (attached.refusal !== undefined) {
        unsent(session.chatUri, 'sendFailed', attached.refusal, since);
        break;
      }
      // Its start is the client's, said above, so nothing more is said for it.
      beginTurn(
        () => beginOrRun(live, provider, turnId, text, modelIn(message.model), messageFrom(message), connection, attached.attachments,
          () => undefined, () => ctx.cancelledTurns.get(session.chatUri)?.has(turnId) === true),
        (why) => { unsent(session.chatUri, 'rejected', why, since); },
        (why) => { unsent(session.chatUri, 'sendFailed', why, since); },
      );
      break;
    }
    /**
     * One key, merged.
     *
     * The action carries only what changed, so writing the whole
     * object back would revert whatever another client set while this
     * one had the form open.
     */
    /*
     * A rename from a client.
     *
     * On a chat channel it names that chat, the way the reference host
     * reads it: the client's action goes out on that channel, then the
     * chat's held title and its row move together, and a default chat
     * renames its session after. On the session channel it names the
     * session, which is its default chat. Blank is a refusal, not a blank
     * title: a row nobody can find again is the thing the derived title
     * exists to prevent.
     * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/chatContributions/sessionTitle/sessionTitleContribution.ts#L53-L72
     */
    case 'session/titleChanged': {
      const uri = session.uri;
      const owner = sessions.get(uri);
      if (owner === undefined) {
        no(`${channel} is not a session this host is running`);
        break;
      }
      const title = String(action.title ?? '').trim();
      if (title === '') {
        no('a title cannot be blank');
        break;
      }
      if (byChat.has(channel)) {
        dispatch(channel, action, origin);
        renameChat(uri, channel, title);
        break;
      }
      // The client's rename, said on the channel it came on, which is the
      // session's own rename when it came on the session's channel.
      dispatch(channel, action, origin);
      renameSession(uri, title, channel === uri);
      break;
    }
    /*
     * A folder added to, taken from, or put in place of one in the session's
     * set, each as the protocol's reducers apply it: a set adds a folder the
     * set lacks, a removal takes out one it holds, and a replacement puts the
     * folder `replacement` names where `directory` was, a replacement the set
     * holds already keeping the earlier of its two places.
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/actions.ts
     *
     * The SDK takes its directories when the CLI starts, so a change starts the
     * backend again, resumed: the same conversation in the folders it now has.
     * Not while a turn is running, since a CLI replaced mid-answer is an answer
     * that stops halfway. An action that changes nothing starts nothing and
     * goes to every client of the session, and one that names no folder is
     * refused.
     */
    case 'session/workingDirectorySet':
    case 'session/workingDirectoryRemoved':
    case 'session/workingDirectoryReplaced': {
      const owner = holding ?? (byChat.get(channel) ? sessions.get(byChat.get(channel)?.uri ?? '') : undefined);
      if (owner === undefined) {
        no(`${channel} is not a session this host is running`);
        break;
      }
      if (owner.agent.multipleDirectories !== true) {
        no(`${owner.agent.provider} works in one directory per session`);
        break;
      }
      const uri = session.uri;
      if ((statusOf(uri) & Status.InProgress) !== 0) {
        no('a working directory cannot change while a turn is running');
        break;
      }
      const path = (value: unknown): string => localPath(String(value ?? ''));
      const one = path(action.directory);
      const into = type === 'session/workingDirectoryReplaced' ? path(action.replacement) : one;
      if (one === '' || into === '') {
        no(`${type} names no folder`);
        break;
      }
      // The first is the process root, which a removal MUST NOT take out.
      if (type === 'session/workingDirectoryRemoved' && one === owner.workingDirectory) {
        no('the first working directory is the one the agent runs in, and cannot be removed');
        break;
      }
      const root = owner.workingDirectory;
      const was = root === undefined ? owner.additional ?? [] : [root, ...(owner.additional ?? [])];
      const at = was.indexOf(one);
      const there = was.indexOf(into);
      let next = was;
      if (type === 'session/workingDirectorySet') {
        if (at < 0) next = [...was, one];
      }
      else if (type === 'session/workingDirectoryRemoved') {
        next = was.filter((other) => other !== one);
      }
      else if (at >= 0 && there !== at) {
        // In the entry's place when the replacement is new or held later, and
        // the entry gone when the replacement is held earlier.
        const placed = was.map((other, index) => (index === at ? into : other));
        next = there < 0 ? placed
          : there > at ? placed.filter((_, index) => index !== there)
          : was.filter((_, index) => index !== at);
      }
      if (next.length === was.length && next.every((entry, index) => entry === was[index])) {
        dispatch(channel, action, origin);
        break;
      }
      /*
       * The folder this action puts the session into, if any: the window is
       * asked about it before anything is written, the question a move asks,
       * and an answer of no means the session never went there. A worktree
       * the restart makes from it needs no question of its own, since one the
       * host made is trusted exactly when its repository is.
       */
      const entering = next.find((entry) => !was.includes(entry));
      const moving = root !== undefined && next[0] !== root;
      const auto = autoApproved({ ...owner.agent.defaults(), ...contributedDefaults(), ...owner.config }, rootConfig);
      void (async () => {
        try {
          if (entering !== undefined) {
            await requireTrust({ folder: entering, sender: connection, trust: rootConfig.workspaceTrust, autoApproved: auto });
          }
          /*
           * A new first folder is a move, made as `set_workspace` makes one:
           * the restart starts the session there, in a worktree of it when
           * the session is isolated, and says where it went. The client's
           * own action follows as its answer.
           */
          owner.additional = root === undefined ? next : next.slice(1);
          await restart(
            uri,
            conn.tokensFor(owner.agent.provider),
            { additional: owner.additional, ...(moving ? { directory: next[0] } : {}) },
            connection,
            undefined,
            conn.tokensFor,
          );
          dispatch(uri, action, origin);
        }
        catch (error) {
          no(error instanceof Error ? error.message : String(error));
        }
      })();
      break;
    }
    case 'session/configChanged': {
      const config = (typeof action.config === 'object' && action.config !== null
        ? action.config
        : {}) as Record<string, unknown>;
      // Config belongs to the session, so it is remembered there: a
      // chat opened after this one is answered starts on it too.
      const owning = holding ?? (byChat.get(channel) ? sessions.get(byChat.get(channel)?.uri ?? '') : undefined);
      /*
       * A chat of another backend's config is not the session's.
       *
       * The schema is that backend's, the row it is kept on is the chat's, and
       * the value would be spawned into every chat the session has - one of
       * them a backend that has never heard of the key. Refused in a sentence
       * that says whose config it is rather than applied to the wrong harness.
       */
      const foreign = owning === undefined ? undefined : owning.backends.get(session.chatUri);
      if (foreign !== undefined) {
        no(`${session.chatUri} runs on ${foreign.agent.provider}, and its config is not ${session.uri}'s`);
        break;
      }
      /*
       * A source the session already made a machine from is that machine.
       *
       * The first send pushes the whole config bag, including the
       * `disposable:<profile>` the person picked, while the session is
       * running in the `computer://<id>` it was made into. Reading the
       * two as the same choice is what stops the fixed-key rule from
       * starting the session again with a value no backend can enter -
       * and from making a second machine while the first is alive.
       */
      const made = sessionMachines.get(session.uri);
      if (made !== undefined) {
        for (const [key, value] of Object.entries(config)) {
          if (value === made.source) config[key] = made.machine;
        }
      }
      /*
       * What each key held before this action, read before anything
       * writes over it.
       *
       * A fixed key is judged by whether it actually moved - a client
       * sends its whole config bag back on the first send - and once
       * the loop below has written the new value the old one is gone.
       * The value in effect, defaults included: a session created with
       * `{}` still runs on each default, and a client re-sending one is
       * not asking for anything.
       */
      const before = new Map<string, unknown>();
      const stored = new Map<string, unknown>();
      if (owning) {
        const effective = { ...owning.agent.defaults(), ...contributedDefaults(), ...owning.config };
        for (const key of Object.keys(config)) {
          before.set(key, effective[key]);
          stored.set(key, owning.config[key]);
        }
        // Kept as it arrived. A config value is `unknown` on the wire,
        // and `permissions` is an object - stringifying it made a
        // session remember the word `[object Object]`.
        for (const [key, value] of Object.entries(config)) owning.config[key] = value;
      }
      /*
       * A refused key put back as it was.
       *
       * The session's config is what a later chat and a restart are
       * spawned with, so a value refused here and left in it would be
       * applied anyway by the next chat opened in the session.
       */
      const undo = (key: string): void => {
        // Not over a value something else has written since.
        if (owning === undefined || owning.config[key] !== config[key]) return;
        const was = stored.get(key);
        if (was === undefined) delete owning.config[key];
        else owning.config[key] = was;
      };
      /**
       * An accepted key written to the store, which a resume after a
       * restart spawns the lead chat with.
       *
       * A key the schema scopes to one chat only when that chat is the
       * lead, since a peer chat's is that chat's and not the session's.
       * And only while the session is the one the change was made to:
       * the backend answers after a turn of the event loop, and a
       * session disposed meanwhile has had its row forgotten, maybe for
       * a new session under the same name. A session being started
       * again is still the session.
       */
      const lead = owning !== undefined && session.chatUri === owning.defaultChat;
      const life = lifeOf(session.uri);
      const remember = (key: string, value: unknown): void => {
        if (propertyOf(owning?.agent, key)?.scope === 'chat' && !lead) return;
        if (lives.get(session.uri) !== life) return;
        const id = idOf(session.uri);
        kept.setConfig(id, { ...kept.config(id), [key]: value });
      };
      /*
       * This host's own keys, which no backend has heard of.
       *
       * `isolation` and its companions decide a directory, and a
       * directory is decided when a session is created - so the answer
       * can still move while nothing has been said, and not afterwards.
       * That window is exactly the one a client puts these controls in
       * front of somebody in: it creates the backend session first so
       * the controls have somewhere to write, then sends the first
       * message. Applied together and started once, because two keys in
       * one action are one decision.
       *
       * `scope` is the one of them that decides no restart: a backend is
       * handed a folder to work in and has never heard of a charge, so
       * starting it again would throw away a conversation for a word it
       * cannot read. It is settled and refused beside the others.
       */
      const settled = decided.get(session.uri) ?? {};
      const ours = Object.entries(config)
        .filter(([key]) => HOSTS_OWN.includes(key) && key !== 'scope')
        // Only what actually differs. A client that sends its whole
        // config bag back - the same `isolation` it was given - is
        // agreeing with this host, and restarting a session to arrive
        // where it already is would be a session that disposed and
        // reopened itself for nothing.
        .filter(([key, value]) => value !== settled[key]);
      /** The same, less the key that starts nothing. */
      const rescoped = Object.entries(config)
        .filter(([key, value]) => key === 'scope' && value !== settled[key]);
      /*
       * The fixed keys a backend or a plugin declared.
       *
       * A declared key is mutable only where its schema says
       * `sessionMutable: true`: "Only properties with `sessionMutable: true`
       * in the config schema may be changed." Any other is read when the
       * backend starts - the computer a session runs in, and Claude's
       * thinking - so a new value before the first turn is the session being
       * created differently, exactly as `isolation` is. Only a key that
       * moved, for the same reason `ours` is filtered.
       * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/actions.ts#L604-L608
       */
      const fixed = owning === undefined ? [] : Object.entries(config)
        .filter(([key]) => !HOSTS_OWN.includes(key))
        .filter(([key]) => {
          const property = propertyOf(owning.agent, key);
          return property !== undefined && property.sessionMutable !== true;
        })
        .filter(([key, value]) => value !== before.get(key));
      /*
       * One restart for both kinds of fixed key, because two keys in
       * one action are one decision - and a restart is a backend start.
       */
      const moved = [...ours, ...fixed];
      /*
       * One answer for the whole action, by this host's own checks of it and
       * before anything it causes: every key the client sent in one echo, or
       * the action refused and nothing of it kept. "The server validates and
       * broadcasts the action", and its client holds it pending until that
       * answer; the reference host checks a config change, then says the
       * client's action once, or refuses it.
       * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/actions.ts#L603-L608
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13576-L13661
       */
      const refused = (why: string): void => {
        for (const key of Object.keys(config)) undo(key);
        no(why);
      };
      /*
       * A value of the wrong shape for its key, which is a different
       * thing from a value that is fixed. The two pattern keys take a
       * list; `isolation`, the branch and the three branch rows take a
       * string, and a list sent for one of those is a mistake worth
       * saying so about.
       */
      const listOf = (key: string): boolean => key === 'worktreeIncludeFiles' || key === 'worktreeSymlinkFolders';
      const bad = owning === undefined ? undefined : [...ours, ...rescoped].find(([key, value]) => typeof value !== 'string'
        && !(listOf(key) && Array.isArray(value) && value.every((one) => typeof one === 'string')));
      if (bad !== undefined) {
        refused(`${bad[0]} takes ${listOf(bad[0]) ? 'a list of patterns' : 'a string'}`);
        break;
      }
      const started = owning !== undefined && [...owning.chats.values()].some((chat) => chat.allTurns().length > 0);
      if (started && (moved.length > 0 || rescoped.length > 0)) {
        refused(`${moved[0]?.[0] ?? rescoped[0]?.[0]} is fixed once the session has started`);
        break;
      }
      /*
       * The keys the session's backend is asked about: every key but this
       * host's own, the ones it takes, and the ones the schema fixes, which a
       * start takes.
       *
       * What the schema says about a key: `host.ts` imports no backend, and
       * the two things this layer needs to know are declared there - whether
       * the key can move on a running session, and whether it belongs to the
       * session or to one chat in it.
       *
       * A key the schema does not declare goes to the backend too, which
       * takes it or says why it did not.
       */
      const asked = Object.entries(config)
        .filter(([key]) => {
          if (HOSTS_OWN.includes(key) || Object.hasOwn(HOSTS_TAKEN, key)) return false;
          const property = propertyOf(owning?.agent, key);
          return property === undefined || property.sessionMutable === true;
        });
      if (asked.length > 0 && session.setConfig === undefined) {
        refused(`${asked[0]?.[0] ?? ''} is not a config key this backend takes`);
        break;
      }
      /*
       * A value its property's list does not offer, in the reference host's
       * words for one, since a client draws a property with a list as a
       * picker of exactly those values.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/sessionConfigProperties.ts#L144-L148
       */
      const unoffered = asked.find(([key, value]) => {
        const listed = propertyOf(owning?.agent, key) as { enum?: unknown[]; enumDynamic?: boolean } | undefined;
        return value !== undefined && Array.isArray(listed?.enum) && listed.enum.length > 0 && listed.enumDynamic !== true
          && !listed.enum.some((candidate) => candidate === value);
      });
      if (unoffered !== undefined) {
        refused(`Session configuration '${unoffered[0]}' does not offer '${String(unoffered[1])}'.`);
        break;
      }
      const uri = session.uri;
      /*
       * Every key as the client sent it, a source the session was already
       * made from read as that machine, kept and said once the change is
       * checked.
       */
      const said = (taken: Record<string, unknown>): void => {
        for (const [key, value] of Object.entries(taken)) if (!HOSTS_OWN.includes(key)) remember(key, value);
        // A key this host took is one of its answers, which every snapshot of
        // the session says back over the backend's config.
        const answered = Object.entries(taken).filter(([key]) => Object.hasOwn(HOSTS_TAKEN, key));
        if (answered.length > 0) decided.set(uri, { ...decided.get(uri), ...Object.fromEntries(answered) });
        // Said on the session's channel, and answered on the channel it came
        // on, a chat's for a key the schema scopes to one chat.
        if (channel === uri) dispatch(uri, { ...action, config: taken }, origin);
        else {
          dispatch(uri, { ...action, config: taken });
          dispatch(channel, { ...action, config: taken }, origin);
        }
      };
      /*
       * The keys the schema does not declare, which are the backend's to
       * judge before the change is said: the schema this host checks says
       * nothing of them, and a backend may take a key it does not advertise
       * or refuse one it does not serve, in its own words. A refusal puts back
       * each such key taken before it.
       */
      const unschemed = asked.filter(([key]) => propertyOf(owning?.agent, key) === undefined);
      const judged = async (): Promise<string | undefined> => {
        const done: string[] = [];
        for (const [key, value] of unschemed) {
          const answer = await Promise.resolve(session.setConfig?.(key, value))
            .catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
          if (answer !== true) {
            for (const back of done) void Promise.resolve(session.setConfig?.(back, before.get(back)));
            return typeof answer === 'string' ? answer : `${key} is not a config key this backend takes`;
          }
          done.push(key);
        }
        return undefined;
      };
      /*
       * The keys handed to the session's backend once the change is said, one
       * at a time in the order they were sent. A string answer is the
       * backend's own words for a value it could not take, which this host
       * logs: the change stands as every client was told it, as the reference
       * host applies a config change its checks passed to its agents.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13654-L13679
       *
       * Every chat, or only this one, as the property says. A permission
       * mode and an output style are the session's: the chats are peers on
       * one config, and a voice set on one of them is a session where two
       * conversations answer differently. A model is the chat's. A chat of
       * another backend is not one of the peers here: a key this session's
       * backend takes is a key another may not, so it is left to the chat's
       * own config.
       */
      const handing = async (): Promise<void> => {
        for (const [key, value] of asked) {
          if (!unschemed.some(([one]) => one === key)) {
            const answer = await Promise.resolve(session.setConfig?.(key, value))
              .catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
            if (answer !== true) log(`${session.chatUri}: ${key} was not taken by its backend: ${typeof answer === 'string' ? answer : 'no answer'}`);
          }
          const everywhere = propertyOf(owning?.agent, key)?.scope === 'chat'
            ? []
            : (owning ? [...owning.chats].filter(([chat]) => !owning.backends.has(chat)).map(([, chat]) => chat) : [])
              .filter((chat) => chat !== session);
          for (const chat of everywhere) void Promise.resolve(chat.setConfig?.(key, value));
        }
        /*
         * A key this host takes goes to every chat's backend, as the reference
         * host's agents are handed every key but its own and read one as it
         * stands: what a backend answers decides nothing, since this host took
         * the key. A nested session's host inside judges that session's
         * commands by the locations it is handed.
         * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L520-L528
         * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentConfigurationService.ts#L205-L217
         */
        for (const [key, value] of Object.entries(config)) {
          if (!Object.hasOwn(HOSTS_TAKEN, key)) continue;
          for (const chat of owning === undefined ? [session] : owning.chats.values()) void Promise.resolve(chat.setConfig?.(key, value));
        }
      };
      /*
       * A fixed key that did not move is not a change at all: a client
       * re-sending the value it was given is agreeing with this host rather
       * than asking for anything, and it is answered with the rest.
       */
      if ((moved.length === 0 && rescoped.length === 0) || owning === undefined) {
        if (unschemed.length === 0) {
          said(config);
          void handing();
          break;
        }
        return judged().then((why) => {
          if (why !== undefined) refused(why);
          else {
            said(config);
            void handing();
          }
        });
      }
      const mine = { ...settled };
      for (const [key, value] of [...ours, ...rescoped]) mine[key] = value;
      decided.set(session.uri, mine);
      /*
       * What the work is charged to is decided with the rest of the
       * window, so a scope that moved is resolved again here or the
       * turn would be charged to the session it was created as.
       *
       * Resolved against the session's owner and not against whoever
       * sent the change: the work belongs to the person who started
       * it, and a colleague who can see the session is not thereby
       * able to move its charge onto their own team. A root-owned
       * session names no person, so it goes to nobody - and a session
       * this host began before it recorded an owner is answered for
       * exactly as it always was. An owner this process has not seen
       * sign in cannot be checked, so the turn is refused until they do.
       *
       * What it was charged to is held, because a refusal puts it back:
       * the action is one decision, and a decision that was not taken
       * leaves nothing of itself behind.
       */
      const wasCharged = charged.get(session.uri);
      const wasScope = kept.scope(idOf(session.uri));
      const owner = kept.owner(idOf(session.uri));
      const person = owner === undefined ? connection.principal : principalFor(owner);
      if (rescoped.length > 0) {
        if (owner?.startsWith('user:') === true && person === undefined) {
          charged.set(session.uri, { refusal: `${owner.slice('user:'.length)} has to sign in once before this session's scope can change` });
        }
        else charge(session.uri, person, typeof mine.scope === 'string' ? mine.scope : undefined);
      }
      /** The whole action refused, with the row this host decides from and the charge the scope moved onto put back. */
      const withdrawn = (why: string): void => {
        decided.set(session.uri, settled);
        if (rescoped.length > 0) {
          if (wasCharged === undefined) charged.delete(uri);
          else charged.set(uri, wasCharged);
          kept.setScope(idOf(uri), wasScope);
        }
        refused(why);
      };
      if (moved.length === 0) {
        if (unschemed.length === 0) {
          said(config);
          void handing();
          break;
        }
        return judged().then((why) => {
          if (why !== undefined) withdrawn(why);
          else {
            said(config);
            void handing();
          }
        });
      }
      /*
       * The restart, held while it runs.
       *
       * A turn can arrive in the window between the whole config
       * being pushed and the backend being ready - VS Code sends
       * both back to back - so `applyDispatch` waits on this
       * promise before it touches the session, and a turn said
       * meanwhile waits on it before its send. It is cleared before
       * the promise settles to its consumers, so an action that
       * waited re-runs against the backend that is actually there.
       *
       * Whether this session may move to the machine it is being
       * moved to is asked first, where the keys are still theirs and
       * the backend is still the one it was. It is the same
       * `admitted` a client's `createSession` asks, against the
       * person who owns the work and the scope it is being charged
       * to, and it is one of this host's checks of the change: a
       * refusal undoes the whole action, the keys, the row this host
       * decides from and the charge the scope moved onto, before
       * anything of it is said, and the session stays exactly where
       * it was.
       *
       * Admitted, the change is said, and the restart is its side
       * effect. The backend started again is started on the session's
       * config, which holds every key of the action; a machine it made
       * from a source the client named is said after it as this
       * host's own, since every client holds the source. The client's
       * next dispatch waits for the check, so what it sends after the
       * change is said after it.
       */
      const admission = admitted(person, charged.get(uri)?.scope, owning.config, owning.agent.provider, session.uri, owner);
      let spoken = false;
      const work = (async (): Promise<string | undefined> => {
        const wrong = await admission;
        if (wrong !== undefined) return wrong;
        said(config);
        spoken = true;
        await restart(uri, conn.tokensFor(owning.agent.provider), undefined, connection, undefined, conn.tokensFor);
        const made = Object.entries(config).filter(([key, value]) => owning.config[key] !== undefined && owning.config[key] !== value);
        if (made.length > 0) {
          const machine = Object.fromEntries(made.map(([key]) => [key, owning.config[key]]));
          for (const [key, value] of Object.entries(machine)) if (!HOSTS_OWN.includes(key)) remember(key, value);
          dispatch(uri, { type: 'session/configChanged', config: machine });
        }
        return undefined;
      })();
      // The promise a close and a turn's send wait on, made from the work's: a
      // refusal is answered to the client below, so a failure is carried here
      // as its words, and its rejection reaches nobody twice.
      restarting.set(uri, work.then(() => undefined, (error: unknown) => (error instanceof Error ? error.message : String(error))));
      const held = restarting.get(uri);
      const clear = (): void => {
        if (restarting.get(uri) === held) restarting.delete(uri);
      };
      void work.then(
        (wrong) => {
          clear();
          if (wrong !== undefined) withdrawn(wrong);
        },
        (error: unknown) => {
          clear();
          const why = error instanceof Error ? error.message : String(error);
          if (!spoken) {
            withdrawn(why);
            return;
          }
          lives.delete(uri);
          log(`${uri} did not start again: ${why}`);
        },
      );
      return admission.then(() => undefined, () => undefined);
    }
    /*
     * The latest turn, run again rather than typed again.
     *
     * The protocol's own conditions - latest, errored, message and parts
     * intact - are the backend's to check, because only it knows what
     * its last turn was. A backend that cannot re-run one says so here
     * rather than being asked to.
     */
    /*
     * A directory added to or taken from this chat's own set.
     *
     * The same mechanism the session's set uses - the CLI is started
     * again, resumed - applied to one chat rather than all of them. A
     * chat may only ever narrow its session's set, so anything outside
     * it is refused rather than quietly widening the session.
     */
    case 'chat/workingDirectorySet':
    case 'chat/workingDirectoryRemoved': {
      const owner = byChat.get(channel);
      if (owner === undefined) {
        no(`${channel} is not a chat this host is running`);
        break;
      }
      const held = sessions.get(owner.uri);
      if (held === undefined || held.agent.multipleDirectories !== true) {
        no('this backend works in one directory per session');
        break;
      }
      if ((statusOf(owner.uri) & Status.InProgress) !== 0) {
        no('a working directory cannot change while a turn is running');
        break;
      }
      const one = localPath(String(action.directory ?? ''));
      if (one === '') {
        no(`${type} names no folder`);
        break;
      }
      const own = [held.workingDirectory, ...(held.additional ?? [])].filter((entry) => entry !== undefined);
      const had = beside.get(channel) ?? held.additional ?? [];
      let next = had;
      /*
       * A folder the chat holds already, the first one included, or one it
       * does not hold to take out, changes nothing and starts nothing again,
       * and goes to every client of the chat.
       * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/actions.ts
       */
      if (type === 'chat/workingDirectorySet') {
        if (!own.includes(one)) {
          no(`${one} is not a working directory of ${owner.uri}`);
          break;
        }
        if (one === held.workingDirectory || had.includes(one)) {
          dispatch(channel, action, origin);
          break;
        }
        next = [...had, one];
      }
      else {
        if (one === held.workingDirectory) {
          no('the first working directory is the one the agent runs in, and cannot be removed');
          break;
        }
        if (!had.includes(one)) {
          dispatch(channel, action, origin);
          break;
        }
        next = had.filter((other) => other !== one);
      }
      beside.set(channel, next);
      restartChat(owner.uri, channel, conn.tokensFor(chatAgent(held, channel).provider), connection);
      dispatch(channel, action, origin);
      break;
    }
    case 'chat/turnResume': {
      if (session.resumeTurn === undefined) {
        no('this backend cannot run a turn again');
        break;
      }
      /*
       * The protocol's conditions, read off the chat's held state as the
       * reference reads them: no turn running, and the latest turn errored
       * with a resumable error as its last part. Asking anyway turns a
       * client's mistake into the backend's, and a backend that reopens a
       * turn it should not takes a prompt out of the transcript for nothing.
       * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L354
       * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentService.ts#L13463-L13489
       */
      const named = String(action.turnId ?? '');
      if (activeHeld !== undefined) {
        no('A turn is running in this chat');
        break;
      }
      const last = (Array.isArray(chatHeld.turns) ? chatHeld.turns as Bag[] : []).at(-1);
      if (last === undefined || String(last.id ?? '') !== named) {
        no(`${named} is not the latest turn`);
        break;
      }
      const part = (last.responseParts as Bag[] | undefined)?.at(-1) ?? {};
      if (last.state !== 'error' || part.kind !== 'error' || part.resumable !== true) {
        no(`${named} did not end with an error that can be resumed`);
        break;
      }
      /*
       * Said, and the turn it reopens is run again by the backend, with the
       * time it ran before kept for its end. A backend that holds no such turn
       * to run ends it again in an error that can be resumed, as the reference
       * host ends a resume its agent rejects.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1817-L1876
       */
      dispatch(channel, action, origin);
      const resumed = { duration: typeof last.duration === 'number' ? last.duration : 0, since: Date.now() };
      ctx.resumedTurns.set(`${channel}\n${named}`, resumed);
      const rejected = (error: unknown): void => {
        if (!ctx.resumedTurns.has(`${channel}\n${named}`)) return;
        ctx.resumedTurns.delete(`${channel}\n${named}`);
        dispatch(channel, {
          type: 'chat/error',
          turnId: named,
          duration: resumed.duration + (Date.now() - resumed.since),
          part: { kind: 'error', error: { errorType: 'sendFailed', message: error instanceof Error ? error.message : String(error) }, resumable: true },
        });
      };
      try { void Promise.resolve(session.resumeTurn(named)).catch(rejected); }
      catch (error) { rejected(error); }
      break;
    }
    /*
     * A stop, checked against the turn the chat it names is running.
     *
     * The running turn is the one the chat's held state has, the one every
     * client of the chat was told of: a worker's chat holds the worker's turn,
     * which this host opened and reduces itself, and every other chat the turn
     * this host said. A stop stops the turn its `turnId` names, which the
     * protocol requires it to carry.
     *
     * A stop of no running turn stops nothing: a chat with no turn running, a
     * turn other than the running one, one the client saw end, or no turn at
     * all. It goes to every client of the chat as the client's own action, as
     * the reference host takes it, matching the turn before anything is
     * stopped, and the protocol's reducer ends a turn only when the id it names
     * is the active turn's, so every client's chat stays as it was. Nothing is
     * asked of a backend for it.
     * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentService.ts#L13530-L13535
     * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L186-L188
     */
    case 'chat/turnCancelled': {
      if (activeHeld === undefined || typeof action.turnId !== 'string' || action.turnId !== String(activeHeld.id ?? '')) {
        dispatch(channel, action, origin);
        break;
      }
      if (!worker) {
        // The stop is said when it is taken, and the chat's backend is then
        // told to stop what it runs, as the reference host aborts its agent.
        // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1921-L1955
        stopped(String(activeHeld.id ?? ''));
        aborted(session);
        break;
      }
      /*
       * On a worker's chat, the worker's turn, which this host opened and
       * holds, is the one the stop ends. The backend is then told to stop that
       * worker when it can stop one, named by the call its chat was opened
       * for, and otherwise to stop the lead turn that runs it.
       */
      const call = toolCallOfSubagentChat(channel);
      const lead = String((ctx.stateOf(session.chatUri)?.activeTurn as Bag | undefined)?.id ?? '');
      if ((session.stopWorker === undefined || call === undefined) && lead === '') {
        no(`Nothing is running on ${session.chatUri} to stop`);
        break;
      }
      stopped(String(activeHeld.id ?? ''));
      if (session.stopWorker !== undefined && call !== undefined) session.stopWorker(call);
      else aborted(session);
      break;
    }
    /**
     * Say it after the turn that is running.
     *
     * The queue is the host's, which is the whole difference between a
     * queue and a list: it starts the next turn from the head the
     * moment it goes idle, and every client watching the chat sees the
     * same one. Held in a client it would never be sent - nothing
     * there is watching for a turn to end.
     */
    case 'chat/pendingMessageSet': {
      const kind = String(action.kind ?? 'queued');
      const id = String(action.id ?? '');
      const message = (typeof action.message === 'object' && action.message !== null
        ? action.message
        : {}) as Record<string, unknown>;
      if (kind !== 'steering' && kind !== 'queued') {
        no(`${kind} is neither a steering message nor a queued one`);
        break;
      }
      /*
       * A backend that takes no steering refuses it, a turn running or not, in
       * the reference host's words for a provider that cannot take it.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13526-L13529
       */
      if (kind === 'steering' && !session.sendSteeringMessage) {
        no('The session provider does not support steering messages.');
        break;
      }
      /*
       * A pending message under the id of the steering message the chat holds
       * while a turn runs, which is with the backend or about to be.
       *
       * Steering handed to the backend cannot be edited: the same steering
       * message again is said and not handed a second time, and a different
       * one, or a queued message under its id, is refused in the reference
       * host's words.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13530-L13537
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L193-L203
       */
      const holding = chatHeld.steeringMessage as Bag | undefined;
      if (activeHeld !== undefined && holding !== undefined && String(holding.id ?? '') === id) {
        // By value: the held copy went through a reducer, which writes its keys in its own order.
        if (kind === 'steering' && isDeepStrictEqual(holding.message, action.message)) dispatch(session.chatUri, action, origin);
        else no('Cannot change a steering message while it is being processed.');
        break;
      }
      // Read now rather than when the turn comes round: a message waiting
      // behind another is still a message this host has to be able to answer
      // for, and the chat it points at may be gone by the time it runs.
      const read = messageAttachments(message, connection);
      if (read.refusal !== undefined) {
        refuse(connection.peer, channel, action, origin, read.refusal);
        break;
      }
      /*
       * Said, and then the queue drain's: steering is handed to the turn the
       * chat runs, and the queue's head starts once the chat runs nothing,
       * steering first, as the reference host drains a chat's pending
       * messages. Its checks are the turn's own, run when the drain admits it.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L71-L90
       */
      dispatch(session.chatUri, action, origin);
      ctx.pendingSet(session.chatUri, id, connection, read.attachments);
      break;
    }
    /**
     * Turn a skill or an MCP server on or off.
     *
     * `enablement` carries the client's whole answer, one entry per scope -
     * global, workspace, session - and a scope it leaves out is one it holds
     * no decision about any more: the array is a replacement, never a patch.
     *
     * The decision for every session and the decision for one folder outlive
     * the session they were made in, so they go to the store, and every other
     * session the change reaches is switched and told. The session's own
     * decision is this host's, and stays where this host keeps it.
     */
    case 'session/customizationToggled': {
      /*
       * The client's switch, said to every client of the session as it was
       * sent, before anything it switches. The reference host emits a client's
       * action as sent and records the client's own enablement; what this host
       * applies for a sender who may not keep a decision for every session is
       * its own.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2737-L2752
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L416-L428
       */
      dispatch(session.uri, action, origin);
      const id = String(action.id ?? '');
      const enablement = Array.isArray(action.enablement) ? action.enablement.map((entry) => (
        typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : {}
      )) : [];
      const store = ctx.options.enablement;
      const under = ctx.customizationUnder(session.uri, id);
      const key = under?.key;
      /** What the client decided at one scope, or nothing where it decided nothing there. */
      const decided = (kind: string): boolean | undefined => {
        const one = enablement.find((entry) => entry.kind === kind);
        return one === undefined ? undefined : one.enabled !== false;
      };
      /** Whether a customization is on for one session: its own decision, then the store's. */
      const onFor = (uri: string, own: boolean | undefined): boolean => {
        if (store === undefined || key === undefined) return own ?? true;
        const dir = ctx.folderOf(uri);
        return own ?? (dir === undefined ? undefined : store.folder(dir, key)) ?? store.global(key) ?? true;
      };
      /*
       * Whether this sender may keep a decision for every session or a folder.
       *
       * Those decisions switch other people's sessions, so on a host with
       * people they need what changing the host for everybody needs. A sender
       * without it switches this session alone, as a host with no store does.
       */
      const keeps = store !== undefined && (ctx.options.users === undefined || connection.root === true
        || connection.principal?.can('config:change') === true);
      const lasting = keeps && key !== undefined;
      /*
       * The decision this session made for itself, which is the whole of what
       * cannot be kept: the most specific entry the client sent stands for it,
       * because there is nowhere else for a decision about a folder or about
       * every session to go.
       */
      const asked = decided('session') ?? (lasting ? undefined : enablement[0]?.enabled !== false);
      if (store !== undefined && lasting) {
        /*
         * The folder a folder decision is about: the one the entry names,
         * which is the folder the asking window has open, or this session's
         * own where the entry names none. A session that works nowhere has no
         * folder decision, which is a workspace-less session in VS Code.
         */
        const named = enablement.find((entry) => entry.kind === 'workspace')?.uri;
        const folder = typeof named === 'string' && named !== '' ? named : ctx.folderOf(session.uri);
        const wasGlobal = store.global(key);
        const wasFolder = folder === undefined ? undefined : store.folder(folder, key);
        /** What each session answers now, which is what says whether one moved. */
        const was = new Map([...sessions.keys()].flatMap((uri) => {
          const at = ctx.customizationUnder(uri, id);
          return at === undefined ? [] : [[uri, onFor(uri, at.own)] as const];
        }));
        /*
         * The decision for every session goes in first, so a folder decision
         * is compared against the one it now inherits rather than the old one.
         */
        store.setGlobal(key, decided('global'));
        if (folder !== undefined) store.setFolder(folder, key, decided('workspace'));
        /*
         * Every open session the change reaches: every one for a decision
         * about all of them, and the sessions in the folder for one about a
         * folder. Each is switched where its answer moved and told in any
         * case, because what it inherits moved even where the answer it holds
         * for itself did not. The session that asked is below, with the
         * switch the client turned.
         */
        const everywhere = wasGlobal !== store.global(key);
        const here = wasFolder !== (folder === undefined ? undefined : store.folder(folder, key));
        for (const [uri, before] of was) {
          if (uri === session.uri || (!everywhere && !(here && ctx.folderOf(uri) === folder))) continue;
          const at = ctx.customizationUnder(uri, id);
          if (at === undefined) continue;
          const held = sessions.get(uri);
          const lead = held === undefined ? undefined : leadOf(held);
          const answer = onFor(uri, at.own);
          if (at.of === 'backend') {
            if (answer !== before) void lead?.setCustomizationEnabled(id, answer);
          }
          else {
            /*
             * The session's own decision stands where it is - only the store's
             * moved - so this switches it and says so, which is what makes a
             * customization switched off in one session switched off in the
             * session beside it.
             */
            ctx.toggleClientPlugin(uri, id, at.own === undefined ? [] : [{ kind: 'session', enabled: at.own }]);
          }
          dispatch(uri, { type: 'session/customizationsChanged', customizations: lead === undefined ? [] : lead.customizations() });
        }
      }
      /*
       * A plugin a client handed this session is this host's to switch, and so
       * is a server of one.
       *
       * The backend has never heard of the plugin - it is a directory this host
       * copied for the client, not a customization the backend reported - so
       * asking it would be asking about something it does not have, and the
       * answer would be the refusal below with the switch left where the client
       * put it. A server of a plugin is the agent's as well, and the same id
       * names it there, so that half is asked of the backend too.
       */
      const applied = store === undefined || lasting ? enablement : [{ kind: 'session', enabled: asked }];
      const toggled = ctx.toggleClientPlugin(session.uri, id, applied);
      if (toggled !== undefined) {
        /*
         * The backend is offered the switch and its answer is dropped.
         *
         * A backend with no live switch does not undo it: the decision is this
         * host's, and the next send starts the chat again without that server.
         */
        if (toggled.server !== undefined)
          void session.setCustomizationEnabled(id, onFor(session.uri, asked));
        break;
      }
      /*
       * A decision about a customization that carries one is this host's to
       * keep, whether or not the backend can switch it live, as the reference
       * host records the client's enablement of a plugin or a server and its
       * agent reconciles: a backend says whether a switch can be made and not
       * what it decided, and the list it reports next reads the decision back.
       * The session's state holds the switch as the protocol's reducer took it.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L416-L428
       */
      const on = onFor(session.uri, asked);
      if (under !== undefined) ctx.keepDecision(session.uri, id, on);
      void session.setCustomizationEnabled(id, on).then((took) => {
        if (!took) log(`${session.uri}: ${id} has no runtime switch`);
      });
      break;
    }
    /*
     * A server started or stopped, said as the client asked, and then asked of
     * the backend. A start the backend does not make leaves the server in an
     * error naming why, unless it is ready or failed already; a stop it does
     * not make is logged. The reference host does the same with its agent's
     * answers.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2026-L2065
     */
    case 'session/mcpServerStartRequested': {
      const id = String(action.id ?? '');
      dispatch(channel, action, origin);
      const failed = (why: string): void => {
        log(`${session.uri}: ${id} would not start: ${why}`);
        const listed = session.customizations() as Bag[];
        const found = listed.find((one) => one.id === id)
          ?? listed.flatMap((one) => one.type === 'mcpServer' ? [] : (one.children as Bag[] | undefined) ?? []).find((one) => one.id === id);
        const kind = (found?.state as Bag | undefined)?.kind;
        if (found?.type !== 'mcpServer' || kind === 'ready' || kind === 'error' || kind === 'authRequired') return;
        dispatch(channel, { type: 'session/mcpServerStateChanged', id, state: { kind: 'error', error: { errorType: 'mcp-server-start-failed', message: why } } });
      };
      void session.startMcpServer(id).then(
        (took) => { if (!took) failed(`${id} is not a server this backend can start`); },
        (error: unknown) => { failed(error instanceof Error ? error.message : String(error)); },
      );
      break;
    }
    case 'session/mcpServerStopRequested': {
      const id = String(action.id ?? '');
      dispatch(channel, action, origin);
      void session.stopMcpServer(id).then(
        (took) => { if (!took) log(`${session.uri}: ${id} would not stop`); },
        (error: unknown) => { log(`${session.uri}: ${id} would not stop: ${error instanceof Error ? error.message : String(error)}`); },
      );
      break;
    }
    /*
     * A startup a client asked to stop waiting on, said as it came, and then
     * handed to the backend, the only thing that knows how to stop holding a
     * turn on a server. The protocol's reducer clears a starting server's
     * `blocking`, and the server keeps that state whether or not the backend
     * takes it, as the reference host leaves it.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2066-L2072
     */
    case 'session/mcpServerBackgroundRequested': {
      const id = String(action.id ?? '');
      dispatch(channel, action, origin);
      void session.backgroundMcpServerStartup?.(id).then(
        (took) => { if (!took) log(`${session.uri}: ${id} kept its startup`); },
        (error: unknown) => { log(`${session.uri}: ${id} kept its startup: ${error instanceof Error ? error.message : String(error)}`); },
      );
      break;
    }
    case 'chat/draftChanged': {
      // A `Message`, not a string: `ChatState.draft` is the message
      // somebody is part-way through writing, model and all. Absent
      // clears it, which is what the action says `undefined` means.
      const next = typeof action.draft === 'object' && action.draft !== null
        ? action.draft as Bag
        : undefined;
      /*
       * The draft the chat holds already moves nothing, and the backend is
       * not told it again; the action goes to every client of the chat, as a
       * flag that did not move does. Read from the chat's held state, which is
       * what every client was told it holds; a client that never synced a
       * draft clears it once its message is sent.
       */
      if (JSON.stringify(next) === JSON.stringify(chatHeld.draft)) {
        dispatch(channel, action, origin);
        break;
      }
      // Said, and then held by the backend.
      dispatch(session.chatUri, action, origin);
      session.setDraft(next);
      break;
    }
    case 'chat/pendingMessageRemoved': {
      const id = String(action.id ?? '');
      const kind = action.kind === 'steering' ? 'steering' : 'queued';
      /*
       * A steering message the chat holds while a turn runs is with the
       * backend, and its removal is refused in the reference host's words
       * where the backend cannot withdraw it. Any other removal is said as
       * the client sent it, one of a message the chat no longer holds
       * included, which the reducer leaves as it was, and the queue drain
       * then takes the message back.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13522-L13536
       */
      if (kind === 'steering' && activeHeld !== undefined && (chatHeld.steeringMessage as Bag | undefined)?.id === id
        && session.withdrawSteeringMessage === undefined) {
        no('Cannot change a steering message while it is being processed.');
        break;
      }
      dispatch(session.chatUri, action, origin);
      ctx.pendingRemoved(session.chatUri, id, kind);
      break;
    }
    case 'chat/queuedMessagesReordered':
      dispatch(session.chatUri, action, origin);
      ctx.queueReordered(session.chatUri);
      break;
    case 'chat/toolCallConfirmed': {
      const toolCallId = String(action.toolCallId ?? '');
      // A confirmation of a call that is not in `pending-confirmation` in the
      // chat's held state MUST be rejected (the protocol's chat-channel.md,
      // "Server Validation of Client Actions"), so the client that sent it
      // lets go of a change this host never made.
      const pending = (Array.isArray(activeHeld?.responseParts) ? activeHeld.responseParts as Bag[] : [])
        .some((part) => part.kind === 'toolCall' && (part.toolCall as Bag | undefined)?.toolCallId === toolCallId
          && (part.toolCall as Bag).status === 'pending-confirmation');
      if (!pending) {
        no(`${toolCallId} is not a call this chat is waiting to have confirmed`);
        break;
      }
      // The decision the held state takes, said, and then handed to the backend.
      dispatch(worker ? channel : session.chatUri, action, origin);
      session.confirm(
        toolCallId,
        action.approved === true,
        typeof action.selectedOptionId === 'string' ? action.selectedOptionId : undefined,
      );
      break;
    }
    case 'chat/inputCompleted': {
      /*
       * `response`, which is the field the action has.
       *
       * `ChatInputResponseKind` is `accept`, `decline` or `cancel`. An
       * `accepted` flag is read when no `response` is sent, and `response`
       * decides when both are there.
       *
       * The kind goes on to the backend as well, because a decline and a
       * cancel are two different things to tell a server and only the
       * backend knows which of them its agent can be told. Anything that is
       * neither of the three kinds is left out, and the backend settles on
       * the two-way answer it was given.
       */
      const response = typeof action.response === 'string' ? action.response : undefined;
      const accepted = response !== undefined ? response === 'accept' : action.accepted !== false;
      const kind = response === 'accept' || response === 'decline' || response === 'cancel' ? response : undefined;
      const requestId = String(action.requestId ?? action.id ?? '');
      // An answer to a request the chat's held state is not waiting on SHOULD
      // be rejected (the protocol's chat-channel.md, "Server Validation of
      // Client Actions"). Left unsaid, the client that sent it holds it as a
      // change this host never made, and a client that sends its unechoed
      // actions again after a reconnect sends this one every time.
      if (!asking(requestId)) {
        no(`${requestId} is not a question this chat is waiting on`);
        break;
      }
      /*
       * An acceptance whose required questions "do not have submitted
       * answers" SHOULD be rejected. The completion's answers are the
       * request's synced ones with what it carries laid over them, as the
       * reducer records them, so a required question stands answered only
       * where that answer's state is `submitted`: a draft, a skip and no
       * answer are not. No VS Code client can tell: its host hands an answer
       * on unchecked, and its clients send each answer as submitted.
       * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L358
       * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L874
       * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1913-L1919
       * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L642-L692
       */
      const request = (Array.isArray(activeHeld?.responseParts) ? activeHeld.responseParts as Bag[] : [])
        .map((part) => (part.kind === 'inputRequest' ? part.request as Bag : undefined))
        .find((one) => one?.id === requestId);
      const sent = (typeof action.answers === 'object' && action.answers !== null
        ? action.answers
        : {}) as Record<string, unknown>;
      if (response === 'accept') {
        // The request's synced answers with this completion's laid over them,
        // as the reducer records them.
        const given = { ...(request?.answers ?? {}) as Bag, ...sent };
        const missing = (Array.isArray(request?.questions) ? request.questions as Bag[] : [])
          .find((question) => question.required === true
            && (given[String(question.id ?? '')] as Bag | undefined)?.state !== 'submitted');
        if (missing !== undefined) {
          no(`${String(missing.id ?? '')} is required and has no submitted answer`);
          break;
        }
      }
      /*
       * Said to every client of the chat, the answering one included, so each
       * one's `inputRequest` part carries the response now rather than when
       * the agent next moves. On the chat the question is in: a worker's own
       * chat, or the chat this session leads. Said whether or not the backend
       * still waits on the question, since the held state is what every
       * client reduces.
       */
      dispatch(worker ? channel : session.chatUri, action, origin);
      /*
       * A question this host asked is settled here, and never handed on.
       *
       * The backend did not put it, so `session.answer` has no request of that
       * id to answer: an answer passed on would be for nothing at best, and at
       * worst for a backend's request that happened to carry the same id. What
       * the person did goes back to the tool waiting on it.
       */
      if (ctx.asks.settle(requestId, kind ?? (accepted ? 'accept' : 'decline'), {
        ...(request?.answers ?? {}) as Bag, ...sent,
      })) break;
      session.answer(requestId, accepted, sent, kind);
      break;
    }
    /*
     * Drop the turns after a named one, and mean it.
     *
     * This is edit-and-resend: a client truncates to the turn before
     * the message somebody wants to change, then starts a new turn with
     * the edited text. So the agent has to forget the dropped turns as
     * well - a host that only cleared its own screen would leave the
     * conversation carrying on from a history nobody can see any more,
     * and the next answer would be about the message that was edited
     * away.
     *
     * Forgetting them means the CLI is started again, resumed at the
     * last thing the kept turn did. The turns up to there are handed
     * over as the seed, so the chat keeps its history across the
     * restart, and the session id is kept - see `rewindAt` - so a later
     * resume reaches the truncated conversation rather than the one
     * this dropped.
     */
    case 'chat/truncated': {
      const turnId = typeof action.turnId === 'string' ? action.turnId : undefined;
      const all = session.allTurns();
      /*
       * A cut before every turn the backend saw, which starts the chat over.
       *
       * As a rewind it is a cut at a point before the first prompt, and there
       * is no such entry to name; served as an emptied screen it would stand
       * in front of an agent that remembers all of it. So the agent forgets it,
       * as the reference's does: the backend stops, its conversation is
       * deleted, and a new one begins for the same chat with nothing to resume,
       * seeded with the turns the chat keeps. A backend that cannot delete
       * keeps its conversation, as the reference host's provider without a
       * truncation keeps its history.
       * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1141-L1168
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1968-L1990
       *
       * The action is said first, as the reference host says a truncation
       * before its provider cuts anything. The backend stops before the
       * delete, because a backend that is still writing writes the
       * conversation back behind it, and a delete that fails is logged and
       * leaves the chat to come back on the conversation it had. Held in
       * `restarting` the whole time, so an action sent behind it reaches the
       * new backend rather than the one that stopped.
       */
      const startOver = (kept: Bag[]): void => {
        const owner = sessions.get(session.uri);
        const agent = owner === undefined ? undefined : chatAgent(owner, session.chatUri);
        if (owner === undefined || agent?.delete === undefined) {
          uncut(all.slice(kept.length) as Bag[], 'its backend cannot delete a conversation');
          return;
        }
        const uri = session.uri;
        const chatUri = session.chatUri;
        // Read before anything closes, as a closed chat's is.
        const own = session.agentId() ?? ctx.recordedChat(idOf(uri), chatUri)?.backendId;
        dispatch(chatUri, action, origin);
        ctx.forgetTurnOutputs(uri, chatUri, all.slice(kept.length) as Bag[]);
        ctx.forgetLocalTurns(uri, chatUri, all.slice(kept.length) as Bag[]);
        const work = (async () => {
          await session.close('stopping');
          const failed = own === undefined || own === '' ? undefined : await ctx.deletedChat(own, agent, ctx.dirOf(uri));
          ctx.described.delete(chatUri);
          spawn(
            agent,
            uri,
            chatUri,
            chatIdFor(uri, chatUri),
            chatConfig(owner, chatUri),
            failed !== undefined && own !== undefined ? { resume: own, seed: all as Bag[] } : { seed: kept },
            owner.workingDirectory,
            undefined,
            beside.get(chatUri) ?? owner.additional,
            connection,
          );
          if (failed !== undefined) throw failed;
          log(`started ${chatUri} over`);
        })();
        // A delete that failed leaves the chat started again on the conversation
        // it had, so only a chat that did not come back is a start that failed.
        restarting.set(uri, work.then(() => undefined, (error: unknown) => (byChat.has(chatUri)
          ? undefined
          : error instanceof Error ? error.message : String(error))));
        const held = restarting.get(uri);
        void work.then(
          () => { if (restarting.get(uri) === held) restarting.delete(uri); },
          (error: unknown) => {
            if (restarting.get(uri) === held) restarting.delete(uri);
            log(`${chatUri} kept its conversation: ${error instanceof Error ? error.message : String(error)}`);
          },
        );
      };
      /*
       * A truncation its backend cannot make, said all the same: every client
       * drops the turns after the one named, and the backend keeps the history
       * it has, as the reference host's provider with no truncation of its own
       * does. The outputs and local turns of what was dropped go with it.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1968-L1990
       */
      const uncut = (dropped: Bag[], why: string): void => {
        dispatch(session.chatUri, action, origin);
        ctx.forgetTurnOutputs(session.uri, session.chatUri, dropped);
        ctx.forgetLocalTurns(session.uri, session.chatUri, dropped);
        log(`${session.chatUri} keeps the history after ${turnId ?? 'its start'}: ${why}`);
      };
      // Every turn: the action's `turnId` is optional, and its absence means
      // "clear the whole conversation".
      if (turnId === undefined) {
        startOver([]);
        break;
      }
      // A completed turn of the chat's held state, which is what every
      // client holds; the backend is cut at its own record of that turn.
      if (!(Array.isArray(chatHeld.turns) && chatHeld.turns.some((one) => String((one as Bag).id ?? '') === turnId))) {
        no(`${turnId} is not a completed turn in ${session.chatUri}`);
        break;
      }
      const at = all.findIndex((one) => String((one as Bag).id ?? '') === turnId);
      if (at < 0) {
        uncut([], 'its backend holds no such turn');
        break;
      }
      /*
       * The turn the backend is cut at: this one, or for a local turn, which
       * the backend never saw, the nearest earlier turn of its own - the
       * reference's redirect. A local turn with no such turn before it cuts
       * the backend's whole conversation, and the reference truncates with no
       * turn there; the chat keeps the local turns up to the one named.
       * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentSideEffects.ts#L1960-L1969
       */
      const concrete = ctx.concreteTurnOf(session.uri, session.chatUri, all as Bag[], at);
      if (concrete === undefined) {
        startOver(all.slice(0, at + 1) as Bag[]);
        break;
      }
      // The backend's own name for the end of that turn. Absent for a
      // turn the backend cannot name the end of, such as one read back by
      // a backend that names only the turns it watched, and the backend
      // then keeps its history.
      const point = session.endPoint?.(concrete);
      const started = session.agentId();
      const owner = sessions.get(session.uri);
      if (point === undefined || started === undefined || owner === undefined) {
        uncut(all.slice(at + 1) as Bag[], 'its backend names no point to rewind it to');
        break;
      }
      /*
       * Said before the restart, not after.
       *
       * A client applies this by dropping the turns after `turnId`; the
       * session that comes up behind it opens with exactly those turns.
       * In the other order a client would take a full snapshot and then
       * be told to cut it, which is the same end state reached by
       * showing somebody the turns they asked to be rid of.
       */
      dispatch(session.chatUri, action, origin);
      // The outputs the dropped turns' terminals kept go with those turns, as
      // the reference's go with the rows of the turns they belong to.
      // https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/sessionDatabase.ts#L236-L243
      ctx.forgetTurnOutputs(session.uri, session.chatUri, all.slice(at + 1) as Bag[]);
      // And the local turns among them, as the reference deletes the ones a
      // truncation drops.
      // https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentSideEffects.ts#L1977-L1981
      ctx.forgetLocalTurns(session.uri, session.chatUri, all.slice(at + 1) as Bag[]);
      // A stop, not a removal: a session starts again right below on this
      // same id, and the backend it resumes is the one just stopped.
      session.close('stopping');
      // So the next thing the new session says about itself is reported
      // rather than compared against what the old one last said.
      ctx.described.delete(session.chatUri);
      spawn(
        chatAgent(owner, session.chatUri),
        session.uri,
        session.chatUri,
        chatIdFor(session.uri, session.chatUri),
        chatConfig(owner, session.chatUri),
        { resume: started, rewindAt: point, seed: all.slice(0, at + 1) as Bag[] },
        owner.workingDirectory,
        undefined,
        beside.get(session.chatUri) ?? owner.additional,
        connection,
      );
      log(`truncated ${session.chatUri} to ${turnId}`);
      break;
    }
    /*
     * Somebody's half-typed answer, kept for whoever else is looking.
     *
     * The same argument as `chat/draftChanged`: two people on one chat
     * are answering one question, and an answer each client kept to
     * itself would need no host at all. What it is kept *on* is the
     * request this host is already holding open - the protocol calls
     * the result the request's synced answer state, and says a
     * `chat/inputCompleted` may carry no answers because this is where
     * they are. Taken on any chat holding the question, a worker's
     * included, whether or not its backend keeps drafts: the reducer
     * keeps the draft on the request, and the reference host takes it
     * for every agent.
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L355-L356
     */
    case 'chat/inputAnswerChanged': {
      const requestId = String(action.requestId ?? '');
      const questionId = String(action.questionId ?? '');
      // Absent clears that question's draft, which is what the action
      // says `undefined` means and the only way JSON can say it.
      const answer = typeof action.answer === 'object' && action.answer !== null
        ? action.answer as Bag
        : undefined;
      // Checked against the request the chat's held state has open, as an
      // answer is.
      if (!asking(requestId)) {
        no(`${requestId} is not a question this chat is waiting on`);
        break;
      }
      /*
       * A draft or submitted answer whose value is absent, or whose value's
       * kind is missing the payload that kind names, SHOULD be rejected. The
       * kinds are `@nonexhaustive`, so a value of a kind the protocol does
       * not list names no payload to check, and is taken. No VS Code client
       * can tell: its host hands an answer on unchecked, and its clients send
       * what their forms hold.
       * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/chat-channel.md#L356
       * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L583-L650
       */
      if (answer !== undefined && answer.state !== 'skipped') {
        const value = typeof answer.value === 'object' && answer.value !== null ? answer.value as Bag : undefined;
        const fits = value === undefined ? false
          : value.kind === 'text' || value.kind === 'selected' ? typeof value.value === 'string'
            : value.kind === 'number' ? typeof value.value === 'number'
              : value.kind === 'boolean' ? typeof value.value === 'boolean'
                : value.kind === 'selected-many' ? Array.isArray(value.value) && value.value.every((one) => typeof one === 'string')
                  : true;
        if (!fits) {
          no(`The answer to ${questionId} has no ${typeof value?.kind === 'string' ? `${value.kind} ` : ''}value`);
          break;
        }
      }
      // The draft every client is to hold, said, and then handed to a backend that keeps one.
      dispatch(worker ? channel : session.chatUri, action, origin);
      session.setAnswer?.(requestId, questionId, answer);
      break;
    }
    /*
     * Approving a tool call's *result*, which nothing here ever asks for.
     *
     * It belongs to a call completed with `requiresResultConfirmation`,
     * and no call this host builds sets it - the confirmation asked for
     * here is before the tool runs, not after. A client sending one is
     * answering a question nobody put.
     */
    case 'chat/toolCallResultConfirmed':
      no('No tool call here asks for its result to be confirmed');
      break;
    /*
     * What a client's own tool did, said by the client that ran it.
     *
     * The protocol makes the client named in the call's contributor
     * responsible for executing it and dispatching the result, so this
     * is the other half of offering a client's tools to the model at
     * all: the agent is blocked on this call, and this is what unblocks
     * it.
     *
     * The result goes back to the harness, which runs on with it. What every
     * client is told is the client's own action, said before the backend is
     * handed it, and the call is completed once: the completion the harness
     * reports after it is not said, as `dispatch` drops a backend's result
     * for a call the chat holds completed.
     */
    case 'chat/toolCallComplete': {
      const toolCallId = String(action.toolCallId ?? '');
      const clientId = connection.clientId || 'anonymous';
      const result = (typeof action.result === 'object' && action.result !== null
        ? action.result
        : {}) as Bag;
      if (!session.completeToolCall) {
        no('This backend runs no tools on a client\'s behalf');
        break;
      }
      // The client the call names in the chat's held state is the one that
      // may say its result; the protocol has a server refuse anybody else.
      if (clientRunning(toolCallId) !== clientId) {
        no(`${toolCallId} is not a call ${clientId} is running here`);
        break;
      }
      // The blocks go through whole, because a client's tool can answer with
      // an image or a file as readily as a sentence and the backend's harness
      // is the thing that decides which it can take. The joined text is the
      // fallback for one that takes only text, and an error's message is what
      // a failed call actually says.
      const ok = result.success !== false;
      const content = (Array.isArray(result.content) ? result.content : [])
        .map((block) => (typeof block === 'object' && block !== null ? block as Bag : {}))
        .filter((block) => typeof block.type === 'string');
      const text = content
        .filter((block) => typeof block.text === 'string')
        .map((block) => String(block.text))
        .join('\n');
      const wrong = typeof result.error === 'object' && result.error !== null
        ? String((result.error as Bag).message ?? '')
        : '';
      /*
       * Said as the client sent it, and then handed to the backend: the call is
       * complete in every client's state with the result its client gave, in
       * the turn the action names, and what the harness says of the call after
       * reduces to nothing. The reference host says a client's action when it
       * takes it and runs the side effect after, and the protocol's reducer
       * completes a call only in the turn the action names.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13654-L13679
       * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-chat/reducer.ts#L274-L283
       */
      dispatch(channel, action, origin);
      if (!session.completeToolCall(toolCallId, clientId, {
        ok,
        text: ok ? text : (wrong || text || 'The tool failed'),
        content: content as ClientCallAnswer['content'],
      })) log(`${session.chatUri}: the backend holds no call ${toolCallId} of ${clientId}'s to complete`);
      break;
    }
    /*
     * Streaming into a call while it runs, which is a *contributor's* to
     * do.
     *
     * The protocol has the owning client dispatch this for a tool the
     * client itself provides - the call carries a `ToolCallContributor`
     * with that client's id, and a server should refuse anyone else. Said on
     * the chat the call is in, where the held state takes it as every client
     * does; what a tool is printing as it runs is the running client's to say.
     */
    case 'chat/toolCallContentChanged': {
      const toolCallId = String(action.toolCallId ?? '');
      const clientId = connection.clientId || 'anonymous';
      const owner = clientRunning(toolCallId);
      if (owner === undefined) {
        no(`${toolCallId} is not a call a client is running here`);
        break;
      }
      if (owner !== clientId) {
        no(`${toolCallId} is ${owner}'s call, and its content is ${owner}'s to change`);
        break;
      }
      dispatch(worker ? channel : session.chatUri, action, origin);
      break;
    }
    default:
      no(`${type} is not served yet`);
  }
}
