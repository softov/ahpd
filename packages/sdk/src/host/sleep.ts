import { idOf, Status } from '../sessions/catalog.js';
import { localPath } from '../resources/fileuri.js';
import { chatIdFor, chatUriFor } from './channels.js';
import { CLOSING } from './common.js';
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
  /** Sleep what is due: quiet past the timeout, archived, or over the count limit. */
  sweep(): void;
  /** One action on a channel, which moves its session's quiet time. */
  stirred(channel: string, action: Bag): void;
  /** Start the sweep's clock. */
  startSleep(): void;
  /** Stop the sweep's clock, for a host that is closing. */
  stopSleep(): void;
}

/** Minutes of quiet before a session sleeps, when `sleepAfterMinutes` is unset. */
const SLEEP_AFTER_MINUTES = 30;
/** Sessions loaded at most, when `sessionResidencyLimit` is unset. */
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
    running, log, activeSessionsMoved, summaryMoved, liveRows, dirOf, stopUnwatched, sessionFor, sessionHolding,
    waitingFor, past, nameOf, storedConfig, charged, charge, recordedChats, spawn, keepProvider, dispatch, leadOf,
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

  /** Whether a chat has a message queued behind its turn. */
  const queued = (chat: Session): boolean => {
    const waiting = (chat.chatState() as Bag).queuedMessages;
    return Array.isArray(waiting) && waiting.length > 0;
  };

  /** Whether any connection is subscribed to the session or to one of its channels. */
  const watched = (uri: string): boolean => {
    for (const connection of connections) {
      for (const channel of connection.watching) {
        if (channel === uri || sessionHolding(channel) === uri || sessionFor(channel) === uri) return true;
      }
    }
    return false;
  };

  const quiet = (uri: string): boolean => {
    const held = sessions.get(uri);
    const id = idOf(uri);
    if (held === undefined || restarting.has(uri) || closing.has(id) || waking.has(id) || holds.has(id)) return false;
    for (const [chatUri, chat] of held.chats) {
      if (running(chatUri) || queued(chat) || waitingOnPerson(chat)) return false;
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
    }
    const dir = dirOf(uri);
    sessions.delete(uri);
    // Asleep and still open: counted as one this host holds, and its state
    // kept for whoever is watching it.
    ctx.asleep.add(uri);
    ctx.statesUnwatched(uri);
    if (row !== undefined) {
      wheres.set(uri, row.workingDirectories);
      moves.set(uri, row.modifiedAt);
      ctx.keepRow(row);
    }
    if (dir !== undefined) stopUnwatched(dir);
    log(`slept ${uri}`);
    activeSessionsMoved();
    summaryMoved(uri);
    const closed = Promise.all(stopping).then(() => undefined);
    closing.set(id, closed);
    // An archived session gives its tree back once its agents have closed.
    // Queued now, so a wake asked for during the close waits behind it.
    if (archived(uri)) void ctx.shelve(uri, closed);
    await closed;
    if (closing.get(id) === closed) closing.delete(id);
    return true;
  };

  const sweep = (): void => {
    const at = now();
    const asleep = new Set<string>();
    for (const [uri, held] of sessions) {
      const due = archived(uri) || (sleepAfterMs > 0 && at - held.quietSince >= sleepAfterMs);
      if (due && quiet(uri)) {
        asleep.add(uri);
        void sleep(uri);
      }
    }
    if (limit <= 0) return;
    let loaded = sessions.size;
    if (loaded <= limit) return;
    // The least recently used first: the oldest turn start.
    const order = [...sessions].sort(([, a], [, b]) => a.turnedAt - b.turnedAt);
    for (const [uri] of order) {
      if (loaded <= limit) return;
      if (asleep.has(uri) || !quiet(uri)) continue;
      loaded -= 1;
      void sleep(uri);
    }
  };

  const stirred = (channel: string, action: Bag): void => {
    const uri = sessions.has(channel) ? channel : sessionHolding(channel);
    const held = uri === undefined ? undefined : sessions.get(uri);
    if (held === undefined) return;
    const type = String(action.type ?? '');
    if (PRESENCE.has(type)) return;
    const at = now();
    held.quietSince = at;
    if (type !== 'chat/turnStarted') return;
    held.turnedAt = at;
    // After the action is out, so the turn it starts is the one `quiet` reads.
    queueMicrotask(sweep);
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
     * a record rewritten: a host that is not serving it says so by name, and
     * the session keeps its own provider until it is loaded again rather than
     * becoming a conversation on this one.
     */
    const missing = waitingFor(id);
    if (missing !== undefined) throw new Error(`${missing} is not loaded on this host`);
    const seed = await past(id);
    if (!seed) throw new Error(`${chat ?? asked} is not a session this host knows`);
    /*
     * Named again, because `past` is what learned whose session this is - and
     * what this host will call it. Asking with the name computed beforehand
     * found nothing for a row no listing had reached yet.
     */
    const named = nameOf(id);
    const live = sessions.get(named);
    if (live !== undefined) return { uri: named, chat: picked(named, chat) as Session };
    const owner = owners.get(named);
    if (!owner) throw new Error(`No backend owns ${chat ?? asked}`);
    // Back where it ran. A session continued in another directory is a
    // conversation whose second half cannot see the files its first half was
    // about.
    const first = wheres.get(named)?.[0];
    const ran = first === undefined ? undefined : localPath(first);
    // Where its chats' transcripts are looked for: the folder its record
    // names, or else the one its row was listed in.
    const at = ctx.sessionAt(id) ?? (ran === undefined ? undefined : { workingDirectory: ran });
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
    log(`resumed ${named}`);
    dispatch(named, { type: 'session/ready' });
    summaryMoved(named);
    activeSessionsMoved();
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

  return { quiet, sleep, wake, hold, slept, sweep, stirred, startSleep, stopSleep };
}
