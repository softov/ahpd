import { idOf, Status } from '../sessions/catalog.js';
import { localPath } from '../resources/fileuri.js';
import { filesOf, needsWriting, snapshot } from './attachments.js';
import { chatIdFor, chatUriFor, isRootChannel, MARKS, ROOT, toolCallOfSubagentChat, WORKER_ACTIONS } from './channels.js';
import { HOSTS_OWN } from './common.js';
import { autoApproved, requireTrust } from './trust.js';
import type { Bag } from '../types/common.js';
import type { ClientCallAnswer } from '../tools/clientcalls.js';
import type { Origin } from './state.js';
import type { ConnectionContext, HostContext } from './context.js';

/**
 * Set or clear one of a session's own two bits, and say so.
 *
 * A session's `IsRead` and `IsArchived` are this host's rather than a
 * backend's: a harness asked would have no idea whether a person had read a
 * transcript. Three actions reach this - `session/isReadChanged` and
 * `session/isArchivedChanged` on a session channel, and `chat/isArchivedChanged`
 * on the session's default chat, which archives the session because that chat
 * is what the session's row is.
 *
 * A read bit that moved moves its chats with it. A session marked read marks
 * every counted chat read, and a session marked unread with one counted chat
 * marks that chat unread: with one chat there is no other place the unread
 * conversation can be. With several, which one is new is not the session's
 * to say, and each chat keeps its own bit.
 *
 * An archived bit that moved moves the default chat's with it. The protocol
 * makes archiving the default chat the same act as archiving the session, and
 * the chat and the session each carry the bit, so a client of either channel
 * holds it as the other does. A session that is not running names its default
 * chat as its catalogue row does.
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
): boolean {
  const before = ctx.kept.flags(idOf(uri));
  const after = on ? before | bit : before & ~bit;
  if (after === before) return false;
  ctx.kept.setFlags(idOf(uri), after);
  // Every client watching, and the catalogue: a flag one client sets is a flag
  // the others have to see, which is what having a host for this buys over
  // each client keeping its own.
  ctx.dispatch(uri, action);
  ctx.summaryMoved(uri);
  if (bit === Status.IsArchived) {
    const id = idOf(uri);
    const recorded = ctx.kept.nested?.(id) !== undefined ? [] : ctx.recordedChats(id);
    const lead = ctx.sessions.get(uri)?.defaultChat
      ?? recorded.find((one) => one.default === true)?.uri
      ?? chatUriFor(ctx.nameOf(id));
    chatFlag(ctx, uri, lead, Status.IsArchived, on);
  }
  if (bit === Status.IsRead) {
    const counted = countedChats(ctx, uri);
    if (on) for (const chat of counted) chatFlag(ctx, uri, chat, Status.IsRead, true);
    else if (counted.length === 1) chatFlag(ctx, uri, counted[0] as string, Status.IsRead, false);
  }
  if (bit === Status.IsArchived && on) queueMicrotask(() => { void ctx.sleep(uri).catch(() => undefined); });
  // Unarchived: the tree back before anything wakes the session into it, and
  // the session is no longer one the host archived.
  if (bit === Status.IsArchived && !on) {
    ctx.kept.setAutoArchivedAt?.(idOf(uri), undefined);
    void ctx.restore(uri);
  }
  return true;
}

/**
 * The chats whose read bits make up their session's.
 *
 * The open chats the store records for the session, so a session that is not
 * running answers as well as one that is. A worker is left out: it is the
 * harness's work inside another chat's call, and a person reads the chat that
 * called it rather than the worker.
 */
export function countedChats(ctx: HostContext, session: string): string[] {
  return ctx.recordedChats(idOf(session))
    .filter((one) => one.origin?.['kind'] !== 'tool' && toolCallOfSubagentChat(one.uri) === undefined)
    .map((one) => one.uri);
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
 * `action` is what goes out on the chat: a client's own action where a client
 * sent one, and this host's where nobody did.
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
): boolean {
  const before = ctx.kept.chatFlags(idOf(session), chat);
  const after = on ? before | bit : before & ~bit;
  if (after === before) return false;
  ctx.kept.setChatFlags(idOf(session), chat, after);
  ctx.dispatch(chat, action ?? (bit === Status.IsRead
    ? { type: 'chat/isReadChanged', isRead: on }
    : { type: 'chat/isArchivedChanged', isArchived: on }));
  const lead = ctx.byChat.get(chat)?.chat;
  const base = lead !== undefined
    ? lead.status()
    : Number(((ctx.subagents.get(chat)?.state ?? {}) as Bag).status ?? Status.Idle);
  ctx.dispatch(session, { type: 'session/chatUpdated', chat, changes: { status: base | after } });
  ctx.summaryMoved(session);
  return true;
}

/**
 * The session's read bit, brought into step with one chat's.
 *
 * A counted chat that is unread makes a read session unread. A counted chat
 * that is read makes an unread session read once no counted chat is left
 * unread. A chat that is not counted moves nothing.
 */
export function sessionFollows(ctx: HostContext, session: string, chat: string): void {
  const counted = countedChats(ctx, session);
  if (!counted.includes(chat)) return;
  const id = idOf(session);
  const read = (ctx.kept.chatFlags(id, chat) & Status.IsRead) !== 0;
  const sessionRead = (ctx.kept.flags(id) & Status.IsRead) !== 0;
  if (read === sessionRead) return;
  if (read && counted.some((one) => (ctx.kept.chatFlags(id, one) & Status.IsRead) === 0)) return;
  sessionFlag(ctx, session, Status.IsRead, read, { type: 'session/isReadChanged', isRead: read });
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
  const { refuse, echoTo } = ctx;
  const {
    admitted, beginOrRun, beginTurn, beside, byChat, charge, charged, chatAgent, chatConfig, connections,
    contributedDefaults, decided,
    described, dispatch, drafts, fire, kept, known, leadOf, lifeOf, lives, log, messageAttachments,
    messageFrom, modelIn, names, ownerFor, owners, past, pluginsMoved, principalFor, propertyOf, putIn, renameChat,
    restart, restartChat, restarting, rootConfig, served, sessionFor, sessionMachines, sessions, spawn, starting,
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
   * Read and archived are this host's, the way a session's are, and they
   * belong to the chat rather than to the session it sits in: a session is a
   * container for conversations and a person reads one of them without the
   * others.
   *
   * Handled above the worker guard, because a worker chat carries them too.
   * Read-only says nobody types into it; it does not say nobody may file it
   * away. Only a chat of a session this host is running has anywhere to keep
   * one - a chat read back off a disk is a row nothing was recorded for, and
   * the guard below answers for it.
   *
   * A read bit that moves brings the session's into step with it - see
   * `sessionFollows`.
   */
  const bitOf = type === 'chat/isReadChanged' ? Status.IsRead
    : type === 'chat/isArchivedChanged' ? Status.IsArchived
    : undefined;
  const flagSession = bitOf === undefined ? undefined : sessionFor(channel);
  if (bitOf !== undefined && flagSession !== undefined && sessions.has(flagSession)) {
    const on = type === 'chat/isReadChanged' ? action.isRead === true : action.isArchived === true;
    /*
     * Archiving the chat that is the session's row archives the session.
     *
     * A session is a row in a list and its first chat is what that row is, so
     * the protocol makes the two the same act: "Archiving the session's default
     * chat is equivalent to archiving the session"
     * (https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/actions.ts).
     * The chat's archived bit is kept
     * and said as any chat's is, the client's own action going out to every
     * client of the chat, and the session's follows on the session channel as
     * this host's action; a session archived by its own action moves the two
     * bits alike, in `sessionFlag`.
     */
    if (bitOf === Status.IsArchived && sessions.get(flagSession)?.defaultChat === channel) {
      const moved = chatFlag(ctx, flagSession, channel, Status.IsArchived, on, action);
      sessionFlag(ctx, flagSession, Status.IsArchived, on, { type: 'session/isArchivedChanged', isArchived: on });
      // A chat already archived or not as asked is answered to its sender.
      if (!moved) echoTo(connection.peer, channel, action, origin);
      return;
    }
    // Said again, a bit that did not move is not a change: it would move the
    // catalogue and wake every client for a message that said nothing. Its
    // sender is holding it all the same, so it is answered, to it alone.
    if (!chatFlag(ctx, flagSession, channel, bitOf, on, action)) {
      echoTo(connection.peer, channel, action, origin);
      return;
    }
    if (bitOf === Status.IsRead) sessionFollows(ctx, flagSession, channel);
    // A chat filed away is read: nobody is going to come back to it for what
    // is new in it. Taking one back out leaves its read bit as it is.
    else if (on && chatFlag(ctx, flagSession, channel, Status.IsRead, true)) sessionFollows(ctx, flagSession, channel);
    return;
  }
  /*
   * A worker's chat is read-only, whichever side of a restart it is on.
   *
   * Nobody types into a subagent: its conversation is the harness's work
   * inside somebody else's call. What a client may still send on one is
   * an answer to what the worker asked there and a stop, and those are
   * the lead chat's backend's to act on, since that backend runs the
   * worker. Anything else is refused here rather than falling into the
   * resume below, which would start an agent for a chat the client
   * cannot write to anyway.
   */
  const worker = toolCallOfSubagentChat(channel) !== undefined;
  if (worker && !WORKER_ACTIONS.has(type)) {
    refuse(connection.peer, channel, action, origin, `${channel} is a read-only subagent chat`);
    return;
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
   * Writing them is a file's worth of work, so the action waits and this
   * connection's later dispatches wait behind it: a client that sends a
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
      return settledMessage(message, uri).then((settled) => {
        if (!connections.has(connection)) return;
        return conn.applyNow({ ...params, action: { ...action, message: settled } }, origin);
      });
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
   * this connection's later dispatches go behind it in `waiting`.
   */
  const running = restarting.get(sessionFor(channel));
  if (running !== undefined) {
    return conn.bounded(running, `${channel} starting again`).then(
      () => (connections.has(connection) ? conn.applyNow(params, origin) : undefined),
      (error: unknown) => {
        refuse(connection.peer, channel, action, origin, error instanceof Error ? error.message : String(error));
      },
    );
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
      if (Object.keys(taken).length > 0) kept.setConfig(idOf(uri), { ...kept.config(idOf(uri)), ...taken });
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
    // `past` reads the catalogue first, which is what lists it.
    return conn.bounded(past(idOf(sessionFor(channel))), 'reading the catalogue').then((found) => {
      if (!connections.has(connection)) return;
      if (found !== undefined || known()) keep();
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
   * the wake until the turn has been applied. The wait is returned, so this
   * connection's later dispatches go behind it.
   */
  if (!held && type === 'chat/turnStarted') {
    // The session the chat belongs to, which is not the chat's own name:
    // a chat URI carries its session rather than being derived from it.
    const uri = sessionFor(channel);
    const release = hold(uri);
    return conn.bounded(wake(uri, channel, connection), `${channel} waking`).then(
      () => {
        if (!connections.has(connection)) return;
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
   * draft held for a session nobody has is a map that only grows.
   */
  if (!session && type === 'chat/draftChanged') {
    const id = idOf(sessionFor(channel));
    void (async () => {
      const missing = waitingFor(id);
      if (missing !== undefined) {
        refuse(connection.peer, channel, action, origin, `${missing} is not loaded on this host`);
        return;
      }
      if (!(await past(id))) {
        refuse(connection.peer, channel, action, origin, `${channel} is not a session this host knows`);
        return;
      }
      const next = typeof action.draft === 'object' && action.draft !== null
        ? action.draft as Bag
        : undefined;
      // The draft this host holds already moves nothing, and is answered to
      // its sender alone, as a flag that did not move is.
      if (JSON.stringify(next) === JSON.stringify(drafts.get(channel))) {
        echoTo(connection.peer, channel, action, origin);
        return;
      }
      if (next === undefined) drafts.delete(channel);
      else drafts.set(channel, next);
      // Echoed, because the point of a draft being on the wire at all is
      // that the other clients watching this chat see it.
      dispatch(channel, action, origin);
    })();
    return;
  }
  // With its keys, because the useful half of this line is what was in the
  // action nobody read - a type alone says only that a client wanted
  // something.
  const nothing = (): void => {
    const carried = Object.keys(action).filter((key) => key !== 'type');
    no(`${type} names nothing here${carried.length > 0 ? ` (${carried.join(', ')})` : ''}`);
  };
  /*
   * Any other action on a session asleep in the catalogue.
   *
   * Woken for it, and the action applied again to the session that is live,
   * the same way an action waits for a session being started again. A config
   * change and a draft are kept above without a wake. The wait is returned, so
   * this connection's later dispatches go behind it.
   */
  if (!session && !worker && !sessions.has(sessionFor(channel)) && owners.has(sessionFor(channel))) {
    const uri = sessionFor(channel);
    const release = hold(uri);
    return conn.bounded(wake(uri, channel, connection), `${channel} waking`).then(
      () => {
        if (!connections.has(connection)) return;
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
  /*
   * A session whose agent has gone for good refuses everything that follows
   * with the sentence it ended with, a draft included, since nothing will
   * read it.
   */
  const over = session.ended?.();
  if (over !== undefined) {
    refuse(connection.peer, channel, action, origin, over);
    return;
  }
  switch (type) {
    case 'chat/turnStarted': {
      const message = (typeof action.message === 'object' && action.message !== null
        ? action.message
        : {}) as Record<string, unknown>;
      const text = String(message.text ?? '');
      const turnId = String(action.turnId ?? '');
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
      // A chat attachment this host cannot hand over refuses the message the
      // same way a backend that would not start does, and before anything is
      // started: a turn whose agent never saw the chat it was pointed at is a
      // turn the person has to be told about.
      const attached = messageAttachments(message, connection);
      if (attached.refusal !== undefined) {
        refuse(connection.peer, channel, action, origin, attached.refusal);
        break;
      }
      // Said back by the backend, now or once it is ready to begin.
      ctx.owe('chat/turnStarted', turnId);
      beginTurn(
        beginOrRun(live, provider, turnId, text, modelIn(message.model), messageFrom(message), connection, undefined, attached.attachments),
        (why) => refuse(connection.peer, channel, action, origin, why),
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
     * reads it (`sessionTitleContribution.ts`); on the session channel
     * it names the session, which is its default chat. Blank is a
     * refusal, not a blank title: a row nobody can find again is the
     * thing the derived title exists to prevent.
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
      renameChat(uri, byChat.has(channel) ? channel : owner.defaultChat, title);
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
     * that stops halfway. An action that changes nothing is answered to its
     * sender alone, and one that names no folder is refused.
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
        echoTo(connection.peer, channel, action, origin);
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
            await requireTrust({ folder: entering, sender: connection, autoApproved: auto });
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
       * `sessionMutable: false` is the schema saying this value is read
       * when the backend starts - the computer a session runs in, and
       * Claude's thinking - so a new value before the first turn is the
       * session being created differently, exactly as `isolation` is.
       * Only a key that moved, for the same reason `ours` is filtered.
       */
      const fixed = owning === undefined ? [] : Object.entries(config)
        .filter(([key]) => !HOSTS_OWN.includes(key))
        .filter(([key]) => propertyOf(owning.agent, key)?.sessionMutable === false)
        .filter(([key, value]) => value !== before.get(key));
      /*
       * One restart for both kinds of fixed key, because two keys in
       * one action are one decision - and a restart is a backend start.
       */
      const moved = [...ours, ...fixed];
      if ((moved.length > 0 || rescoped.length > 0) && owning !== undefined) {
        /*
         * A value of the wrong shape for its key, which is a different
         * thing from a value that is fixed. The two pattern keys take a
         * list; `isolation`, the branch and the three branch rows take a
         * string, and a list sent for one of those is a mistake worth
         * saying so about.
         */
        const listOf = (key: string): boolean => key === 'worktreeIncludeFiles' || key === 'worktreeSymlinkFolders';
        const bad = [...ours, ...rescoped].find(([key, value]) => typeof value !== 'string'
          && !(listOf(key) && Array.isArray(value) && value.every((one) => typeof one === 'string')));
        const started = [...owning.chats.values()].some((chat) => chat.allTurns().length > 0);
        if (bad !== undefined) {
          for (const [key] of moved) undo(key);
          for (const [key] of rescoped) undo(key);
          no(`${bad[0]} takes ${listOf(bad[0]) ? 'a list of patterns' : 'a string'}`);
        }
        else if (started) {
          for (const [key] of moved) undo(key);
          for (const [key] of rescoped) undo(key);
          no(`${moved[0]?.[0] ?? rescoped[0]?.[0]} is fixed once the session has started`);
        }
        else {
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
           * What it was charged to is held, because a refusal below puts
           * it back: the action is one decision, and a decision that was
           * not taken leaves nothing of itself behind.
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
          const uri = session.uri;
          /** What the clients are told, once the decision is in force. */
          const tell = (): void => {
            for (const [key, value] of [...moved, ...rescoped]) {
              /*
               * The value the session actually has, when the restart
               * changed it. A source is made into a machine on the way
               * in, so a client told the source back would hold a value
               * the session is not running with. This host's own keys
               * are not in the backend's config, so they stay as they
               * were sent.
               */
              const answered = owning.config[key] ?? value;
              if (!HOSTS_OWN.includes(key)) remember(key, answered);
              dispatch(uri, { type: 'session/configChanged', config: { [key]: answered } }, origin);
            }
          };
          if (moved.length === 0) tell();
          else {
            /*
             * The restart, held while it runs.
             *
             * A turn can arrive in the window between the whole config
             * being pushed and the backend being ready - VS Code sends
             * both back to back - so `applyDispatch` waits on this
             * promise before it touches the session. It is cleared before
             * the promise settles to its consumers, so an action that
             * waited re-runs against the backend that is actually there.
             *
             * Whether this session may move to the machine it is being
             * moved to is asked here, where the keys are still theirs and
             * the backend is still the one it was - not inside `restart`,
             * which is past the point of undoing anything. It is the same
             * `admitted` a client's `createSession` asks, against the
             * person who owns the work and the scope it is being charged
             * to.
             *
             * A refusal undoes the whole action rather than half of it: the
             * keys, the row this host decides from, and the charge the
             * scope moved onto. Nothing is announced either - the change
             * never happened, so a `configChanged` would tell every other
             * subscriber about a setting the session does not have, and a
             * key written to the store would be what a resume starts the
             * lead chat with. The session stays exactly where it was.
             */
            const work = (async () => {
              const wrong = await admitted(person, charged.get(uri)?.scope, owning.config, owning.agent.provider, session.uri, owner);
              if (wrong !== undefined) {
                for (const [key] of moved) undo(key);
                for (const [key] of rescoped) undo(key);
                decided.set(session.uri, settled);
                if (rescoped.length > 0) {
                  if (wasCharged === undefined) charged.delete(uri);
                  else charged.set(uri, wasCharged);
                  kept.setScope(idOf(uri), wasScope);
                }
                no(wrong);
                return false;
              }
              await restart(uri, conn.tokensFor(owning.agent.provider), undefined, connection, undefined, conn.tokensFor);
              return true;
            })();
            // The promise a close waits on, which is not the work's own: a refusal is
            // answered to the client below, and a promise nobody reads must
            // not carry the rejection a second time.
            restarting.set(uri, work.then(() => undefined, () => undefined));
            const held = restarting.get(uri);
            const clear = (): void => {
              if (restarting.get(uri) === held) restarting.delete(uri);
            };
            void work.then(
              (restarted) => {
                clear();
                // Announced only where the restart happened. A refusal is
                // the action refused and nothing more.
                if (restarted) tell();
              },
              (error: unknown) => {
                clear();
                lives.delete(uri);
                no(error instanceof Error ? error.message : String(error));
              },
            );
          }
        }
      }
      for (const [key, value] of Object.entries(config)) {
        // Answered above, and not the backend's to hear about.
        if (HOSTS_OWN.includes(key)) continue;
        /*
         * What the schema says about this key, rather than what this
         * file used to know about four of them.
         *
         * `host.ts` imports no backend and is meant not to know one
         * exists, and it held the names `permissionMode`, `model`,
         * `effortLevel` and `outputStyle` and refused `thinking` by
         * name. Every one of those is a property of whatever schema the
         * backend published, and the two things this layer actually
         * needs to know are declared there: whether the key can move on
         * a running session, and whether it belongs to the session or
         * to one chat in it.
         */
        const property = propertyOf(owning?.agent, key);
        /*
         * Absent is not a refusal.
         *
         * `autoApprove` and `mode` are conventional names a client
         * sends whatever a host advertises, and this backend takes both
         * without declaring either - so the schema decides how a key
         * behaves and the backend decides whether it is taken at all.
         */
        /*
         * Immutable, and said so rather than accepted and dropped: a
         * control that reports success and changes nothing is worse
         * than one that refuses.
         *
         * Taken above when it moved before the first turn - the session
         * was started again with it - and a value that did not move is
         * not a change at all: a client re-sending the value it was
         * given is agreeing with this host rather than asking for
         * anything.
         */
        if (property?.sessionMutable === false) {
          if (fixed.some(([held]) => held === key)) continue;
          if (value === before.get(key)) continue;
          undo(key);
          no(`${key} is fixed once the session has started`);
          continue;
        }
        if (session.setConfig === undefined) {
          undo(key);
          no(`${key} is not a config key this backend takes`);
          continue;
        }
        /*
         * Every chat, or only this one, as the property says.
         *
         * A permission mode and an output style are the session's: the
         * chats are peers on one config, and a voice set on one of them
         * is a session where two conversations answer differently. A
         * model is the chat's. Neither is a fact about this host.
         *
         * A chat of another backend is not one of the peers here: a key
         * this session's backend takes is a key another may not, so it is
         * left to the chat's own config rather than pushed at it.
         */
        const everywhere = property?.scope === 'chat'
          ? []
          : (owning ? [...owning.chats].filter(([uri]) => !owning.backends.has(uri)).map(([, chat]) => chat) : [])
            .filter((chat) => chat !== session);
        for (const chat of everywhere) void Promise.resolve(chat.setConfig?.(key, value));
        void Promise.resolve(session.setConfig(key, value)).then((answer) => {
          // The backend's own words when it refused, because only it
          // knows whether the key or the value was the problem.
          if (answer === true) {
            remember(key, value);
            dispatch(session.uri, { type: 'session/configChanged', config: { [key]: value } }, origin);
          }
          else {
            undo(key);
            no(answer);
          }
        });
      }
      break;
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
       * does not hold to take out, changes nothing, and the client that sent
       * it is answered alone.
       * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/actions.ts
       */
      if (type === 'chat/workingDirectorySet') {
        if (!own.includes(one)) {
          no(`${one} is not a working directory of ${owner.uri}`);
          break;
        }
        if (one === held.workingDirectory || had.includes(one)) {
          echoTo(connection.peer, channel, action, origin);
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
          echoTo(connection.peer, channel, action, origin);
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
      if (session.resume === undefined) {
        no('this backend cannot run a turn again');
        break;
      }
      /*
       * The protocol's conditions, checked here rather than left to a backend
       * that may not: the latest turn, in error, whose last part is a
       * resumable error. Asking anyway turns a client's mistake into the
       * backend's, and a backend that reopens a turn it should not takes a
       * prompt out of the transcript for nothing.
       */
      const named = String(action.turnId ?? '');
      const turns = (session.chatState() as { turns?: Bag[] }).turns ?? [];
      const last = turns.at(-1);
      if (last === undefined || String(last.id ?? '') !== named) {
        no(`${named} is not the latest turn`);
        break;
      }
      const part = (last.responseParts as Bag[] | undefined)?.at(-1) ?? {};
      if (part.kind !== 'error' || part.resumable !== true) {
        no(`${named} did not end with an error that can be resumed`);
        break;
      }
      if (!session.resume(named)) {
        no(`${named} is not a turn that can be resumed`);
      }
      break;
    }
    /*
     * On a worker's chat, that worker, when the backend can stop one;
     * otherwise the lead turn that runs the worker. The action names the
     * worker's own turn, which the backend has no turn under, so the
     * worker is named by the call its chat was opened for.
     */
    case 'chat/turnCancelled': {
      if (!worker) {
        /*
         * A stop that names a turn this chat is not running stops nothing.
         *
         * Read here rather than left to the backend, because the example
         * backends cancel whatever they are running whatever id they were
         * handed - `turnId || turn.id` in both - and a client stopping a turn
         * it had already finished would end somebody else's.
         *
         * A stop that names nothing is not one of those. A client with no id
         * to give means the running turn, and there is nothing for a name to
         * disagree with.
         *
         * Where nothing stops, the client applied the action all the same and
         * is holding it, so it is answered rather than dropped: an echo to
         * that client alone, since nothing here changed for anybody else.
         */
        const named = String(action.turnId ?? '');
        const current = (session.chatState() as { activeTurn?: { id?: unknown } }).activeTurn;
        if (current === undefined || (named !== '' && String(current.id ?? '') !== named)) {
          echoTo(connection.peer, channel, action, origin);
          break;
        }
        // Said back by the backend once the turn has let go, under the turn
        // it stopped whether or not the client named it.
        ctx.owe('chat/turnCancelled', String(current.id ?? ''));
        session.cancel(named);
        break;
      }
      const call = toolCallOfSubagentChat(channel);
      if (session.stopWorker !== undefined && call !== undefined) {
        session.stopWorker(call);
        break;
      }
      const current = (session.chatState() as { activeTurn?: { id?: unknown } }).activeTurn;
      if (current === undefined) {
        no(`Nothing is running on ${session.chatUri} to stop`);
        break;
      }
      ctx.owe('chat/turnCancelled', String(current.id ?? ''));
      session.cancel(String(current.id ?? ''));
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
      const message = (typeof action.message === 'object' && action.message !== null
        ? action.message
        : {}) as Record<string, unknown>;
      /*
       * Into the running turn, rather than behind it.
       *
       * Somebody correcting an agent halfway is the most ordinary thing
       * there is, and queueing it delivered the correction after the
       * thing it was trying to stop. The two refusals left are real: a
       * backend that cannot take a message mid-turn, and a chat with
       * nothing running to steer.
       */
      if (kind === 'steering') {
        if (!session.steer) {
          no('This backend cannot take a message mid-turn');
          break;
        }
        const steered = messageAttachments(message, connection);
        if (steered.refusal !== undefined) {
          refuse(connection.peer, channel, action, origin, steered.refusal);
          break;
        }
        if (!session.steer(String(action.id ?? ''), String(message.text ?? ''), steered.attachments, messageFrom(message))) {
          no('Nothing is running in this chat to steer');
        }
        break;
      }
      if (kind !== 'queued') {
        no(`${kind} is neither a steering message nor a queued one`);
        break;
      }
      const model = (typeof message.model === 'object' && message.model !== null
        ? message.model
        : {}) as Record<string, unknown>;
      const provider = sessions.get(session.uri)?.agent.provider ?? 'This provider';
      // Read now rather than when the turn comes round: a message waiting
      // behind another is still a message this host has to be able to answer
      // for, and the chat it points at may be gone by the time it runs.
      const queued = messageAttachments(message, connection);
      if (queued.refusal !== undefined) {
        refuse(connection.peer, channel, action, origin, queued.refusal);
        break;
      }
      // Said back by the backend, now or once the turn's check has answered.
      ctx.owe('chat/pendingMessageSet', String(action.id ?? ''));
      beginTurn(
        beginOrRun(
          session,
          provider,
          crypto.randomUUID(),
          String(message.text ?? ''),
          modelIn(model),
          messageFrom(message),
          connection,
          String(action.id ?? ''),
          queued.attachments,
        ),
        (why) => refuse(connection.peer, channel, action, origin, why),
      );
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
      const toggled = ctx.toggleClientPlugin(session.uri, id,
        store === undefined || lasting ? enablement : [{ kind: 'session', enabled: asked }]);
      if (toggled !== undefined) {
        /*
         * The backend is offered the switch and its answer is dropped.
         *
         * A backend with no live switch does not undo it: the decision is this
         * host's, and the next send starts the chat again without that server.
         * Refusing here would put the switch back where the client had just
         * moved it, over a change that does take effect.
         */
        if (toggled.server !== undefined)
          void session.setCustomizationEnabled(id, onFor(session.uri, asked));
        break;
      }
      const on = onFor(session.uri, asked);
      void session.setCustomizationEnabled(id, on).then((took) => {
        /*
         * What the backend took is this host's to keep.
         *
         * A backend says whether a switch can be made and not what it decided:
         * it goes on reporting the customization as it found it, or reports
         * nothing about one it has stopped loading. So the decision is kept
         * here, by id, and the list below is what reads it back.
         */
        if (took)
          ctx.keepDecision(session.uri, id, on);
        else
          no(`${id} has no runtime switch`);
        /*
         * And the list either way, said rather than swallowed. The
         * customization list is what a client draws the switch from: with the
         * decision kept it stands where the client put it, and without one it
         * goes back where it was rather than showing a change that did not
         * happen. The refusal beside it is what tells the client that asked
         * why it moved back.
         */
        dispatch(session.uri, { type: 'session/customizationsChanged', customizations: session.customizations() });
      });
      break;
    }
    case 'session/mcpServerStartRequested':
      void session.startMcpServer(String(action.id ?? '')).then((took) => {
        if (!took) no(`${String(action.id ?? '')} would not start`);
      });
      break;
    case 'session/mcpServerStopRequested':
      void session.stopMcpServer(String(action.id ?? '')).then((took) => {
        if (!took) no(`${String(action.id ?? '')} would not stop`);
      });
      break;
    /*
     * A startup a client asked to stop waiting on.
     *
     * Handed to the backend, which is the only thing that knows how to stop
     * holding a turn on a server. A backend that takes it answers by emitting:
     * the action, and the state that follows.
     *
     * Where no backend takes it, the server keeps the state it has. On a
     * server starting with `blocking: true` the protocol's reducer clears the
     * flag, so the request goes out to every client of the session and the
     * server's state follows it, which is how the protocol has a host decline
     * one: the host "MAY restore `blocking: true` via
     * `session/mcpServerStateChanged` to reject the request"
     * (https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/mcp.md).
     * On any other server the reducer changes nothing, and the request is
     * answered to its sender.
     */
    case 'session/mcpServerBackgroundRequested': {
      const id = String(action.id ?? '');
      const declined = (): void => {
        const state = session.customizations()
          .find((one) => (one as Bag).type === 'mcpServer' && (one as Bag).id === id)?.state as Bag | undefined;
        if (state?.kind !== 'starting' || state.blocking !== true) {
          echoTo(connection.peer, channel, action, origin);
          return;
        }
        dispatch(channel, action, origin);
        dispatch(channel, { type: 'session/mcpServerStateChanged', id, state });
      };
      if (session.backgroundMcpServerStartup === undefined) declined();
      else {
        void session.backgroundMcpServerStartup(id).then((took) => {
          if (!took) declined();
        });
      }
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
       * The draft the chat holds already moves nothing, and is answered to
       * its sender alone, as a flag that did not move is. Read from the
       * chat's own state, which is what every client was told it holds; a
       * client that never synced a draft clears it once its message is sent.
       */
      if (JSON.stringify(next) === JSON.stringify((session.chatState() as Bag).draft)) {
        echoTo(connection.peer, channel, action, origin);
        break;
      }
      session.setDraft(next);
      break;
    }
    case 'chat/pendingMessageRemoved': {
      const id = String(action.id ?? '');
      const kind = action.kind === 'steering' ? 'steering' : 'queued';
      /*
       * A removal of a message this chat does not hold SHOULD be rejected (the
       * protocol's `chat/pendingMessageRemoved`), matched on its id and on its
       * kind, an absent kind being `queued`. Read from the chat's own state,
       * which is what every client was told it holds.
       */
      const state = session.chatState() as Bag;
      const held = kind === 'steering'
        ? (state.steeringMessage as Bag | undefined)?.id === id
        : Array.isArray(state.queuedMessages) && state.queuedMessages.some((one) => (one as Bag | undefined)?.id === id);
      if (!held) {
        no(`${id} is not a ${kind} message this chat holds`);
        break;
      }
      session.unqueue(id);
      // A queued message taken back never becomes a turn to let its sender go.
      if (action.kind === 'queued') ctx.forgetSender(id);
      break;
    }
    case 'chat/queuedMessagesReordered':
      session.reorder(Array.isArray(action.order)
        ? action.order.filter((id): id is string => typeof id === 'string')
        : []);
      break;
    case 'chat/toolCallConfirmed': {
      const toolCallId = String(action.toolCallId ?? '');
      const confirmed = session.confirm(
        toolCallId,
        action.approved === true,
        typeof action.selectedOptionId === 'string' ? action.selectedOptionId : undefined,
      );
      // A confirmation of a call that is not in `pending-confirmation` MUST be
      // rejected (the protocol's chat-channel.md, "Server Validation of Client
      // Actions"), so the client that sent it lets go of a change this host
      // never made.
      if (!confirmed) no(`${toolCallId} is not a call this chat is waiting to have confirmed`);
      break;
    }
    case 'chat/inputCompleted': {
      /*
       * `response`, which is the field the action has.
       *
       * `ChatInputResponseKind` is `accept`, `decline` or `cancel`, and
       * this read `accepted` - a key no client sends - so every answer
       * arrived as an accept and a person declining a question was
       * indistinguishable from one answering it. `accepted` is still
       * honoured for anything that sent it before this, but `response`
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
      const taken = session.answer(requestId, accepted, (typeof action.answers === 'object' && action.answers !== null
        ? action.answers
        : {}) as Record<string, unknown>, kind);
      // An answer to a request this chat is not waiting on SHOULD be rejected
      // (the protocol's chat-channel.md, "Server Validation of Client
      // Actions"). Left unsaid, the client that sent it holds it as a change
      // this host never made, and a client that sends its unechoed actions
      // again after a reconnect sends this one every time.
      if (!taken) {
        no(`${requestId} is not a question this chat is waiting on`);
        break;
      }
      /*
       * Said back to every client of the chat, the answering one included,
       * so each one's `inputRequest` part carries the response now rather
       * than when the agent next moves. On the chat the question is in: a
       * worker's own chat, or the chat this session leads.
       */
      dispatch(worker ? channel : session.chatUri, action, origin);
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
       * seeded with the turns the chat keeps. Only a backend that can delete
       * forgets, so one that cannot is refused.
       * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1141-L1168
       *
       * The backend stops before the delete, because a backend that is still
       * writing writes the conversation back behind it. The action is said
       * once the delete has worked, so a delete that fails refuses an action
       * no client has applied, and the chat comes back on the conversation it
       * had. Held in `restarting` the whole time, so an action sent behind it
       * reaches the new backend rather than the one that stopped.
       */
      const startOver = (kept: Bag[]): void => {
        const owner = sessions.get(session.uri);
        const agent = owner === undefined ? undefined : chatAgent(owner, session.chatUri);
        if (owner === undefined || agent?.delete === undefined) {
          no('This host can drop the turns after one, but not a conversation entire');
          return;
        }
        const uri = session.uri;
        const chatUri = session.chatUri;
        // Read before anything closes, as a closed chat's is.
        const own = session.agentId() ?? ctx.recordedChat(idOf(uri), chatUri)?.backendId;
        const work = (async () => {
          await session.close('stopping');
          const failed = own === undefined || own === '' ? undefined : await ctx.deletedChat(own, agent, ctx.dirOf(uri));
          if (failed === undefined) {
            dispatch(chatUri, action, origin);
            ctx.forgetTurnOutputs(uri, chatUri, all.slice(kept.length) as Bag[]);
            ctx.forgetLocalTurns(uri, chatUri, all.slice(kept.length) as Bag[]);
          }
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
        restarting.set(uri, work.then(() => undefined, () => undefined));
        const held = restarting.get(uri);
        void work.then(
          () => { if (restarting.get(uri) === held) restarting.delete(uri); },
          (error: unknown) => {
            if (restarting.get(uri) === held) restarting.delete(uri);
            no(error instanceof Error ? error.message : String(error));
          },
        );
      };
      // Every turn: the action's `turnId` is optional, and its absence means
      // "clear the whole conversation".
      if (turnId === undefined) {
        startOver([]);
        break;
      }
      const at = all.findIndex((one) => String((one as Bag).id ?? '') === turnId);
      if (at < 0) {
        no(`${turnId} is not a completed turn in ${session.chatUri}`);
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
      // a backend that names only the turns it watched, and a rewind to a
      // point the backend cannot be told is the half of this that would
      // silently not happen.
      const point = session.endPoint?.(concrete);
      const started = session.agentId();
      const owner = sessions.get(session.uri);
      if (point === undefined || started === undefined || owner === undefined) {
        no(`${turnId} is not a turn this host can rewind to`);
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
      dispatch(session.chatUri, action);
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
     * they are.
     */
    case 'chat/inputAnswerChanged': {
      if (!session.setAnswer) {
        no('This backend keeps no draft answers');
        break;
      }
      const requestId = String(action.requestId ?? '');
      const questionId = String(action.questionId ?? '');
      // Absent clears that question's draft, which is what the action
      // says `undefined` means and the only way JSON can say it.
      const answer = typeof action.answer === 'object' && action.answer !== null
        ? action.answer as Bag
        : undefined;
      if (!session.setAnswer(requestId, questionId, answer))
        no(`${requestId} is not a question this chat is waiting on`);
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
     * The result goes back to the harness, the harness writes the tool
     * result, and the session reports the completion to every client from
     * that - the same path every other tool call takes, so the row is drawn
     * finished once, from what actually happened. That completion is the
     * answer to the client that gave the result: owed to it under the call,
     * it goes out with that client's origin.
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
      ctx.owe('chat/toolCallComplete', toolCallId);
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
      if (!session.completeToolCall(toolCallId, clientId, {
        ok,
        text: ok ? text : (wrong || text || 'The tool failed'),
        content: content as ClientCallAnswer['content'],
      })) no(`${toolCallId} is not a call ${clientId} is running here`);
      break;
    }
    /*
     * Streaming into a call while it runs, which is a *contributor's* to
     * do.
     *
     * The protocol has the owning client dispatch this for a tool the
     * client itself provides - the call carries a `ToolCallContributor`
     * with that client's id, and a server should refuse anyone else.
     * Relayed rather than reduced: what a tool is printing as it runs is
     * the running client's to say, and this host holds none of it.
     */
    case 'chat/toolCallContentChanged': {
      const toolCallId = String(action.toolCallId ?? '');
      const clientId = connection.clientId || 'anonymous';
      const owner = session.toolCallOwner?.(toolCallId);
      if (owner === undefined) {
        no(`${toolCallId} is not a call a client is running here`);
        break;
      }
      if (owner !== clientId) {
        no(`${toolCallId} is ${owner}'s call, and its content is ${owner}'s to change`);
        break;
      }
      dispatch(session.chatUri, action);
      break;
    }
    default:
      no(`${type} is not served yet`);
  }
}
