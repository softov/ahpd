import { randomUUID } from 'node:crypto';
import { idOf, openLink, reason } from '@ahpd/sdk';
import { contextBlock, timeWithOffset } from './context.js';
import { prepareFolder } from './folder.js';
import { backTitle, CHAT_PROVIDER, NOT_ITS_OWN_FRONT, userOf } from './names.js';
import type { Bag, ChatRequest, Owner } from '@ahpd/sdk';
import type { ChatMessage, TurnHandle } from './chat.js';
import type { BackSessions, FrontSessions } from './names.js';
import type { BotRecord } from './record.js';
import type { BotStore } from './store.js';

/**
 * What a message said to a bot wakes.
 *
 * A person talks to a bot in its Front, the default chat of a `bot-chat`
 * session that runs no model (see `chat.ts`), and the work is done by a Back
 * chat of that same session, on the bot's own harness. This is the road between
 * the two: the Back chat of a Front, the queued message the message becomes in
 * it, and the Front turn left open while it is answered.
 *
 * A Front has one Back chat, found by its id: the chat of the session whose
 * `tool` origin names the Front chat. The first message starts it with
 * `startChat`, made by the `subagent` call the Front turn shows, and every
 * message after continues it, so the bot keeps what it did for that person.
 *
 * What the message becomes is not only the person's words: a context block in
 * front of them says the main chat, the person and the time, because those
 * change with every message and the system prompt does not. See `context.ts`.
 *
 * The message is sent by the plugin's own connection to its host, as a queued
 * message the host takes up in the order messages came, and the Back chat and
 * its running turn are read off the session's own state. Both are seams rather
 * than calls made from here: this file decides *what* a message becomes, and
 * `plugin.ts` is where the connection that carries it lives.
 *
 * A message that reached a Back chat leaves its Front turn open until the Back
 * turn ends, as a turn waits on a subagent. Each `post_message` call in that
 * time adds an answer to the Front turn, which is `post.ts`. A turn that ends
 * with no post leaves it to the option `mainTurnPostMessageAbsent` what the
 * Front turn gets - the Back's last words, a notice that none came, or nothing.
 * Both are said through `answering` - the map from a Back chat to the turn that
 * woke it - which is also what lets the turn go. A message that never reached a
 * Back chat is the one ending this file makes itself, failed with the cause.
 */

/** One Back chat, as the host answers it. */
export interface Looked {
  /** The Back chat: where a message is sent. */
  chat: string;
  /** The turn running in it, where one is: what a stop of the Front turn cancels. */
  turn?: string;
}

/** The sessions this host keeps, as much of them as a bot's wake is about. */
export interface BotSessions {
  /** Whose the session at this URI is, or nothing where this host has none. */
  owner(uri: string): Promise<Owner | undefined>;
}

/** What the wake reads and sends through. */
export interface WakeSeams {
  /** The bots, whose record names the harness a Back chat runs on. */
  store: BotStore;
  /** The bots' Front rows, which say which session each person talks in, for its connectors. */
  fronts: FrontSessions;
  /**
   * The rows of the Back sessions an older daemon started, read for their
   * connectors alone: a Back session from before the Back chats stays as it is.
   */
  backs: BackSessions;
  /** This host's sessions, where the person a Front belongs to is read. */
  sessions: BotSessions;
  /**
   * The `AGENTS.md` a first wake writes into the bot's folder.
   *
   * The template the record names, or the default one, already filled with the
   * bot's words. Async because a template is a record, which a store may answer
   * later, and the default one is a file that is read when it is asked for.
   */
  agents(bot: BotRecord): Promise<string>;
  /**
   * The Back chat of one Front: the chat of the session whose `tool` origin
   * names the Front chat, or nothing where the session has none yet. Read off
   * the session's own state, because a plugin cannot list a session's chats.
   */
  backChat(session: string, front: string): Promise<string | undefined>;
  /** Start a chat in a session, and answer its URI. */
  startChat(session: string, wanted: ChatRequest): Promise<string>;
  /**
   * One Back chat and the turn running in it, or the failure of asking.
   *
   * Throws where the chat cannot be read, and the sentence it throws is what
   * the person is told: the reader is the plugin's own connection, so what
   * fails here - a grant it was not given among them - is an operator's to fix
   * and nobody else's to see.
   */
  look(chat: string): Promise<Looked>;
  /** Send one action on a chat, and give the host's reason where it refused it, or `undefined` where it took it. */
  send(chat: string, action: Bag): Promise<string | undefined>;
  /**
   * Whether a bot's owner may start a session on the agent its record names.
   *
   * Asked at each wake, and against the bot's owner rather than the person
   * talking: the record is a file a person may edit by hand, so the check a
   * write made is not the last word on what it says. Absent on a host that
   * checks nothing.
   */
  mayUse?(owner: Owner, provider: string | undefined): boolean;
  /**
   * The chat whose tool call made `chat`, read off the `tool` origin in the
   * session's chat list, or nothing for a chat no call made. A Back's origin
   * names its Front, and a subagent's worker chat names the Back.
   */
  parentOf?(session: string, chat: string): Promise<string | undefined>;
  /**
   * The handle of a Front, the `bot-chat` chat `chat`, opening the session and
   * the chat where the host does not hold them; nothing for a chat that is no
   * Front.
   */
  front?(session: string, chat: string): Promise<TurnHandle | undefined>;
  /** Say what went wrong, for the operator to read. */
  problem(line: string): void;
}

/** The Front's open turn that one Back chat is answering. */
export interface Answering {
  /** The session of the Front, which the Back chat is a chat of. */
  session: string;
  /** The turn in it that stays open until the work is answered. */
  turnId: string;
  /** The handle over that turn: what the answer is said through, and what ends it. */
  handle: TurnHandle;
  /** The bot's name, which the notice is said in, where the option asks for one. */
  bot: string;
  /**
   * The Back chat this turn waits on, which is the key of the map this is held
   * in: a turn that ends there answers it, and one that ends in another chat,
   * a worker's, does not.
   */
  chat: string;
  /** True once the Back chat has posted into this turn. */
  posted?: boolean;
  /**
   * True for a Front turn the bot opened itself, with no message of the
   * person's: a post, a question or a turn of the Back's own that came while
   * no turn waited. It ends when the Back has no turn running and no question
   * of it is open.
   */
  own?: boolean;
  /** The questions of the Back's copied into this turn and not answered yet. */
  questions?: number;
  /**
   * The messages this wake sent the back session that no turn of it has taken
   * up yet, by their ids, each with the main chat's steering message it
   * carries where it is a steer. The back session's host takes up a queued
   * message in the order messages came, so the turn that answers the main turn
   * is the one the last of them becomes.
   */
  waiting: Map<string, string | undefined>;
  /**
   * How the back session's last turn ended, where it ended while a message of
   * this wake still waited there: what ends the main turn where that message
   * is dropped and no turn takes it up.
   */
  ended?: { text: string; failed?: string };
}

/**
 * What a main turn does when the back session's turn ends without a
 * `post_message` call, as the option `mainTurnPostMessageAbsent` says.
 *
 * `post` ends it with the session's last words, and with nothing where the turn
 * said nothing. `notice` ends it with the notice, as it was before the option.
 * `silence` ends it with nothing. `postNotice` ends it with the last words, and
 * with the notice where there are none.
 */
export type MainTurnAbsence = 'post' | 'notice' | 'silence' | 'postNotice';

/**
 * Where a woken message's context goes, as the option `contextIn` says.
 *
 * `text` puts the context block in front of the person's words, so the back
 * session's model reads the main chat, the person and the time with them.
 * `meta` hands the words as they were said, with the main chat they came from
 * in the message's delegation `_meta` alone, as VS Code's host delegates a
 * prompt another session's agent wrote.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L2615-L2621
 */
export type ContextIn = 'text' | 'meta';

/** Every value `mainTurnPostMessageAbsent` takes, in the order the table lists them. */
export const MAIN_TURN_ABSENCES: readonly MainTurnAbsence[] = ['post', 'notice', 'silence', 'postNotice'];

/** Whether a value is one `mainTurnPostMessageAbsent` takes. */
export const isMainTurnAbsence = (value: unknown): value is MainTurnAbsence =>
  typeof value === 'string' && (MAIN_TURN_ABSENCES as readonly string[]).includes(value);

/** What the plugin holds of the wake: the waking itself, and the turns it left open. */
export interface Wake {
  /**
   * Wake the back session this message names, and send the message into it.
   *
   * A message that cannot be sent - a start the host refused, a name no session
   * can have, a session this host does not answer - ends the main turn failed,
   * naming the cause, because the person is waiting on it and nothing else is
   * coming. A steer that cannot be sent is dropped instead, and the turn it
   * went into goes on waiting on the work it already waited on; a steer whose
   * turn ended while it was on its way is handed back to the main chat unsent.
   */
  woken(message: ChatMessage, handle: TurnHandle): Promise<void>;
  /**
   * A turn began in a back session a main turn is waiting on: the message of
   * this wake's it took up, named by `queuedMessageId`, waits no more, and the
   * turn is the clock a stop is measured by. A steer that message carried is
   * in the work from here, and the main chat takes it out of its pending
   * state.
   */
  taken(backChat: string, backTurn: string, queuedMessageId: string | undefined): void;
  /**
   * The Front turn one Back chat is answering, or nothing where none is.
   *
   * By chat and never by a name a caller sent: what a Back chat posts, asks or
   * answers arrives naming its own chat, which is the one thing about it a
   * caller cannot choose.
   */
  main(backChat: string): Answering | undefined;
  /**
   * A client stopped a main turn: each back session answering it stops its
   * running turn too, and keeps its link to the main chat, and a message still
   * on its way to a back session for that turn is not sent.
   *
   * The reference host cancels the running turn of each subagent session of a
   * chat whose turn is stopped, with the time it ran, keeps their
   * registrations, and drops the signals they had pending; this host's back
   * session is that subagent's: the work a stopped turn waited on.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1470-L1497
   */
  stopped(session: string, turnId: string): Promise<void>;
  /**
   * Add an answer to the main turn one back session is answering, and keep
   * the turn open.
   *
   * The main turn waits on the back session's turn as on a subagent, so a
   * session may post more than once, and `finished` ends the main turn when
   * the back turn ends.
   *
   * False where no main turn is waiting on this session - it is not a back
   * session this wake started, or the turn it answered has already ended - so
   * a caller that posted into nothing says so.
   */
  posted(backChat: string, text: string): boolean;
  /**
   * The Front turn a chat of a talk reaches: the turn waiting on its Back, or
   * one the bot opens in the Front where none waits. The chat is the Back or a
   * worker chat under it, walked up through the `tool` origins, so a Back and
   * its subagents reach the Front at any time and not only while a message of
   * the person's waits. Nothing for a chat that is under no Front.
   */
  reach(session: string, chat: string): Promise<{ back: string; held: Answering } | undefined>;
  /**
   * Add an answer to the Front turn the chat reaches, opening one where none
   * waits. False for a chat that is under no Front.
   */
  post(session: string, chat: string, text: string): Promise<boolean>;
  /**
   * A turn of the Back's own ended, one no message of this wake and no person
   * sent, such as the one the harness starts when a background task ends. Its
   * last words go to the Front in a turn of the bot's own, as
   * `mainTurnPostMessageAbsent` says for a turn that did not post.
   */
  spoke(session: string, chat: string, text: string, failed?: string): Promise<void>;
  /**
   * End the Front turn the bot opened for `backChat` where nothing holds it
   * any more: no Back turn runs and no question of it is open.
   */
  settle(backChat: string): Promise<void>;
  /**
   * End the main turn one back session was answering, because the session's
   * turn is over.
   *
   * A turn the session posted into ends with what it posted. Otherwise `text`
   * is what the session said in that turn, and what the main turn gets is the
   * option `mainTurnPostMessageAbsent`: the last words, the notice, or nothing.
   *
   * Nothing where no main turn is waiting on this session, which is one whose
   * main turn already ended and one this wake never woke. A message of this
   * wake still waiting in the session holds the ending back: the main turn is
   * answered by the turn that message becomes, and ends this way only where
   * the message is dropped.
   *
   * `failed` is the sentence a turn that failed ended with, and the main turn
   * fails with it.
   */
  finished(backChat: string, text: string, failed?: string): void;
  /**
   * The connectors one session may use, by alias, read live.
   *
   * The map of the bot the session is a talk with, or of the bot that started
   * an older Back session, as the store holds the bot now: a bot edited while
   * its Back chat runs is answered as the bot is after the edit, because the
   * host asks this at each tool list and each call. Nothing for a session that
   * is no bot's, and nothing for a bot whose record has gone - which is what a
   * revoke of every connector looks like from here.
   */
  bindings(session: string): Record<string, string> | undefined;
}

/**
 * The wake over one daemon: its bots, its rows and its own connection.
 *
 * Every case a test cares about is one call of `woken` with the seams it was
 * given, so this takes seams rather than a host: what starts a chat, what a
 * Back chat is looked up in and what a message is sent with are all somebody
 * else's, and the wake is what decides the order they happen in.
 *
 * `absent` is the plugin's `mainTurnPostMessageAbsent`, and defaults to `post`:
 * a person asked a question, and the Back's last words are the answer unless
 * the host was told otherwise. `contextIn` is the plugin's option of that name,
 * and defaults to `text`.
 */
export function botWake(seams: WakeSeams, absent: MainTurnAbsence = 'post', contextIn: ContextIn = 'text'): Wake {
  /** The Front turn each Back chat is answering, by that chat's URI. */
  const answering = new Map<string, Answering>();
  /** The Back chats being started right now, by the Front chat each is started for. */
  const starting = new Map<string, Promise<string>>();
  /** The bot each session is a talk with, or the bot that started an older Back session, by session URI. */
  const started = new Map<string, string>();
  /**
   * The turn of each Back chat a Front turn waits on, and when it began, by
   * that chat's URI: the clock a stop's `duration` is read off, as a client
   * measures a turn it stops by its own stopwatch and says zero for one it
   * never timed.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L2030-L2035
   */
  const startedTurns = new Map<string, { turn: string; at: number }>();
  /**
   * The messages on their way to a Back chat, by the Front turn they belong
   * to: how many are, and whether a client stopped that turn meanwhile.
   *
   * What a stop finds pending is dropped, as the reference host drops the
   * stopped chat's pending subagent signals and keeps their registrations: a
   * message not yet sent is not sent, and one whose send was under way has its
   * Back turn cancelled once the send is done.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1484-L1491
   */
  const delivering = new Map<string, { count: number; stopped: boolean }>();
  /**
   * Take back the messages this wake queued in one Back chat that no turn of
   * it has taken up, as a client takes back one it queued: each would
   * otherwise run there as a turn nobody waits on.
   */
  const removePendingMessages = async (back: string, waiting: Map<string, string | undefined>): Promise<void> => {
    for (const id of [...waiting.keys()]) {
      waiting.delete(id);
      let left: string | undefined;
      try {
        left = await seams.send(back, { type: 'chat/pendingMessageRemoved', kind: 'queued', id });
      }
      catch (error) {
        left = reason(error);
      }
      if (left !== undefined) seams.problem(`${back} kept a message the stop took back: ${left}`);
    }
  };
  /**
   * Cancel the turn running in one Back chat, with the time this wake's clock
   * gives for a turn it began there, or zero for one it did not, as a client
   * measures a turn it stops by its own stopwatch.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1470-L1483
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L2030-L2035
   */
  const cancelSubagent = async (back: string): Promise<void> => {
    let looked: Looked;
    try {
      looked = await seams.look(back);
    }
    catch (error) {
      seams.problem(`${back} was not stopped: ${reason(error)}`);
      return;
    }
    if (looked.turn === undefined) return;
    const clock = startedTurns.get(back);
    const duration = clock?.turn === looked.turn ? Date.now() - clock.at : 0;
    let refused: string | undefined;
    try {
      refused = await seams.send(looked.chat, { type: 'chat/turnCancelled', turnId: looked.turn, duration });
    }
    catch (error) {
      refused = reason(error);
    }
    if (refused !== undefined) seams.problem(`${back}'s turn was not stopped: ${refused}`);
  };

  /**
   * The sessions this host already had, each with its bot.
   *
   * A person's talk with a bot is a Front row, and a Back session an older
   * daemon started is a row of the bot's `sessions`: both say which bot a
   * session is, so a session a daemon restart left behind is answered with its
   * bot's connectors as a fresh one is.
   *
   * Read once, because a row is written when a talk is made and a wake puts
   * the session in the map as well. A read that fails is reported and the map
   * is what a wake since then has added: an operator's to fix, and not a reason
   * to refuse waking a bot.
   */
  const filled = (async (): Promise<void> => {
    // A wake built over no store - one made to ask a tool its shape - has no
    // rows to read and nothing that will ever ask it for a binding.
    const store = seams.store;
    if (!store) return;
    await store.ready();
    for (const bot of store.all()) {
      const sessions = [...await seams.fronts.sessions(bot.id), ...await seams.backs.sessions(bot.id)];
      for (const session of sessions) {
        // A session one bot's rows name is that bot's: another bot naming the
        // same one is a row somebody wrote by hand, and the first bot wins.
        if (!started.has(session)) started.set(session, bot.id);
      }
    }
  })().catch((error: unknown) => {
    seams.problem(`the sessions of the bots were not read: ${reason(error)}`);
  });

  /**
   * The Back chat of one Front, found by its id or started.
   *
   * The chat of the Front's session whose `tool` origin names the Front chat
   * is the one a person comes back to. Where there is none, the Back is started
   * there on the bot's preset, else its provider and model, offered
   * `post_message`, and made by the Front turn's `subagent` call `callId`. Two
   * messages that arrive together for one Front start one Back.
   */
  const backOf = async (bot: BotRecord, message: ChatMessage, callId: string, owner: Owner): Promise<string> => {
    /*
     * The agent first: a record that now names an agent its owner may not use
     * is refused even where a Back of an earlier record is still there, so a
     * hand edit cannot keep a Back alive on somebody else's agent. The refusal
     * is the host's own sentence for an agent it does not serve this caller.
     */
    const provider = bot.preset ?? bot.provider;
    // A Back on the Front's own agent would be one more Front, woken by the
    // message it was sent.
    if (bot.provider === CHAT_PROVIDER) throw new Error(NOT_ITS_OWN_FRONT);
    if (provider !== undefined && seams.mayUse !== undefined && !seams.mayUse(bot.owner, provider)) {
      throw new Error(`No provider called ${provider}`);
    }
    const running = starting.get(message.chat);
    if (running !== undefined) return running;
    const begun = (async (): Promise<string> => {
      const found = await seams.backChat(message.session, message.chat);
      if (found !== undefined) return found;
      /*
       * The folder before the chat, because the chat starts in it and reads
       * what is there: a bot whose `AGENTS.md` has not been written yet is one
       * that starts without its rules. `prepareFolder` leaves a file that is
       * there alone, and writes one where there is none. Not for a bot that
       * works in a computer: its folder is the machine's.
       */
      if (bot.computer === undefined) prepareFolder(bot.workspace, await seams.agents(bot));
      return await seams.startChat(message.session, {
        ...(provider === undefined ? {} : { provider }),
        ...(bot.preset !== undefined || bot.model === undefined ? {} : { model: bot.model }),
        title: backTitle(bot.id, owner),
        tools: ['post_message', 'send_message'],
        origin: { kind: 'tool', chat: message.chat, toolCallId: callId },
      });
    })();
    starting.set(message.chat, begun);
    // Held only while it is being started, whether it answers or refuses.
    const done = (): void => { if (starting.get(message.chat) === begun) starting.delete(message.chat); };
    begun.then(done, done);
    return begun;
  };

  /**
   * The person's message as the back session is handed it, as the reference
   * Agents window sends a message from one session into another: an agent's
   * message, naming the session and the chat it came from. One that began a
   * main turn is queued, since the host the back session runs on takes it up in
   * the order messages came. One the person steered into the open main turn
   * steers the back turn that answers it, as the person chose to steer. The
   * text is what `contextIn` makes it: the person's words with the context
   * block in front of them, one blank line between, or the words alone.
   *
   * It names no model, agent or attachments: a message with none runs on the
   * host's default model and the provider's default behavior.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionMessageRouter.ts#L271-L282
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/meta/vscode/agentRemoteSessionMeta.ts#L78-L89
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L810-L827
   */
  const pending = (text: string, message: ChatMessage, steers: boolean): Bag => ({
    type: 'chat/pendingMessageSet',
    kind: steers ? 'steering' : 'queued',
    id: randomUUID(),
    message: {
      text,
      origin: { kind: 'agent' },
      _meta: { 'vscode.chat.delegation': { sourceSession: message.session, sourceChat: message.chat } },
    },
  });

  const finished = (backChat: string, text: string, failed?: string): void => {
    const held = answering.get(backChat);
    if (held === undefined) return;
    // A message this wake sent still waits there, and the main turn is
    // answered by the turn it becomes; the ending is kept for the case where
    // that message is dropped.
    if (held.waiting.size > 0) {
      held.ended = { text, ...(failed === undefined ? {} : { failed }) };
      return;
    }
    /*
     * Let go before the turn ends: ending it starts whatever was queued
     * behind it in the main chat, and that message wakes a session which may
     * be this one - a turn left in the map here would be answered by the
     * next message's turn as well.
     */
    answering.delete(backChat);
    // A turn that failed fails the main turn, as the reference host ends a failed send.
    if (failed !== undefined && held.handle.fail !== undefined) {
      held.handle.fail(failed);
      return;
    }
    // What the session posted is the answer, and its last words are not added to it.
    if (held.posted === true) {
      held.handle.complete();
      return;
    }
    /*
     * The table `mainTurnPostMessageAbsent` names. A turn that said nothing
     * has nothing to post, so it is completed with no answer rather than an
     * empty one; whether that ending is a notice is what `postNotice` is for.
     */
    if (text !== '' && (absent === 'post' || absent === 'postNotice')) {
      held.handle.complete(text);
      return;
    }
    if (absent === 'notice' || absent === 'postNotice') {
      held.handle.notice(`${held.bot} finished without a reply`);
      return;
    }
    held.handle.complete();
  };

  /** The Front turns the bot is opening, by Back chat, so two posts at once open one. */
  const opening = new Map<string, Promise<Answering | undefined>>();

  /** The bot a talk is with, by name, for a notice; its slug where the store has it no more. */
  const nameOf = (session: string): string => {
    const slug = started.get(session);
    return slug === undefined ? '' : seams.store.get(slug)?.name ?? slug;
  };

  /** The Front turn `back` answers, opened by the bot in `front` where none waits. */
  const openFor = (session: string, back: string, front: TurnHandle): Promise<Answering | undefined> => {
    const running = opening.get(back);
    if (running !== undefined) return running;
    const made = (async (): Promise<Answering | undefined> => {
      const waiting = answering.get(back);
      if (waiting !== undefined) return waiting;
      const turnId = front.speak?.();
      if (turnId === undefined) return undefined;
      /*
       * A turn of the person's that is open but not yet handed to the Back -
       * its message on its way to the wake - is joined, and its own message
       * ends it as before. Only a turn the bot opened is the bot's to end.
       */
      const held: Answering = {
        session, turnId, handle: front, bot: nameOf(session), chat: back, waiting: new Map(),
        ...(turnId.startsWith('bot-') ? { own: true } : {}),
      };
      answering.set(back, held);
      return held;
    })();
    opening.set(back, made);
    const done = (): void => { if (opening.get(back) === made) opening.delete(back); };
    made.then(done, done);
    return made;
  };

  const reach = async (session: string, chat: string): Promise<{ back: string; held: Answering } | undefined> => {
    let at = chat;
    // A few steps, so a loop in the origins ends.
    for (let step = 0; step < 8; step += 1) {
      const held = answering.get(at);
      if (held !== undefined) return { back: at, held };
      const parent = await seams.parentOf?.(session, at);
      if (parent === undefined || parent === at) return undefined;
      const front = await seams.front?.(session, parent);
      if (front !== undefined) {
        const opened = await openFor(session, at, front);
        return opened === undefined ? undefined : { back: at, held: opened };
      }
      at = parent;
    }
    return undefined;
  };

  const settle = async (backChat: string): Promise<void> => {
    const held = answering.get(backChat);
    if (held?.own !== true || held.waiting.size > 0 || (held.questions ?? 0) > 0) return;
    let looked: Looked;
    try { looked = await seams.look(backChat); }
    catch { return; }
    // A turn running in the Back ends the Front turn when it ends.
    if (looked.turn !== undefined) return;
    if (answering.get(backChat) !== held || (held.questions ?? 0) > 0) return;
    answering.delete(backChat);
    held.handle.complete();
  };

  return {
    main: (backChat) => answering.get(backChat),

    reach,

    post: async (session, chat, text) => {
      const found = await reach(session, chat);
      if (found === undefined) return false;
      found.held.posted = true;
      found.held.handle.responsePart(text);
      await settle(found.back);
      return true;
    },

    spoke: async (session, chat, text, failed) => {
      // Only words to say: a turn that said nothing opens nothing, and a bot
      // whose option keeps a turn without a post silent says nothing either.
      if (failed === undefined && (text === '' || (absent !== 'post' && absent !== 'postNotice'))) return;
      // The chat is a Back: its origin names a Front. A worker's turn is not.
      const parent = await seams.parentOf?.(session, chat);
      if (parent === undefined || await seams.front?.(session, parent) === undefined) return;
      const found = await reach(session, chat);
      if (found === undefined) return;
      finished(found.back, text, failed);
    },

    settle,

    stopped: async (session, turnId) => {
      // What is on its way to a Back chat for this turn is dropped.
      const pending = delivering.get(`${session} ${turnId}`);
      if (pending !== undefined) pending.stopped = true;
      /*
       * Each Back chat answering the turn keeps its link to the Front,
       * as the reference host keeps a stopped chat's subagent registrations,
       * has the messages the turn sent that still wait there taken back, and
       * has its running turn cancelled. A message still on its way is taken
       * back by its send, once it has landed.
       * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1942
       */
      const backs = [...answering].filter(([, held]) => held.session === session && held.turnId === turnId);
      for (const [back, held] of backs) {
        if (pending === undefined) await removePendingMessages(back, held.waiting);
        await cancelSubagent(back);
      }
    },

    /*
     * Read live, from the bot as the store holds it now: the store replaces a
     * record on each write, which is what makes an edit reach a session that
     * is already running. A record a person edited by hand can say anything,
     * so only the aliases whose value is a string are answered - the ones that
     * are not a connector at all are the host's own `bindingsOf` to skip.
     */
    bindings: (session) => {
      const slug = started.get(session);
      if (slug === undefined) return undefined;
      const bot = seams.store.get(slug);
      if (bot === undefined) {
        /*
         * The bot is gone, so the session is nobody's: answering nothing is a
         * revoke of every connector, and a slug made again is another bot's.
         * The store's one `onChange` ear belongs to the provider, so the map
         * is emptied here, where it is read.
         */
        started.delete(session);
        return undefined;
      }
      const held: unknown = bot.connectors;
      if (typeof held !== 'object' || held === null || Array.isArray(held)) return undefined;
      return Object.fromEntries(
        Object.entries(held as Record<string, unknown>).filter(([, value]) => typeof value === 'string'),
      ) as Record<string, string>;
    },

    posted: (backChat, text) => {
      const held = answering.get(backChat);
      if (held === undefined) return false;
      // The turn stays held: the back turn is still running, and its end is
      // what ends the main turn.
      held.posted = true;
      held.handle.responsePart(text);
      return true;
    },

    finished,

    woken: async (message, handle) => {
      // On its way from here, so a stop of the main turn meanwhile finds it.
      const key = `${message.session} ${message.turnId}`;
      const delivery = delivering.get(key) ?? { count: 0, stopped: false };
      delivery.count += 1;
      delivering.set(key, delivery);
      try {
        // The sessions this host already had, before one is started here: a
        // session that is theirs is answered with its bot's connectors, and a
        // message is what may build its first tool list.
        await filled;
        /*
         * A message with nothing to send it to, or whose send failed, ends the
         * main turn failed with the cause, as VS Code's host ends a turn whose
         * send failed; a holder with no failed ending says the cause as a notice.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2329-L2337
         *
         * A steer is dropped, and the turn it went into goes on, waiting on the
         * work it already waited on: VS Code's agents clear a steer whose
         * sending failed, and its host leaves the turn running. The cause is
         * the operator's to read.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L6817-L6837
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L218-L228
         */
        const failed = (words: string): void => {
          if (message.steering !== undefined) {
            seams.problem(`a steer of ${message.turnId} in ${message.session} was dropped: ${words}`);
            handle.steeringConsumed?.(message.steering);
            return;
          }
          if (handle.fail !== undefined) handle.fail(words);
          else handle.notice(words);
        };
        /*
         * The bot is the one the chat was made with, which the message carries
         * from the chat's own config, and whose the chat is is the host's to
         * say: the owner of the session it is in, as the host recorded it at
         * the create. The words a person typed decide neither. A bot that has
         * gone, and a session this host no longer holds, end the turn: there is
         * nothing behind the chat to answer it.
         */
        await seams.store.ready();
        const bot = seams.store.get(message.bot);
        if (bot === undefined) {
          failed(`There is no bot ${message.bot}.`);
          return;
        }
        const owner = await seams.sessions.owner(message.session);
        if (owner === undefined) {
          failed(`${message.session} is a session this host does not hold`);
          return;
        }
        // The session is a talk with this bot, whose connectors its chats use.
        started.set(message.session, bot.id);
        /*
         * The id of the `subagent` call the Front turn shows: a Back started
         * here is made by it, and its origin names it.
         */
        const callId = `call-${randomUUID()}`;
        let back: string;
        let looked: Looked;
        try {
          back = await backOf(bot, message, callId, owner);
          looked = await seams.look(back);
        }
        catch (error) {
          failed(`${bot.name} was not woken: ${reason(error)}`);
          return;
        }
        // A message whose main turn a client stopped on its way is not sent.
        if (delivery.stopped) return;
        /*
         * A steer goes on only into the turn it was steered into: one whose turn
         * ended while it was on its way is handed back unsent, for the main chat
         * to steer the turn that runs then with it or run it next. Asked here,
         * with nothing awaited between the answer and the hold below, so the
         * turn that answered is the one that holds it.
         */
        if (message.steering !== undefined && handle.steeringSent?.(message.steering) === false) return;
        /*
         * What changes from message to message, said with the message where
         * `contextIn` is `text`: the main chat the person is waiting in, who they
         * are, and when they said it. The system prompt is the bot's and never
         * changes, so nothing of this goes there. Only the back session is given
         * it - `message.text` stays the person's own words, which is what the
         * main chat keeps and shows.
         */
        const said = contextIn === 'meta' ? message.text : `${contextBlock([
          ['main chat', message.chat],
          // The Back's own address, which a subagent sends to with send_message.
          ['this chat', openLink(message.session, CHAT_PROVIDER, idOf(back))],
          ['from', userOf(owner)],
          ['time', timeWithOffset(new Date())],
        ])}\n\n${message.text}`;
        /*
         * Held before the message is sent, so a back session that answers and
         * ends inside the send still finds the turn that is waiting on it. A steer
         * of the main turn names the open turn it went into, which is the turn
         * the answer after it belongs to, and keeps what was posted into that
         * turn, the messages it sent still waiting, and the ending they hold.
         */
        const before = answering.get(back);
        const same = before !== undefined && before.handle === handle && before.turnId === message.turnId;
        // A steer goes into the back turn that already answers this main turn,
        // so it is waited on only while it is being sent.
        const steers = same && message.steering !== undefined;
        const action = pending(said, message, steers);
        const queuedId = String(action['id']);
        const waiting = same ? before.waiting : new Map<string, string | undefined>();
        waiting.set(queuedId, message.steering);
        answering.set(back, {
          session: message.session, turnId: message.turnId, handle, bot: bot.name, chat: looked.chat, waiting,
          ...(same && before.posted === true ? { posted: true } : {}),
          ...(same && before.ended !== undefined ? { ended: before.ended } : {}),
        });
        /*
         * The open turn shows what it is waiting on: the back session's chat, as
         * a subagent call a client opens. The title is the bot's, which is who
         * the person is talking to; a steer into the open turn keeps the call it
         * already shows.
         */
        handle.subagent?.(looked.chat, bot.name, callId);
        let refused: string | undefined;
        try {
          refused = await seams.send(looked.chat, action);
        }
        catch (error) {
          // A send that could not be made at all - the connection's own refusal,
          // rather than the host's answer to the action: the message reached
          // nobody, which the person is owed in the same words.
          refused = reason(error);
        }
        if (refused !== undefined) {
          /*
           * Nothing was said, so nothing is coming of this message: the turn
           * ends here rather than waiting for an answer this session never
           * received. A steer into a turn this session was already answering
           * leaves that wait as it was, and the turn ends now only where the
           * session's turn ended while the steer was on its way.
           */
          waiting.delete(queuedId);
          if (message.steering === undefined || !same) answering.delete(back);
          failed(`${bot.name} was not woken: ${refused}`);
          const now = answering.get(back);
          if (!delivery.stopped && now?.waiting === waiting && waiting.size === 0 && now.ended !== undefined) {
            finished(back, now.ended.text, now.ended.failed);
          }
          return;
        }
        /*
         * A steer the back turn holds is in the work now, so the main chat
         * takes it out, as a queued message is taken out once its turn begins,
         * and an ending the back turn reached while it was on its way goes
         * through.
         */
        if (steers) {
          waiting.delete(queuedId);
          handle.steeringConsumed?.(message.steering ?? '');
          const now = answering.get(back);
          if (!delivery.stopped && now?.waiting === waiting && waiting.size === 0 && now.ended !== undefined) {
            finished(back, now.ended.text, now.ended.failed);
          }
        }
        // A send a stop came during: what it sent is taken back, and the turn
        // running there is stopped as well.
        if (delivery.stopped) {
          await removePendingMessages(back, waiting);
          await cancelSubagent(back);
        }
      }
      finally {
        delivery.count -= 1;
        if (delivery.count === 0) delivering.delete(key);
      }
    },

    taken: (backChat, backTurn, queuedMessageId) => {
      const held = answering.get(backChat);
      if (held === undefined) return;
      // A turn of the session runs again, and its own end is the one that counts.
      delete held.ended;
      if (queuedMessageId !== undefined) {
        const steering = held.waiting.get(queuedMessageId);
        held.waiting.delete(queuedMessageId);
        /*
         * The steer it carried is in the work now, so the main chat takes it
         * out, as VS Code's host does once its agent reports a steer consumed.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L775-L782
         */
        if (steering !== undefined) held.handle.steeringConsumed?.(steering);
      }
      startedTurns.set(backChat, { turn: backTurn, at: Date.now() });
    },
  };
}
