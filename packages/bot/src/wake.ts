import { randomUUID } from 'node:crypto';
import { reason } from '@ahpd/sdk';
import { contextBlock, timeWithOffset } from './context.js';
import { prepareFolder } from './folder.js';
import { userOf } from './names.js';
import { isFilledName, TURN_WORD } from './record.js';
import type { Bag, CreatedBy, Owner, RecordCollection, SessionRequest } from '@ahpd/sdk';
import type { ChatMessage, TurnHandle } from './chat.js';
import type { BackSessions } from './names.js';
import type { BotRecord } from './record.js';
import type { BotSessions } from './provider.js';
import type { BotStore } from './store.js';

/**
 * What a message said to a bot wakes.
 *
 * A person talks to a bot in its main chat, which is a `bot-chat` session that
 * runs no model (see `chat.ts`), and the work is done by a back session behind
 * it, on the bot's own harness. This is the road between the two: the name the
 * bot's record gives its back session, the session that name is on, the queued
 * message the message becomes in it, and the main turn left open while it is
 * answered.
 *
 * The name is the bot's `session`, which is `work` unless somebody chose
 * another, and it may hold `{turn}`: the turn id of the message takes that
 * word's place, so a bot whose name holds it starts a session per message
 * instead of continuing one. The name is looked up in the bot's own `sessions`
 * rows, and a row whose session this host no longer has - a daemon that
 * restarted - is a back session started again and written over.
 *
 * What the message becomes is not only the person's words: a context block in
 * front of them says the main chat, the person and the time, because those
 * change with every message and the system prompt does not. See `context.ts`.
 *
 * The message is sent by the plugin's own connection to its host, as a queued
 * message the host takes up in the order messages came, and the back session's
 * chat and running turn are read off the session's own state. Both are seams
 * rather than calls made from here: this file decides *what* a message becomes,
 * and `plugin.ts` is where the connection that carries it lives, the way the
 * webhook package keeps its own seams beside its route.
 *
 * A message that reached a back session leaves its main turn open until the
 * session's turn ends, as a turn waits on a subagent. Each `post_message` call
 * in that time adds an answer to the main turn, which is `post.ts`. A turn that
 * ends with no post leaves it to the option `mainTurnPostMessageAbsent` what the
 * main turn gets - the session's last words, a notice that none came, or
 * nothing. Both are said through `answering` - the map from a back session to
 * the turn that woke it - which is also what lets the turn go. A message that
 * never reached a session is the one ending this file makes itself, with a
 * notice naming the cause.
 */

/** One back session's chat, as the host answers it. */
export interface Looked {
  /** The session's own default chat: where a message is sent. */
  chat: string;
  /** The turn running in it, where one is: what a stop of the main turn cancels. */
  turn?: string;
}

/** What the wake reads and sends through. */
export interface WakeSeams {
  /** The bots, whose record names the back session. */
  store: BotStore;
  /**
   * The main chat rows of one bot, which say which bot a chat is with and whose
   * it is.
   *
   * One collection per bot, in `bots/<slug>/chats`, so a message finds the bot
   * it was said to by asking each bot's collection for the row that names its
   * chat.
   */
  chats(bot: string): RecordCollection;
  /** The bot's own `sessions` rows, which say which session a name is on. */
  backs: BackSessions;
  /** This host's sessions, where a back session is looked for and started. */
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
   * One session's chat and whether it is working, or the failure of asking.
   *
   * Throws where the session cannot be read, and the sentence it throws is what
   * the person is told: the reader is the plugin's own connection, so what
   * fails here - a grant it was not given among them - is an operator's to fix
   * and nobody else's to see.
   */
  look(session: string): Promise<Looked>;
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
  /** Say what went wrong, for the operator to read. */
  problem(line: string): void;
}

/** The main chat's open turn that one back session is answering. */
export interface Answering {
  /** The session of the main chat, which is the key of the map this is held in. */
  session: string;
  /** The turn in it that stays open until the work is answered. */
  turnId: string;
  /** The handle over that turn: what the answer is said through, and what ends it. */
  handle: TurnHandle;
  /** The bot's name, which the notice is said in, where the option asks for one. */
  bot: string;
  /** True once the back session has posted into this turn. */
  posted?: boolean;
  /**
   * The messages this wake sent the back session that no turn of it has taken
   * up yet, by their ids. The back session's host takes up a queued message in
   * the order messages came, so the turn that answers the main turn is the one
   * the last of them becomes.
   */
  waiting: Set<string>;
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
   * can have, a session this host does not answer - ends the main turn with a
   * notice naming the cause, because the person is waiting on it and nothing
   * else is coming.
   */
  woken(message: ChatMessage, handle: TurnHandle): Promise<void>;
  /**
   * Hold a main turn open on a turn somebody began in a back session.
   *
   * `woken` is this for a message of the person's, and this is its other half:
   * a turn the person began in the back session itself is shown in the main
   * chat as a turn of its own, waiting on the same session. The turn is already
   * open - `begin` on its handle is what opened it - and what this adds is the
   * wait: `posted`, `asking` and `finished` answer through it as they answer a
   * turn this wake began, and `stopped` stops the back session's turn.
   *
   * `session` is the main chat's session and `turnId` the turn just opened in
   * it; `chat` is the back session's chat, which that turn shows as the call it
   * waits on, and `backTurn` is the turn running in the back session, which is
   * the clock a stop is measured by.
   *
   * Nothing where this wake already holds the back session: a message of the
   * person's woke it, and that turn is the one the main chat is waiting on.
   */
  began(backSession: string, session: string, handle: TurnHandle, turnId: string, chat: string, backTurn: string): void;
  /**
   * A turn began in a back session a main turn is waiting on: the message of
   * this wake's it took up, named by `queuedMessageId`, waits no more, and the
   * turn is the clock a stop is measured by.
   */
  taken(backSession: string, backTurn: string, queuedMessageId: string | undefined): void;
  /**
   * The main turn one back session is answering, or nothing where none is.
   *
   * By session and never by a name a caller sent: what a back session posts,
   * asks or answers arrives naming its own session, which is the one thing
   * about it a caller cannot choose.
   */
  main(backSession: string): Answering | undefined;
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
  posted(backSession: string, text: string): boolean;
  /**
   * End the main turn one back session was answering, because the session's
   * turn is over.
   *
   * A turn the session posted into ends with what it posted. Otherwise `text`
   * is what the session said in that turn, and what the main turn gets is the
   * option `mainTurnPostMessageAbsent`: the last words, the notice, or nothing.
   *
   * Nothing where no main turn is waiting on this session, which is one whose
   * main turn already ended and one this wake never woke.
   *
   * `failed` is the sentence a turn that failed ended with, and the main turn
   * fails with it.
   */
  finished(backSession: string, text: string, failed?: string): void;
  /**
   * The connectors one back session may use, by alias, read live.
   *
   * The map of the bot that started it, as the store holds the bot now: a bot
   * edited while its session runs is answered as the bot is after the edit,
   * because the host asks this at each tool list and each call. Nothing for a
   * session no bot of this wake started, and nothing for a bot whose record has
   * gone - which is what a revoke of every connector looks like from here.
   */
  bindings(backSession: string): Record<string, string> | undefined;
}

/**
 * The session one bot is started as.
 *
 * The bot's preset, harness and model, in the bot's own folder, owned by the
 * person of the main chat that woke it - a back session works for somebody, and
 * that somebody started the conversation.
 *
 * A preset wins over the harness and the model, because a preset *is* a session
 * whose backend and settings are already decided: naming a model beside it
 * would write over the one it asked for. What decides the owner is the main
 * chat rather than the bot, since a bot owned by a team is chatted with by a
 * person, and the work is charged to them.
 *
 * Its tools name `post_message`: the tool is opt-in, so a session that does
 * not ask for it is not offered it, and this is the session that has a main
 * chat to post to.
 *
 * It asks for its folder to be trusted, and only that folder: the rules the
 * bot works by are in `AGENTS.md` there, and a harness reads a folder's own
 * files only where the folder is trusted. The host honours the ask only where
 * the plugin's entry holds `session:trust`; without it the start is refused
 * naming the grant, which is an operator's to add rather than something this
 * can paper over.
 *
 * It loads none of the settings of the person who runs the daemon. The session
 * is owned by the person who chatted with the bot, but it is the bot working
 * for them and not them at a keyboard: what their own `~/.claude` holds - their
 * global instructions, their memory - would otherwise shape every bot they
 * talk to. The bot's rules are its `AGENTS.md` in its own folder, which trust
 * still loads.
 */
export const sessionFor = (bot: BotRecord, owner: Owner, createdBy?: CreatedBy): SessionRequest => {
  const provider = bot.preset ?? bot.harness;
  /*
   * The main session, chat and turn a back session was started for, recorded
   * at its start as VS Code's create_session records the session that made
   * one, which its clients place a related session by.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/sessionState.ts#L1920-L1927
   */
  const config = {
    ...(bot.computer === undefined ? {} : { computer: bot.computer }),
    ...(createdBy === undefined ? {} : { _meta: { 'agentHost/createdBySession': createdBy } }),
  };
  return {
    owner,
    ...(provider === undefined ? {} : { provider }),
    workingDirectory: bot.workspace,
    trusted: true,
    userSettings: false,
    ...(bot.preset !== undefined || bot.model === undefined ? {} : { model: { id: bot.model } }),
    ...(Object.keys(config).length === 0 ? {} : { config }),
    title: bot.name,
    tools: ['post_message'],
  };
};

/**
 * The wake over one daemon: its bots, its rows and its own connection.
 *
 * Every case a test cares about is one call of `woken` with the seams it was
 * given, so this takes seams rather than a host: what starts a session, what a
 * name is looked up in and what a message is sent with are all somebody else's,
 * and the wake is what decides the order they happen in.
 *
 * `absent` is the plugin's `mainTurnPostMessageAbsent`, and defaults to `post`:
 * a person asked a question, and the session's last words are the answer unless
 * the host was told otherwise.
 */
export function botWake(seams: WakeSeams, absent: MainTurnAbsence = 'post'): Wake {
  /** The main turn each back session is answering, by that session's URI. */
  const answering = new Map<string, Answering>();
  /** The back sessions being started right now, by the name each is started for. */
  const starting = new Map<string, Promise<string>>();
  /** The bot each back session belongs to, by that session's URI. */
  const started = new Map<string, string>();
  /**
   * The turn of each back session a main turn waits on, and when it began, by
   * that session's URI: the clock a stop's `duration` is read off, as a client
   * measures a turn it stops by its own stopwatch and says zero for one it
   * never timed.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L2030-L2035
   */
  const startedTurns = new Map<string, { turn: string; at: number }>();
  /**
   * The messages on their way to a back session, by the main turn they belong
   * to: how many are, and whether a client stopped that turn meanwhile.
   *
   * What a stop finds pending is dropped, as the reference host drops the
   * stopped chat's pending subagent signals and keeps their registrations: a
   * message not yet sent is not sent, and one whose send was under way has its
   * back turn cancelled once the send is done.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1484-L1491
   */
  const delivering = new Map<string, { count: number; stopped: boolean }>();
  /**
   * Take back the messages this wake queued in one back session that no turn
   * of it has taken up, as a client takes back one it queued: each would
   * otherwise run there as a turn nobody waits on.
   */
  const removePendingMessages = async (back: string, waiting: Set<string>): Promise<void> => {
    if (waiting.size === 0) return;
    let looked: Looked;
    try {
      looked = await seams.look(back);
    }
    catch (error) {
      seams.problem(`${back} kept the messages a stop took back: ${reason(error)}`);
      return;
    }
    for (const id of [...waiting]) {
      waiting.delete(id);
      let left: string | undefined;
      try {
        left = await seams.send(looked.chat, { type: 'chat/pendingMessageRemoved', kind: 'queued', id });
      }
      catch (error) {
        left = reason(error);
      }
      if (left !== undefined) seams.problem(`${back} kept a message the stop took back: ${left}`);
    }
  };
  /**
   * Cancel the turn running in one back session, with the time this wake's
   * clock gives for a turn it began there, or zero for one it did not, as a
   * client measures a turn it stops by its own stopwatch.
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
   * The sessions this host already had, each with the bot that started it.
   *
   * The rows are the record of that: a name is on a session because the bot's
   * wake started it there, and the row says which bot it is. So the rows of
   * every bot fill the map at load, and a session a daemon restart left behind
   * is answered with its bot's connectors as a fresh one is.
   *
   * Read once, because a row is only written when a session is started and a
   * start puts the session in the map as well. A read that fails is reported
   * and the map is what a start since then has added: an operator's to fix,
   * and not a reason to refuse waking a bot.
   */
  const filled = (async (): Promise<void> => {
    // A wake built over no store - one made to ask a tool its shape - has no
    // rows to read and nothing that will ever ask it for a binding.
    const store = seams.store;
    if (!store) return;
    await store.ready();
    for (const bot of store.all()) {
      for (const session of await seams.backs.sessions(bot.id)) {
        // A session one bot's rows name is that bot's: another bot naming the
        // same one is a row somebody wrote by hand, and the first bot wins.
        if (!started.has(session)) started.set(session, bot.id);
      }
    }
  })().catch((error: unknown) => {
    seams.problem(`the back sessions of the bots were not read: ${reason(error)}`);
  });

  /** The name this message's back session has: the bot's, with the turn id in place of `{turn}`. */
  const nameFor = (bot: BotRecord, message: ChatMessage): string =>
    bot.session.replaceAll(TURN_WORD, message.turnId.toLowerCase());

  /**
   * The bot a main chat is with, and whose the chat is.
   *
   * Each bot's own `chats` collection is asked for the row that names the
   * session, and the row answers both: a main chat is one person's with one
   * bot, and where the rows live is which bot it was said to. The session the
   * message was said in is what it is found by, rather than anything the
   * message carries: a message is text a person typed, and only the chat it was
   * typed in says who they are talking to. A chat no row names is a chat this
   * plugin did not open - one a client started by itself - and nothing about it
   * says which bot it is for.
   */
  const chatOf = async (session: string): Promise<{ bot: BotRecord; owner: Owner } | undefined> => {
    await seams.store.ready();
    for (const bot of seams.store.all()) {
      const row = (await seams.chats(bot.id).find({ chat: session }))[0];
      if (row === undefined) continue;
      const held = row['owner'];
      if (typeof held !== 'string') return undefined;
      return { bot, owner: held as Owner };
    }
    return undefined;
  };

  /**
   * The session one name is on.
   *
   * The row first, and then the session it names: a name this host still has a
   * session for is what a person comes back to, and one whose session has gone
   * is started afresh and the row written over. Two messages that arrive
   * together for one name start one session, which is the same guard `chatOf` in
   * the provider keeps over the main chats.
   */
  const sessionNamed = async (bot: BotRecord, owner: Owner, user: string, name: string, createdBy?: CreatedBy): Promise<string> => {
    /*
     * The agent before the row: a record that now names an agent its owner may
     * not use is refused even where a session of an earlier record is still
     * held, so a hand edit cannot keep a session alive on somebody else's
     * agent. The refusal is the host's own sentence for an agent it does not
     * serve this caller.
     */
    const provider = bot.preset ?? bot.harness;
    if (provider !== undefined && seams.mayUse !== undefined && !seams.mayUse(bot.owner, provider)) {
      throw new Error(`No provider called ${provider}`);
    }
    const held = await seams.backs.get(bot.id, user, name);
    if (held !== undefined && await seams.sessions.owner(held) !== undefined) return held;
    const key = `${bot.id}\n${user}\n${name}`;
    const running = starting.get(key);
    if (running !== undefined) return running;
    const begun = (async (): Promise<string> => {
      /*
       * The folder before the session, because the session starts in it and
       * reads what is there: a bot whose `AGENTS.md` has not been written yet
       * is one that starts without its rules.
       *
       * A make writes the file already, so what this normally finds is a folder
       * that has one and is left alone - it is the `wx` in `prepareFolder` that
       * keeps a file the bot or its owner changed. It still writes a file where
       * there is none: a make whose write failed, and a folder a person emptied.
       * The text is the same the make uses, so the file is the one a bot made
       * today would have had. A write that fails is the caller's refusal, which
       * is the same notice a start the host refused gets - the person is waiting
       * either way.
       *
       * Not for a bot that works in a computer: its folder is the machine's,
       * made there when the session starts, and a folder written here would be
       * one nothing reads - which is the same reason the maker makes none.
       */
      if (bot.computer === undefined) prepareFolder(bot.workspace, await seams.agents(bot));
      /** The URI the host named before starting this session, where it did. */
      let named: string | undefined;
      /*
       * Named before the backend spawns, which is what puts the bot's
       * connectors in the session's first tool list: the list is built while
       * the tree is isolated, and a reader that learned the URI only after the
       * start answered would miss it.
       */
      const session = await seams.sessions.start(sessionFor(bot, owner, createdBy), (uri) => {
        named = uri;
        started.set(uri, bot.id);
      }).catch((error: unknown) => {
        // A session the host named and then failed to start does not exist,
        // and nothing will ever ask this map about it: an entry left behind
        // would answer connectors for a URI no bot runs.
        if (named !== undefined) started.delete(named);
        throw error;
      });
      // Whose the session is, as soon as there is one: a tool list built
      // while the row is being written still sees the bot's connectors. Kept
      // here for a host that answered without naming the session first.
      started.set(session, bot.id);
      // Written down before the message is sent, so a back session that is
      // working is one a later message finds rather than one started again.
      await seams.backs.put(bot.id, user, name, session);
      return session;
    })();
    starting.set(key, begun);
    // Held only while it is being started, whether it answers or refuses.
    const done = (): void => { if (starting.get(key) === begun) starting.delete(key); };
    begun.then(done, done);
    return begun;
  };

  /**
   * The person's message as the back session is handed it, as the reference
   * Agents window sends a message from one session into another: a queued
   * message, whatever the session is doing, since the host it runs on takes it
   * up in the order messages came, and the message an agent's, naming the
   * session and the chat it came from. The text is the person's words with the
   * context block in front of them, one blank line between: what was said, and
   * the chat, the person and the time it was said in.
   *
   * It names no model, agent or attachments: a message with none runs on the
   * host's default model and the provider's default behavior.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionMessageRouter.ts#L271-L282
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/meta/vscode/agentRemoteSessionMeta.ts#L78-L89
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L810-L827
   */
  const queued = (block: string, message: ChatMessage): Bag => ({
    type: 'chat/pendingMessageSet',
    kind: 'queued',
    id: randomUUID(),
    message: {
      text: `${block}\n\n${message.text}`,
      origin: { kind: 'agent' },
      _meta: { 'vscode.chat.delegation': { sourceSession: message.session, sourceChat: message.chat } },
    },
  });

  return {
    main: (backSession) => answering.get(backSession),

    stopped: async (session, turnId) => {
      // What is on its way to a back session for this turn is dropped.
      const pending = delivering.get(`${session} ${turnId}`);
      if (pending !== undefined) pending.stopped = true;
      /*
       * Each back session answering the turn keeps its link to the main chat,
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
    bindings: (backSession) => {
      const slug = started.get(backSession);
      if (slug === undefined) return undefined;
      const bot = seams.store.get(slug);
      if (bot === undefined) {
        /*
         * The bot is gone, so the session is nobody's: answering nothing is a
         * revoke of every connector, and a slug made again is another bot's.
         * The store's one `onChange` ear belongs to the provider, so the map
         * is emptied here, where it is read.
         */
        started.delete(backSession);
        return undefined;
      }
      const held: unknown = bot.connectors;
      if (typeof held !== 'object' || held === null || Array.isArray(held)) return undefined;
      return Object.fromEntries(
        Object.entries(held as Record<string, unknown>).filter(([, value]) => typeof value === 'string'),
      ) as Record<string, string>;
    },

    posted: (backSession, text) => {
      const held = answering.get(backSession);
      if (held === undefined) return false;
      // The turn stays held: the back turn is still running, and its end is
      // what ends the main turn.
      held.posted = true;
      held.handle.say(text);
      return true;
    },

    finished: (backSession, text, failed) => {
      const held = answering.get(backSession);
      if (held === undefined) return;
      // A message this wake sent still waits there, and the main turn is
      // answered by the turn it becomes.
      if (held.waiting.size > 0) return;
      /*
       * Let go before the turn ends: ending it starts whatever was queued
       * behind it in the main chat, and that message wakes a session which may
       * be this one - a turn left in the map here would be answered by the
       * next message's turn as well.
       */
      answering.delete(backSession);
      // A turn that failed fails the main turn, as the reference host ends a failed send.
      if (failed !== undefined && held.handle.fail !== undefined) {
        held.handle.fail(failed);
        return;
      }
      // What the session posted is the answer, and its last words are not added to it.
      if (held.posted === true) {
        held.handle.end();
        return;
      }
      /*
       * The table `mainTurnPostMessageAbsent` names. A turn that said nothing
       * has nothing to post, so it is ended rather than given an empty reply;
       * whether that ending is a notice is what `postNotice` is for.
       */
      if (text !== '' && (absent === 'post' || absent === 'postNotice')) {
        held.handle.reply(text);
        return;
      }
      if (absent === 'notice' || absent === 'postNotice') {
        held.handle.notice(`${held.bot} finished without a reply`);
        return;
      }
      held.handle.end();
    },

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
         */
        const failed = (words: string): void => {
          if (handle.fail !== undefined) handle.fail(words);
          else handle.notice(words);
        };
        const chat = await chatOf(message.session);
        if (chat === undefined) {
          /*
           * A chat no read of a bot opened, so nothing says which bot the person
           * is talking to. The turn ends here rather than staying open: there is
           * nothing behind this chat to answer it.
           */
          seams.problem(`${message.session} is a chat no bot on this host opened`);
          failed(`${message.session} is a chat no bot on this host opened`);
          return;
        }
        const { bot, owner } = chat;
        const name = nameFor(bot, message);
        if (!isFilledName(name)) {
          failed(`${name} is not a name a back session can have: lowercase letters, digits and a dash, at most eighty`);
          return;
        }
        let session: string;
        let looked: Looked;
        try {
          session = await sessionNamed(bot, owner, userOf(owner), name, { session: message.session, chat: message.chat, turnId: message.turnId });
          looked = await seams.look(session);
        }
        catch (error) {
          failed(`${bot.name} was not woken: ${reason(error)}`);
          return;
        }
        // A message whose main turn a client stopped on its way is not sent.
        if (delivery.stopped) return;
        /*
         * What changes from message to message, said with the message: the main
         * chat the person is waiting in, who they are, and when they said it. The
         * system prompt is the bot's and never changes, so nothing of this goes
         * there. Only the back session is given it - `message.text` stays the
         * person's own words, which is what the main chat keeps and shows.
         */
        const block = contextBlock([
          ['main chat', `bot:/${bot.id}/${userOf(owner)}`],
          ['from', userOf(owner)],
          ['time', timeWithOffset(new Date())],
        ]);
        /*
         * Held before the message is sent, so a back session that answers and
         * ends inside the send still finds the turn that is waiting on it. A steer
         * of the main turn names the open turn it went into, which is the turn
         * the answer after it belongs to, and keeps what was posted into that
         * turn and the messages it sent still waiting.
         */
        const action = queued(block, message);
        const before = answering.get(session);
        const same = before !== undefined && before.handle === handle && before.turnId === message.turnId;
        const waiting = same ? before.waiting : new Set<string>();
        waiting.add(String(action['id']));
        answering.set(session, {
          session: message.session, turnId: message.turnId, handle, bot: bot.name, waiting,
          ...(same && before.posted === true ? { posted: true } : {}),
        });
        /*
         * The open turn shows what it is waiting on: the back session's chat, as
         * a subagent call a client opens. The title is the bot's, which is who
         * the person is talking to; a steer into the open turn keeps the call it
         * already shows.
         */
        handle.working?.(looked.chat, bot.name);
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
          // Nothing was said, so nothing is coming: the turn ends here rather
          // than waiting for an answer this session never received.
          answering.delete(session);
          failed(`${bot.name} was not woken: ${refused}`);
          return;
        }
        // A send a stop came during: what it sent is taken back, and the turn
        // running there is stopped as well.
        if (delivery.stopped) {
          await removePendingMessages(session, waiting);
          await cancelSubagent(session);
        }
      }
      finally {
        delivery.count -= 1;
        if (delivery.count === 0) delivering.delete(key);
      }
    },

    taken: (backSession, backTurn, queuedMessageId) => {
      const held = answering.get(backSession);
      if (held === undefined) return;
      if (queuedMessageId !== undefined) held.waiting.delete(queuedMessageId);
      startedTurns.set(backSession, { turn: backTurn, at: Date.now() });
    },

    began: (backSession, session, handle, turnId, chat, backTurn) => {
      if (answering.has(backSession)) return;
      /*
       * The bot's name, which the notice is said in: the rows are the record
       * of which bot a back session is, and `filled` has read them by the time
       * a turn can arrive here. A session no row names is not one a bot here
       * started, and the empty name is the one `finished` says nothing in.
       */
      const slug = started.get(backSession);
      const bot = slug === undefined ? undefined : seams.store.get(slug);
      const name = bot?.name ?? '';
      answering.set(backSession, { session, turnId, handle, bot: name, waiting: new Set() });
      startedTurns.set(backSession, { turn: backTurn, at: Date.now() });
      handle.working?.(chat, name);
    },
  };
}
