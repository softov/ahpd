import { createHash } from 'node:crypto';
import { idOf } from '../catalog.js';
import type { Bag } from '../types/common.js';
import type { SessionAbout, SessionEvent, SessionEventKind, SessionTurn } from '../types/triggers.js';
import type { HostContext } from './context.js';

/**
 * What a session does, as one stream anything outside a session may read.
 *
 * The host's dispatch is the only place every chat action passes through - a
 * client's and a backend's alike - so this reads there, and what it holds is
 * what the protocol's actions do not: which session a chat belongs to, where
 * it works, whether a run started it, what the turn that just ended had been
 * doing, and how many messages wait behind it. A rule about sessions is
 * written against that, and none of it is on the wire.
 *
 * A hash rather than the input of a tool call, for the reason the type says:
 * a rule asks whether two calls are the same call, and holding every tool
 * input of every session to answer that is a daemon holding its own
 * transcripts.
 */
export interface SessionEvents {
  /** Fold one action dispatched on a channel into the stream. */
  observe(channel: string, action: Bag): void;
  /** A session this host was running ended, so the session that started it is told. */
  ended(uri: string): void;
  /** A chat is gone: nothing this stream was holding for it can happen now. */
  forget(chat: string): void;
  /** Read every event as it arrives. The answer stops reading. */
  watch(read: (event: SessionEvent) => void): () => void;
  /**
   * Read every turn as it starts. The answer stops reading.
   *
   * A turn of the session's own chat and not of a worker's: a worker's turn is
   * the session doing something, and the turn a rule about a session's length
   * means is the one the session is answering with.
   */
  turns(read: (turn: SessionTurn) => void): () => void;
  /**
   * Read the session of every chat that moves without an event of its own. The
   * answer stops reading.
   *
   * A turn's words stream as deltas and a tool call begins, takes its input and
   * streams a message of its own - none of which is an event a rule may be
   * written on, and all of which is a session that is working. That is what a
   * rule about a session that has gone quiet has to know, or a turn streaming an
   * answer for an hour reads as one that has said nothing all along.
   */
  moved(read: (session: string) => void): () => void;
}

/** A hash of what a tool was called with, in the spelling the users file already uses. */
const hashOf = (input: string): string => `sha256:${createHash('sha256').update(input, 'utf8').digest('hex')}`;

/**
 * The actions that say a session is doing something, and are not events.
 *
 * A turn's words arrive as deltas, and a tool call begins, takes its input and
 * streams a message of its own. None of those is a `SessionEvent` - there is no
 * kind for a word, and a call is one thing rather than three - and every one of
 * them is a session that is working rather than one that has gone quiet.
 *
 * The result of a call is not here: that is `chat/toolCallComplete`, which is an
 * event a rule may be written on and is counted as it is read.
 */
const MOVES = new Set([
  'chat/delta', 'chat/reasoning', 'chat/toolCallStart', 'chat/toolCallReady', 'chat/toolCallDelta',
]);

/** The input of a call, which the protocol carries inline or by reference. */
const inputOf = (toolInput: unknown): string => {
  if (typeof toolInput === 'string') return toolInput;
  if (toolInput === undefined || toolInput === null) return '';
  return JSON.stringify(toolInput);
};

/** The key one call is held under while it runs: its chat and its id. */
const aboutCall = (chat: string, toolCallId: string): string => `${chat}\u0000${toolCallId}`;

export function createSessionEvents(ctx: HostContext): SessionEvents {
  const { byChat, subagents, sessions, kept, nameOf, leadOf, origins, log } = ctx;
  /** Who reads the stream. The wake rules, once they are wired. */
  const readers = new Set<(event: SessionEvent) => void>();
  /** Who reads a turn starting, which is the wake rules too. */
  const starters = new Set<(turn: SessionTurn) => void>();
  /** And who reads a session moving, which is the same rules again. */
  const movers = new Set<(session: string) => void>();
  /** Each chat with a turn open, and how many tool calls that turn has run. */
  const open = new Map<string, number>();
  /** The messages waiting behind each chat's running turn, by the id each was queued under. */
  const waiting = new Map<string, Set<string>>();
  /** What each running tool call was called and with what, by chat and call. */
  const calls = new Map<string, { name: string; input: string }>();

  /** What everything this stream says about a session says, whatever kind it is. */
  const about = (session: string): Omit<SessionAbout, 'at'> => {
    const id = idOf(session);
    const owner = kept.owner(id);
    const scope = kept.scope(id);
    const held = sessions.get(session);
    const provider = kept.provider(id) ?? held?.agent.provider;
    // Where the session works is the lead chat's own answer, which is what the
    // catalogue publishes for it - so a rule naming a folder names one a person
    // would see on the session.
    const folders = held === undefined ? [] : leadOf(held)?.workingDirectories() ?? [];
    return {
      session,
      ...(owner === undefined ? {} : { owner }),
      ...(provider === undefined ? {} : { provider }),
      ...(scope?.project === undefined ? {} : { project: scope.project }),
      folders,
      // Whether a run started it, which the host already knows for its own
      // loop guard: a rule about the sessions nothing automated made asks this.
      automated: origins.has(session),
    };
  };

  /** How many messages wait behind a chat's running turn. */
  const queuedIn = (chat: string): number => waiting.get(chat)?.size ?? 0;

  /**
   * Whether a turn is running in the chat a session reads as, and what waits
   * behind it.
   *
   * Read off the session's own chat, which is the one a rule about "this
   * session is busy" means. A session being told its child finished is a
   * session whose own turn may or may not be running, and both are worth
   * saying.
   */
  const stateOf = (session: string): Pick<SessionEvent, 'running' | 'queued'> => {
    const chat = sessions.get(session)?.defaultChat;
    return chat === undefined ? {} : { running: open.has(chat), queued: queuedIn(chat) };
  };

  /**
   * Offer one thing to every reader of one stream.
   *
   * A reader that throws is one reader's problem, and the thing it was offered
   * is what is lost - not the daemon, and not the other readers.
   */
  const offer = <T>(to: Set<(one: T) => void>, what: T, name: string): void => {
    for (const reader of [...to]) {
      try { reader(what); }
      catch { log(`${name} was dropped: a wake rule threw`); }
    }
  };

  /** What one kind of event says on top of what every event says. */
  type More = Omit<SessionEvent, 'kind' | keyof SessionAbout>;

  const read = (kind: SessionEventKind, session: string, more: More = {}): void => {
    const event: SessionEvent = { kind, ...about(session), at: new Date().toISOString(), ...more };
    offer(readers, event, kind);
  };

  return {
    watch(read_) {
      readers.add(read_);
      return () => { readers.delete(read_); };
    },
    turns(read_) {
      starters.add(read_);
      return () => { starters.delete(read_); };
    },
    moved(read_) {
      movers.add(read_);
      return () => { movers.delete(read_); };
    },
    observe(channel, action) {
      const chat = byChat.get(channel);
      const worker = chat === undefined ? subagents.get(channel) : undefined;
      // A chat of a live session, or a worker chat, which has no session of
      // its own and belongs to the one that opened it. Any other channel is
      // one this stream has nothing to say about.
      const session = chat?.uri ?? worker?.session;
      if (session === undefined) return;
      /*
       * A session doing something the wire carries no event for: its words
       * streaming, or a tool call beginning, taking its input or streaming
       * itself. Said before the switch rather than inside it, because these are
       * actions this stream otherwise has nothing to do with.
       */
      if (MOVES.has(String(action.type))) offer(movers, session, String(action.type));
      const queued = queuedIn(channel);
      const turn = open.get(channel);
      switch (action.type) {
        case 'chat/turnStarted': {
          open.set(channel, 0);
          /*
           * A turn nothing will say anything about until it ends, which is what
           * a rule about a turn that has run too long is measured from. Said for
           * the session's own chat only: a worker's turn is the session calling
           * something, not the session answering, and its length is not the
           * session's.
           */
          const held = sessions.get(session);
          if (held !== undefined && held.defaultChat === channel) {
            const started: SessionTurn = { ...about(session), at: new Date().toISOString() };
            offer(starters, started, 'turnStarted');
          }
          return;
        }
        /*
         * A call is remembered by what it was called and with what, because the
         * completion carries neither: the start names the tool and the ready
         * carries the input, and a rule about "the same call three times" needs
         * both at the moment the call finishes.
         */
        case 'chat/toolCallStart':
          calls.set(aboutCall(channel, String(action.toolCallId ?? '')), { name: String(action.toolName ?? ''), input: '' });
          return;
        case 'chat/toolCallReady': {
          const found = calls.get(aboutCall(channel, String(action.toolCallId ?? '')));
          if (found !== undefined) found.input = inputOf(action.toolInput);
          return;
        }
        case 'chat/toolCallComplete': {
          const key = aboutCall(channel, String(action.toolCallId ?? ''));
          const called = calls.get(key);
          calls.delete(key);
          const ran = (turn ?? 0) + 1;
          if (turn !== undefined) open.set(channel, ran);
          const result = (action.result ?? {}) as Bag;
          read(result.success === false ? 'toolFailed' : 'toolCalled', session, {
            tool: { name: called?.name ?? '', inputHash: hashOf(called?.input ?? '') },
            turnToolCalls: ran,
            running: turn !== undefined,
            queued,
          });
          return;
        }
        /*
         * A message that waits is the one a rule about "waiting while busy"
         * watches. One that steers into the running turn is not waiting: it was
         * delivered, and nothing here has anything more to say about it.
         */
        case 'chat/pendingMessageSet': {
          const id = String(action.id ?? '');
          if (String(action.kind ?? 'queued') !== 'queued' || id === '') return;
          const ids = waiting.get(channel);
          if (ids === undefined) waiting.set(channel, new Set([id]));
          else ids.add(id);
          read('messageQueued', session, {
            queued: queuedIn(channel),
            running: turn !== undefined,
            turnToolCalls: turn ?? 0,
          });
          return;
        }
        case 'chat/pendingMessageRemoved': {
          if (String(action.kind ?? 'queued') !== 'queued') return;
          waiting.get(channel)?.delete(String(action.id ?? ''));
          return;
        }
        case 'chat/turnComplete':
        case 'chat/turnCancelled':
        case 'chat/error': {
          open.delete(channel);
          const kind: SessionEventKind = action.type === 'chat/turnComplete' ? 'turnCompleted'
            : action.type === 'chat/turnCancelled' ? 'turnCancelled' : 'turnFailed';
          // A worker chat's turn ending is the worker finishing, said on the
          // session that opened it rather than on the worker itself, which is
          // not a session.
          if (worker !== undefined) {
            read('childFinished', worker.session, { child: channel, queued, running: false });
            return;
          }
          read(kind, session, { queued, running: false, turnToolCalls: turn ?? 0 });
          /*
           * And the session going quiet, which is what a rule waiting for one
           * watches: the last turn ended and nothing is waiting behind it. Said
           * at once rather than after a delay, because how long a quiet period
           * has to be is the rule's to say.
           */
          if (queued === 0) {
            read('idle', session, { queued: 0, running: false, turnToolCalls: turn ?? 0 });
            /*
             * And the session that started this one, told that it has stopped
             * for now.
             *
             * The same news `ended` carries, and said here too because a child
             * that has finished what it was asked is what a parent waits to
             * hear - waiting for the child to be disposed of would be waiting
             * for somebody to notice. Every quiet turn says it again, and the
             * link is the stored one, so a child long out of this process still
             * reaches the session that started it.
             */
            const parent = kept.parent?.(idOf(session));
            const at = parent === undefined ? undefined : nameOf(parent);
            if (at !== undefined && sessions.has(at)) {
              read('childFinished', at, { child: session, ...stateOf(at) });
            }
          }
          return;
        }
        default:
      }
    },
    /*
     * A session this host was running has ended, and the session the `create`
     * tool started it from is told. The link is the stored one rather than
     * anything held here, so a child that ends long after the restart that
     * lost this process still reaches the session that started it.
     */
    ended(uri) {
      const parent = kept.parent?.(idOf(uri));
      if (parent === undefined) return;
      const at = nameOf(parent);
      if (!sessions.has(at)) return;
      read('childFinished', at, { child: uri, ...stateOf(at) });
    },
    /*
     * A chat this stream was following is gone.
     *
     * A turn that was open, the messages waiting behind it and the calls that
     * were half-run are all things no chat will do now, and the maps they are
     * held in are keyed by a channel nothing will dispatch on again - a daemon
     * that runs for weeks would otherwise hold one of each for every session
     * anybody ever opened. A name a client uses again is a new chat rather than
     * this one coming back, so nothing here is worth keeping against it.
     */
    forget(chat) {
      open.delete(chat);
      waiting.delete(chat);
      for (const key of [...calls.keys()]) {
        if (key.startsWith(`${chat}\u0000`)) calls.delete(key);
      }
    },
  };
}
