import { AhpErrorCodes } from '@microsoft/agent-host-protocol';
import { idOf, Status } from '../sessions/catalog.js';
import { localPath } from '../resources/fileuri.js';
import { RpcError } from '../rpc.js';
import { baseOf, chatIdFor, chatOfCanvas, chatUriFor, MARKS, spaceOf } from './channels.js';
import { CLOSING, ENDINGS } from './common.js';
import type { Bag } from '../types/common.js';
import type { Agent } from '../types/agent.js';
import type { Connection } from '../types/host.js';
import type { Session } from '../types/session.js';
import type { StoredChat } from '../types/sessions.js';
import type { WireTurn } from '../types/wire.js';
import type { HostContext } from './context.js';
import type { Turn } from '@microsoft/agent-host-protocol';

/**
 * A live session let go while it is quiet, and brought back when something
 * needs it.
 *
 * A sleeping session is a catalogue row that is not in `sessions`, the same as
 * a session after a daemon restart: its chats, terminals, rule state and
 * automations stay, and only the agent behind it is closed.
 */
export interface Sleep {
  /** Whether a live session has nothing in hand, and so may sleep. */
  quiet(uri: string): boolean;
  /**
   * Let a quiet session's agent go. Answers whether it slept. An archived
   * session gives its tree back as well, once it has stopped.
   */
  sleep(uri: string): Promise<boolean>;
  /**
   * Bring a session that is not live back, resumed in place.
   *
   * Answers the session's name and the chat `chat` names, or its lead chat.
   * Calls for one session that arrive together share one resume. `sender` is
   * the connection that asked, when a client did.
   */
  wake(uri: string, chat?: string, sender?: Connection): Promise<{ uri: string; chat: Session }>;
  /**
   * Keep a session from sleeping until the answer is called. A waker holds it
   * from before its wake until the turn it woke the session for has begun.
   */
  hold(uri: string): () => void;
  /** Settles once every sleep begun has closed its agents and every resume begun has ended. */
  slept(): Promise<void>;
  /** Sleep each session quiet past the timeout, then reconcile the residency. */
  sweep(): void;
  /**
   * Move the session a channel belongs to to the newest end of the
   * residency's recency: when it starts, when a client subscribes to it and
   * when a turn starts in it.
   */
  touch(channel: string): void;
  /**
   * Let resident sessions go: each archived one, and then the least recent
   * while more are resident than `sessionResidencyLimit`.
   */
  reconcile(): void;
  /** One action on a channel, which moves its session's quiet time. */
  stirred(channel: string, action: Bag): void;
  /** Start the sweep's clock. */
  startSleep(): void;
  /** Stop the sweep's clock, for a host that is closing. */
  stopSleep(): void;
}

/** Minutes of quiet before a session sleeps, when `sleepAfterMinutes` is unset. */
const SLEEP_AFTER_MINUTES = 30;
/**
 * Sessions resident at most, when `sessionResidencyLimit` is unset.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L19
 */
const RESIDENCY_LIMIT = 10;
/** How often the sweep runs. */
const SWEEP_MS = 60_000;

/** Actions a client's presence sends, which are not activity in the session. */
const PRESENCE = new Set([
  'session/activeClientSet', 'session/activeClientRemoved', 'session/serverToolsChanged', 'session/customizationsChanged',
]);

/** Tool call states that wait on a person. */
const WAITING_CALL = new Set(['pending-confirmation', 'pending-result-confirmation', 'auth-required']);

export function createSleep(ctx: HostContext): Sleep {
  const {
    options, sessions, byChat, connections, restarting, kept, owners, wheres, moves,
    running, log, activeSessionsChanged, markSummaryDirty, liveRows, dirOf, stopUnwatched, sessionFor, sessionHolding,
    unavailableProvider, restoreSession, nameOf, storedConfig, charged, charge, recordedChats, spawn, keepProvider, dispatch, leadOf,
    heldStates,
  } = ctx;

  const sleepAfterMs = (options.sleepAfterMinutes ?? SLEEP_AFTER_MINUTES) * 60_000;
  const limit = options.sessionResidencyLimit ?? RESIDENCY_LIMIT;
  const now = (): number => (options.now?.() ?? new Date()).getTime();
  const arm = options.timer ?? ((fire, ms): { cancel(): void } => {
    const handle = setTimeout(fire, ms);
    handle.unref?.();
    return { cancel: () => { clearTimeout(handle); } };
  });

  /** The sweep's armed timer, while the clock runs. */
  let timer: { cancel(): void } | undefined;
  /** Sessions whose agents are being closed, by id, so a wake waits for the close. */
  const closing = new Map<string, Promise<void>>();
  /** Resumes in flight, by session id, so two wakers share one. */
  const waking = new Map<string, Promise<{ uri: string; chat: Session }>>();
  /** Holds taken on sessions by wakers, by session id, as a count. */
  const holds = new Map<string, number>();
  /**
   * The sessions resident here, the least recent first: the reference host's
   * recency, where a session is touched as new.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L102-L116
   */
  const recency = new Set<string>();

  /**
   * The session a channel keeps resident: the session itself, or the one its
   * chat, worker chat, changeset or chat's canvas belongs to. A session's
   * annotations keep nothing resident.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L118-L140
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/agentHostSubscriptionService.ts#L42-L62
   */
  const residentOf = (channel: string): string | undefined => {
    if (channel.endsWith(MARKS)) return undefined;
    const base = chatOfCanvas(channel) ?? baseOf(channel);
    return sessionHolding(base) ?? (spaceOf(base) === 'chat' ? sessionFor(base) : base);
  };

  /**
   * The sessions resident here: each one this host runs, and each whose state
   * or a chat's it holds. A session running with nothing said in it yet is a
   * draft, which the reference host neither counts nor touches.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L279-L290
   */
  const residents = (): Set<string> => {
    const found = new Set(sessions.keys());
    for (const [channel, open] of heldStates) {
      if (open.kind === 'session') found.add(channel);
      if (open.kind !== 'chat') continue;
      const session = sessionHolding(channel) ?? sessionFor(channel);
      if (session !== channel) found.add(session);
    }
    for (const [uri, held] of sessions) {
      if ([...held.chats].every(([chat, one]) => one.allTurns().length === 0 && !running(chat))) found.delete(uri);
    }
    return found;
  };

  /** Whether a chat waits on a person: a tool confirmation or an input request. */
  const waitingOnPerson = (chat: Session): boolean => {
    const state = chat.chatState() as Bag;
    const turn = state.activeTurn as Bag | undefined;
    for (const part of (turn?.responseParts ?? []) as Bag[]) {
      if (part.kind === 'toolCall' && WAITING_CALL.has(String((part.toolCall as Bag | undefined)?.status ?? ''))) return true;
      if (part.kind === 'inputRequest' && part.response === undefined) return true;
    }
    return false;
  };

  /**
   * Whether a chat holds a pending message, queued or steering: the host's
   * queue drain holds it in the chat's state, and a sleep would lose it.
   */
  const pending = (chatUri: string): boolean => {
    const state = ctx.stateOf(chatUri);
    return state?.steeringMessage !== undefined || (Array.isArray(state?.queuedMessages) && state.queuedMessages.length > 0);
  };

  /** Whether any connection is subscribed to the session or to a channel that keeps it resident. */
  const watched = (uri: string): boolean => {
    for (const connection of connections) {
      for (const channel of connection.watching) {
        if (channel === uri || residentOf(channel) === uri) return true;
      }
    }
    return false;
  };

  const quiet = (uri: string): boolean => {
    const held = sessions.get(uri);
    const id = idOf(uri);
    if (held === undefined || restarting.has(uri) || closing.has(id) || waking.has(id) || holds.has(id)) return false;
    for (const [chatUri, chat] of held.chats) {
      if (running(chatUri) || pending(chatUri) || waitingOnPerson(chat)) return false;
      if (chat.resumable?.() === false || chat.busy?.() === true) return false;
      // A chat with no conversation yet has nothing to resume by.
      if (chat.agentId() === undefined || chat.allTurns().length === 0) return false;
    }
    return !watched(uri);
  };

  /** Whether a session is archived, which sleeps it without waiting out the timeout. */
  const archived = (uri: string): boolean => (kept.flags(idOf(uri)) & Status.IsArchived) !== 0;

  const sleep = async (uri: string): Promise<boolean> => {
    const id = idOf(uri);
    /*
     * An archived session with no agent running here has stopped already, so
     * its tree is given back now rather than at a sleep that will not come.
     * Not while a wake or a close is under way: the one puts the session in
     * the tree, and the other gives the tree back itself once it is done.
     */
    if (!sessions.has(uri) && !restarting.has(uri) && !closing.has(id) && !waking.has(id) && archived(uri)) {
      void ctx.shelve(uri);
      return false;
    }
    if (!quiet(uri)) return false;
    const held = sessions.get(uri);
    if (held === undefined) return false;
    /*
     * The row it is listed by from here, as a listing would have found it.
     * Built before the session leaves `sessions`, from the same live answer the
     * catalogue gave while it ran.
     *
     * The close below is a stop: a sleeping session is woken by its own id,
     * and the wake resumes what the backend was holding rather than making a
     * new one. Disposing here would put the transcript out of its reach.
     */
    const row = liveRows().find((one) => one.resource === uri);
    const stopping: Promise<void>[] = [];
    for (const [chatUri, chat] of held.chats) {
      stopping.push(Promise.resolve(chat.close('stopping')).catch(() => {}));
      byChat.drop(chatUri);
      // A wake starts it under this session, which is the relaunch a moved
      // chat owed.
      ctx.chatRelaunches.delete(chatUri);
    }
    const dir = dirOf(uri);
    sessions.delete(uri);
    // A wake starts the backend on the config the session holds, which is all
    // a relaunch it owed would have taken.
    ctx.relaunches.delete(uri);
    if (row !== undefined) {
      wheres.set(uri, row.workingDirectories);
      moves.set(uri, row.modifiedAt);
      ctx.evictSessionState(row);
    }
    if (dir !== undefined) stopUnwatched(dir);
    log(`slept ${uri}`);
    activeSessionsChanged();
    markSummaryDirty(uri);
    const closed = Promise.all(stopping).then(() => undefined);
    closing.set(id, closed);
    // An archived session gives its tree back once its agents have closed.
    // Queued now, so a wake asked for during the close waits behind it.
    if (archived(uri)) void ctx.shelve(uri, closed);
    await closed;
    if (closing.get(id) === closed) closing.delete(id);
    return true;
  };

  const touch = (channel: string): void => {
    const uri = residentOf(channel);
    if (uri === undefined || !residents().has(uri)) return;
    recency.delete(uri);
    recency.add(uri);
  };

  /**
   * Let a resident session go where nothing holds it: its agent, where this
   * host runs it, and the state this host holds of it. Never one a client
   * watches, one with a turn running, or one a waker is bringing back.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L346-L361
   */
  const release = (uri: string): boolean => {
    const id = idOf(uri);
    if (sessions.has(uri)) {
      if (!quiet(uri)) return false;
      void sleep(uri);
    } else {
      if (watched(uri) || waking.has(id) || holds.has(id)) return false;
      for (const [channel, open] of heldStates) {
        const turn = open.state.activeTurn;
        if (open.kind === 'chat' && sessionFor(channel) === uri && typeof turn === 'object' && turn !== null) return false;
      }
    }
    ctx.letStateGo(uri);
    recency.delete(uri);
    return true;
  };

  /**
   * The reference host's reconcile: each archived session, and then the
   * residents oldest first while more are resident than the limit, each let
   * go where nothing holds it.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L292-L344
   */
  const reconcile = (): void => {
    if (ctx.closed) return;
    const resident = residents();
    for (const uri of [...recency]) if (!resident.has(uri)) recency.delete(uri);
    let count = recency.size;
    for (const uri of new Set([...[...resident].filter(archived), ...recency])) {
      if (!archived(uri) && (limit <= 0 || count <= limit)) break;
      const counted = recency.has(uri);
      if (release(uri) && counted) count -= 1;
    }
  };

  const sweep = (): void => {
    const at = now();
    for (const [uri, held] of sessions) {
      if (sleepAfterMs > 0 && at - held.quietSince >= sleepAfterMs && quiet(uri)) void sleep(uri);
    }
    reconcile();
  };

  const stirred = (channel: string, action: Bag): void => {
    const uri = sessions.has(channel) ? channel : sessionHolding(channel);
    const held = uri === undefined ? undefined : sessions.get(uri);
    if (uri === undefined || held === undefined) return;
    const type = String(action.type ?? '');
    if (PRESENCE.has(type)) return;
    held.quietSince = now();
    /*
     * A turn's start makes its session the most recent, and its start and its
     * end move the residency: each after the action is out, so the turn is
     * the one `quiet` and `touch` read.
     * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSessionResidency.ts#L84-L89
     */
    if (type === 'chat/turnStarted') queueMicrotask(() => { touch(uri); sweep(); });
    else if (ENDINGS.has(type)) queueMicrotask(reconcile);
  };

  const rearm = (): void => {
    timer = arm(() => {
      timer = undefined;
      if (ctx.closed) return;
      sweep();
      rearm();
    }, SWEEP_MS);
  };

  const startSleep = (): void => {
    if (timer !== undefined || (sleepAfterMs <= 0 && limit <= 0)) return;
    rearm();
  };

  const stopSleep = (): void => {
    timer?.cancel();
    timer = undefined;
  };

  /**
   * The resume itself: the session's own chats started again from what the
   * store recorded, each resumed as its own conversation.
   */
  const resume = async (asked: string, chat: string | undefined, sender: Connection | undefined): Promise<{ uri: string; chat: Session }> => {
    const id = idOf(asked);
    await closing.get(id);
    /*
     * The agent this session was recorded for, before a transcript is read or
     * a record rewritten: a session whose agent this host is not serving, or
     * that no agent here can open, is refused as the reference host's restore
     * refuses a session it finds no agent for, and keeps its own provider
     * until that agent is loaded again.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L14103-L14108
     */
    const missing = unavailableProvider(id);
    if (missing !== undefined) throw new RpcError(AhpErrorCodes.SessionNotFound, `No agent for session: ${asked}`);
    const seed = await restoreSession(id);
    if (!seed) throw new RpcError(AhpErrorCodes.SessionNotFound, `No agent for session: ${asked}`);
    /*
     * Named again, because `restoreSession` is what learned whose session this is - and
     * what this host will call it. Asking with the name computed beforehand
     * found nothing for a row no listing had reached yet. The session wakes
     * under that one name, and a waker that asked under any other spelling of
     * the id is refused, as a subscribe to it is.
     * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentService.ts#L14083
     */
    const named = nameOf(id);
    if (named !== asked) throw new RpcError(AhpErrorCodes.SessionNotFound, `No agent for session: ${asked}`);
    const live = sessions.get(named);
    if (live !== undefined) return { uri: named, chat: picked(named, chat) as Session };
    const owner = owners.get(named);
    if (!owner) throw new RpcError(AhpErrorCodes.SessionNotFound, `No agent for session: ${asked}`);
    // Back where it ran. A session continued in another directory is a
    // conversation whose second half cannot see the files its first half was
    // about.
    const first = wheres.get(named)?.[0];
    const ran = first === undefined ? undefined : localPath(first);
    // Where its chats' transcripts are looked for: the folder its record
    // names, or else the one its row was listed in.
    const at = ctx.launchWorkingDirectory(id) ?? (ran === undefined ? undefined : { workingDirectory: ran });
    /*
     * What the work is charged to: the one this session was settled with, or
     * the one the asking connection resolves to. A session the store holds no
     * charge for is the one case where nobody decided it, and it is settled
     * now, as a new session is.
     */
    const was = kept.scope(id);
    const restored = storedConfig(owner, id);
    if (was === null) charged.set(named, undefined);
    else if (was !== undefined) charged.set(named, { scope: was });
    else charge(named, sender?.principal, typeof restored.scope === 'string' ? restored.scope : undefined);
    /*
     * The chats the store recorded for it, which is which chat it comes back
     * as and which others it comes back with. None for a session inside a
     * machine, as its default chat is not resumed here: what the store has of
     * it is the inner host's.
     */
    const recorded = kept.nested?.(id) === undefined ? recordedChats(id) : [];
    /*
     * The backend that serves each recorded chat, read from the record.
     *
     * A chat opened on a backend of its own is started on that one, with that
     * one's transcript and the config it was opened with; every other chat is
     * the session's, and runs on the session's backend and its config. A
     * backend this host is not serving is one line and a chat left where it
     * is: its conversation belongs to the harness that wrote it, and the
     * session's other chats come back without it rather than around it.
     */
    const served = recorded.flatMap((one): { one: StoredChat; agent: Agent }[] => {
      const agent = one.provider === undefined ? owner : ctx.agents.get(one.provider);
      if (agent !== undefined) return [{ one, agent }];
      log(`${one.uri}: ${one.provider} is not loaded on this host, so the chat is left where it is`);
      return [];
    });
    const lead = served.find(({ one }) => one.default === true);
    // The chat it starts again as: the store's default where that is not the
    // session's own chat, which is a first chat closed under `hidden`.
    const other = lead === undefined || lead.one.uri === chatUriFor(named) ? undefined : lead;
    const back = other === undefined
      ? undefined
      : await ctx.transcriptOf(other.agent, other.one.backendId, at, named, other.one.uri);
    /*
     * The workers its record names, read before its chats' states open: the
     * lead chat links each from the call that ran it, and the session lists
     * them, from the moment each opens.
     */
    if (owner.subagents !== undefined) await ctx.restoredSubagents(id, owner, seed as unknown as WireTurn<Turn>[]);
    // A host that closed while this resume read its record starts no agent.
    if (ctx.closed) throw new Error(CLOSING);
    /*
     * The session is the owner's, whatever chat it comes back as.
     *
     * A recorded default that is one of another backend - its own chat was
     * deleted and this one took the default - is a chat of the session and not
     * the session, so the `Held` this first start creates is the owner's, and
     * the chat lands on `Held.backends` like every other chat of another
     * backend. Left to the chat, the session would come back as that one's and
     * the provider a client reads would move with it.
     */
    const session = spawn(
      other?.agent ?? owner,
      named,
      lead?.one.uri ?? chatUriFor(named),
      other?.one.backendId ?? chatIdFor(named, chatUriFor(named)),
      other?.one.config ?? restored,
      other === undefined
        ? { resume: lead?.one.backendId ?? id, seed }
        : { resume: other.one.backendId, seed: (back ?? []) as unknown as Bag[] },
      ran,
      undefined,
      undefined,
      sender,
      undefined,
      { agent: owner, config: restored },
    );
    /*
     * Which harness the session is, recorded under the session's own name and
     * the id of the chat it started as. A lead chat on another backend says
     * nothing about the session: its transcript is that backend's, and the
     * session's provider is not written under it.
     */
    if (other === undefined || other.agent === owner) keepProvider(named, owner, session);
    // And every other chat the store recorded for it, each a conversation of
    // its own, resumed the way a chat restarted on its own is.
    for (const { one, agent } of served) {
      if (one.default === true) continue;
      const own = await ctx.transcriptOf(agent, one.backendId, at, named, one.uri);
      if (ctx.closed) throw new Error(CLOSING);
      spawn(
        agent,
        named,
        one.uri,
        one.backendId,
        one.config ?? restored,
        { resume: one.backendId, seed: (own ?? []) as unknown as Bag[] },
        ran,
        undefined,
        undefined,
        sender,
      );
    }
    /*
     * A session that comes back with another chat, a peer or a worker its
     * record names, has its default chat take its own title, as the reference
     * host's restore registers a session's other chats.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1816
     */
    if ((sessions.get(named)?.chats.size ?? 0) > 1 || (ctx.subHistory.get(id)?.length ?? 0) > 0) ctx.snapshotDefaultChatTitle(named);
    /*
     * Ready already, which is how its state is handed out, so nothing says it
     * again, as VS Code's host restores a session without a `session/ready`.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1538-L1548
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1596-L1602
     */
    log(`resumed ${named}`);
    markSummaryDirty(named);
    return { uri: named, chat: picked(named, chat) ?? session };
  };

  /** The chat a waker named, where the session holds it, or the session's lead. */
  const picked = (uri: string, chat: string | undefined): Session | undefined => {
    const asked = chat === undefined ? undefined : byChat.get(chat);
    if (asked !== undefined && asked.uri === uri) return asked.chat;
    const held = sessions.get(uri);
    return held === undefined ? undefined : leadOf(held);
  };

  const wake = (uri: string, chat?: string, sender?: Connection): Promise<{ uri: string; chat: Session }> => {
    const live = sessions.get(uri);
    const lead = live === undefined ? undefined : picked(uri, chat);
    if (lead !== undefined) return Promise.resolve({ uri, chat: lead });
    if (ctx.closed) return Promise.reject(new Error(CLOSING));
    const id = idOf(uri);
    const already = waking.get(id);
    if (already !== undefined) {
      return already.then((woken) => ({ uri: woken.uri, chat: picked(woken.uri, chat) ?? woken.chat }));
    }
    // The tree first, where an archive took it, so the agent starts in it.
    const resumed = ctx.restore(uri).then(() => resume(uri, chat, sender));
    waking.set(id, resumed);
    const clear = (): void => { if (waking.get(id) === resumed) waking.delete(id); };
    resumed.then(clear, clear);
    return resumed;
  };

  const hold = (uri: string): (() => void) => {
    const id = idOf(uri);
    holds.set(id, (holds.get(id) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (holds.get(id) ?? 1) - 1;
      if (left > 0) holds.set(id, left);
      else holds.delete(id);
    };
  };

  const slept = async (): Promise<void> => {
    const settled = (going: Promise<unknown>): Promise<void> => going.then(() => undefined, () => undefined);
    await Promise.all([...closing.values(), ...[...waking.values()].map(settled)]);
  };

  return { quiet, sleep, wake, hold, slept, sweep, touch, reconcile, stirred, startSleep, stopSleep };
}
