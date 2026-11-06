import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { expandHome, mayUseAgentFor, ownershipOf, reason, Status } from '@ahpd/sdk';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@microsoft/agent-host-protocol';
import { botAsk } from './ask.js';
import { botCatalogue, CATALOGUE_SCHEME } from './catalogue.js';
import { botChatAgent, turns } from './chat.js';
import { prepareAgentsTemplate } from './folder.js';
import { backSessions, BOTS_DIR, chatsOf, LEGACY_CHATS, LEGACY_SESSIONS, rowId, sessionsOf, whose } from './names.js';
import { postMessage } from './post.js';
import { botProvider } from './provider.js';
import { isSlug } from './record.js';
import { botStore } from './store.js';
import { agentsTextOf } from './template.js';
import { botWake, isMainTurnAbsence } from './wake.js';
import type { Yaml } from './agents.js';
import type { BotRecord } from './record.js';
import type { MainTurnAbsence } from './wake.js';
import type { Bag, MessageFrom, Owner, Plugin, PluginPeer, RecordCollection, TurnEndEvent } from '@ahpd/sdk';
import type { TurnHandle } from './chat.js';
import type { BotSessions } from './provider.js';

/**
 * The package as a plugin.
 *
 * One provider for the `bot:` scheme, the `x-ahpd-bots://` catalogue of the
 * bots each reader may read, the `bot-chat` agent a chat with a bot runs as,
 * and the folder bots work in as its one option. The records are kept in the
 * host's own record store rather than under the option: what a bot *is* belongs
 * to the host, and where it works is the operator's to choose.
 *
 * All the data of one bot is in `<configDir>/bots/<slug>/`: its record is
 * `bot.md`, its main chat rows are in `chats/`, its back session rows in
 * `sessions/` and its chat logs in `logs/`. A delete removes that folder, and
 * the bot's work folder under the plugin root - `<root>/<slug>` by default - is
 * not in it and stays.
 *
 * A bot's `AGENTS.md` is the one copy of its persona: a read takes `name`,
 * `description` and `instructions` from the file, and a make or an edit writes
 * them there. The `bots` collection keeps the rest of the record, and a record
 * an older daemon wrote without a file behind it is moved into the file at load
 * rather than left as a second copy. The file is read and written with the
 * host's own YAML, given to the plugin rather than imported, so the package
 * keeps no YAML dependency of its own.
 *
 * A template is a record of the `templates` collection, whose body is `text`.
 * The default `AGENTS.md` template is a file of its own, under
 * `<configDir>/templates/bots/`: this writes it at load when it is absent, and
 * a person may edit it after. It is not a record, because it is the one text
 * every bot starts from rather than a named one, and the `templates`
 * collection reads only the `.md` records directly in its folder.
 *
 * A message said to a bot wakes the back session its record names, which is
 * `wake.ts` - and the connection that sends it is here, because a plugin
 * reaching the sessions of its own host has to arrive as a client does. It is
 * opened on the first message that needs it, so a daemon nobody talks to opens
 * none.
 */

/** The plugin's id, unique among the plugins a daemon loads. */
export const name = 'bot';

/** What a listing prints. */
export const title = 'Bot';

/** What an option falls back to. */
export const defaults = {
  root: '~/.bots',
  mainTurnPostMessageAbsent: 'post',
} as const;

/** What the plugin's connection to the host calls itself, which is how it knows its own frames. */
const CLIENT = 'ahpd-bot';

/** The collection the tombstone of each deleted bot is kept in. */
const GONE = 'bots-gone';

/** The file a bot's own record is kept in, inside its folder. */
const BOT_FILE = 'bot';

/** The files of one folder, or none when there is no folder. */
const filesIn = (folder: string): string[] => {
  try {
    return readdirSync(folder, { withFileTypes: true }).filter((one) => one.isFile()).map((one) => one.name);
  }
  catch {
    return [];
  }
};

/**
 * Whether one folder is the other or is under it.
 *
 * Both are resolved first, so `..` and a trailing slash mean what they say, and
 * a path that only starts like the other - `/a/bx` under `/a/b` - is not one.
 */
const within = (path: string, folder: string): boolean => {
  const one = resolve(path);
  const other = resolve(folder);
  return one === other || one.startsWith(`${other}${sep}`);
};

/** A file's frontmatter as a mapping, read with the host's YAML, or nothing. */
const fieldsIn = (text: string, yaml: Yaml): Bag | undefined => {
  const opened = /^---[ \t]*\r?\n/.exec(text);
  if (opened === null) return undefined;
  const rest = text.slice(opened[0].length);
  const closed = /^---[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (closed === null) return undefined;
  try {
    const parsed = yaml.parseYaml(rest.slice(0, closed.index));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Bag : undefined;
  }
  catch {
    return undefined;
  }
};

/** The slug one row of an older collection names, or nothing when it cannot be read. */
const botOfRow = (file: string, yaml: Yaml): string | undefined => {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  }
  catch {
    return undefined;
  }
  const bot = fieldsIn(text, yaml)?.['bot'];
  return typeof bot === 'string' && isSlug(bot) ? bot : undefined;
};

/** The slug the first line of an older chat log names, or nothing when it cannot be read. */
const botOfLog = (file: string): string | undefined => {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  }
  catch {
    return undefined;
  }
  const line = text.split('\n').find((one) => one.trim() !== '');
  if (line === undefined) return undefined;
  try {
    const said = JSON.parse(line) as Bag;
    const meta = said['_meta'];
    const bot = typeof meta === 'object' && meta !== null && !Array.isArray(meta) ? (meta as Bag)['bot'] : undefined;
    return typeof bot === 'string' && isSlug(bot) ? bot : undefined;
  }
  catch {
    return undefined;
  }
};

/**
 * Move the data an older daemon kept into the folder each bot has now.
 *
 * Everything about one bot is `<configDir>/bots/<slug>/`: its record is
 * `bot.md`, its main chat rows are in `chats/`, its back session rows in
 * `sessions/` and its logs in `logs/`. Before that, the record was
 * `bots/<slug>.md`, and the rows and logs were in the two collections
 * `bot-chats/` and `bot-sessions/`.
 *
 * This runs at load, before anything opens one of those collections: the
 * record store reads a collection's folder when it opens it, so a file moved
 * afterwards would be one it never saw. Each file is moved by `rename`, so a
 * daemon that dies between two of them does the rest at the next load rather
 * than leaving a copy behind; a file that is already where it goes is left
 * where it is.
 *
 * A bot that has a tombstone in `bots-gone` is one that was deleted, so what
 * is left of it goes rather than moving into a folder the delete would have
 * removed - but for a folder that still holds its record, which is kept and
 * reported: the name is spent, and the folder is all that is left of it. A
 * file the move cannot place - it names no bot, or its name is not a bot's -
 * is left where it is and reported, and nothing is deleted on a guess.
 */
export function moveData(configDir: string, yaml: Yaml, problem: (line: string) => void): void {
  const bots = join(configDir, BOTS_DIR);
  /*
   * The slugs that had a bot, read off their tombstones. A name that is not a
   * slug is no bot's name, so it is reported and nothing is looked for under
   * it: `..md` is a file an editor left, not a bot that went.
   */
  const dead = new Set<string>();
  for (const name of filesIn(join(configDir, GONE))) {
    if (!name.endsWith('.md')) continue;
    const slug = name.slice(0, -'.md'.length);
    if (!isSlug(slug)) {
      problem(`${join(GONE, name)} was left where it is: ${slug} is not a bot's name`);
      continue;
    }
    dead.add(slug);
  }

  /** Move one file into a folder of a bot's, or say why it stayed. */
  const into = (from: string, folder: string, name: string, relative: string): void => {
    const target = join(folder, name);
    if (existsSync(target)) {
      problem(`${relative} was left where it is: ${target} is already there`);
      return;
    }
    try {
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      renameSync(from, target);
    }
    catch (error) {
      problem(`${relative} was not moved: ${reason(error)}`);
    }
  };

  /** Move one legacy row or log into the folder of its bot, or drop it where that bot is gone. */
  const place = (path: string, relative: string, slug: string | undefined, collection: string, name: string): void => {
    if (slug === undefined) {
      problem(`${relative} was left where it is: it names no bot`);
      return;
    }
    if (dead.has(slug)) {
      rmSync(path, { force: true });
      return;
    }
    into(path, join(bots, slug, collection), name, relative);
  };

  /*
   * A tombstoned bot's folder and record go first, so nothing of a deleted
   * bot is moved into a folder and then read as a bot that is there.
   *
   * A folder that still holds its record is kept: a delete that died between
   * its two steps and a file put back after a delete look the same here, and
   * keeping the folder loses nothing. The name is spent either way, so the
   * record it holds is refused at the load rather than read as a live bot.
   */
  for (const slug of dead) {
    const record = join(bots, slug, `${BOT_FILE}.md`);
    if (existsSync(record)) {
      problem(`${join(BOTS_DIR, slug)} was kept: ${slug} has a tombstone, so the name is spent`);
    }
    else {
      rmSync(join(bots, slug), { recursive: true, force: true });
    }
    rmSync(join(bots, `${slug}.md`), { force: true });
  }

  // The record of each bot: `bots/<slug>.md` is now `bots/<slug>/bot.md`.
  for (const name of filesIn(bots)) {
    if (!name.endsWith('.md')) continue;
    const slug = name.slice(0, -'.md'.length);
    if (!isSlug(slug)) {
      problem(`${join(BOTS_DIR, name)} was left where it is: ${slug} is not a bot's name`);
      continue;
    }
    if (dead.has(slug)) continue;
    into(join(bots, name), join(bots, slug), `${BOT_FILE}.md`, join(BOTS_DIR, name));
  }

  // The main chat rows and the chat logs, which shared one folder.
  const chats = join(configDir, LEGACY_CHATS);
  for (const name of filesIn(chats)) {
    const path = join(chats, name);
    const relative = join(LEGACY_CHATS, name);
    if (name.endsWith('.md')) place(path, relative, botOfRow(path, yaml), 'chats', name);
    else if (name.endsWith('.jsonl')) place(path, relative, botOfLog(path), 'logs', name);
    else problem(`${relative} was left where it is: it is not a chat row or a log`);
  }

  // The back session rows.
  const sessions = join(configDir, LEGACY_SESSIONS);
  for (const name of filesIn(sessions)) {
    const path = join(sessions, name);
    const relative = join(LEGACY_SESSIONS, name);
    if (name.endsWith('.md')) place(path, relative, botOfRow(path, yaml), 'sessions', name);
    else problem(`${relative} was left where it is: it is not a session row`);
  }
}

/** Dispatches actions on the plugin's connection, and hears whether the host took each one. */
export interface Dispatcher {
  /** Dispatch one action, and give the host's refusal reason, or `undefined` when the host took it. */
  dispatch(channel: string, action: Record<string, unknown>): Promise<string | undefined>;
}

/**
 * The dispatcher over the plugin's connection, which sets its one `onMessage`
 * handler.
 *
 * Each dispatch carries the next `clientSeq`, and the host answers an action it
 * applied with an `action` frame naming that `clientId` and that `clientSeq` -
 * with a `rejectionReason` when it refused it, and without one when it took it.
 * The host echoes a taken action only to the subscribers of its channel, so a
 * caller subscribes first. A dispatch is settled by that answer alone: the
 * host answers every action it is sent, and a client holds what it sent until
 * the answer comes, however long the host takes to decide.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md#L19-L32
 */
export function dispatcher(conn: PluginPeer, clientId: string): Dispatcher {
  let seq = 0;
  const waiting = new Map<number, (refused: string | undefined) => void>();
  conn.onMessage((message) => {
    if (message.method !== 'action') return;
    const params = message.params as { origin?: { clientId?: unknown; clientSeq?: unknown }; rejectionReason?: unknown } | undefined;
    const origin = params?.origin;
    if (origin?.clientId !== clientId || typeof origin.clientSeq !== 'number') return;
    const done = waiting.get(origin.clientSeq);
    if (done === undefined) return;
    waiting.delete(origin.clientSeq);
    done(typeof params?.rejectionReason === 'string' ? params.rejectionReason : undefined);
  });
  return {
    dispatch: (channel, action) => {
      seq += 1;
      const clientSeq = seq;
      return new Promise((resolve) => {
        waiting.set(clientSeq, resolve);
        conn.notify('dispatchAction', { channel, clientSeq, action });
      });
    },
  };
}

/** The plugin's connection to the host, and the dispatcher over it. */
interface Opened {
  conn: PluginPeer;
  sender: Dispatcher;
}

/**
 * The text of one turn in a chat's state: its `markdown` response parts, joined.
 *
 * Read off the chat rather than off `turn_end`, which names a turn but not what
 * it said. The parts are the answer a client draws, and the markdown ones are
 * the answer a person reads.
 */
const textOf = (state: unknown, turn: string): string => {
  const turns = (state as { turns?: unknown } | undefined)?.turns;
  if (!Array.isArray(turns)) return '';
  const found = turns.find((one: unknown) => (one as { id?: unknown }).id === turn) as { responseParts?: unknown } | undefined;
  const parts = Array.isArray(found?.responseParts) ? found.responseParts as { kind?: unknown; content?: unknown }[] : [];
  return parts.filter((part) => part.kind === 'markdown').map((part) => String(part.content ?? '')).join('');
};

/**
 * The message one turn began with, read off a chat's state.
 *
 * The turn is the chat's `activeTurn` while it runs and one of its `turns` once
 * it has ended, and a turn that began and ended between the event and this read
 * is in both. Nothing where the state holds neither.
 */
const messageOfTurn = (state: unknown, turn: string): Bag | undefined => {
  const held = state as { activeTurn?: unknown; turns?: unknown } | undefined;
  const seen = [held?.activeTurn, ...(Array.isArray(held?.turns) ? held.turns as unknown[] : [])];
  for (const one of seen) {
    if (typeof one !== 'object' || one === null) continue;
    const line = one as Bag;
    if (line['id'] !== turn) continue;
    const message = line['message'];
    return typeof message === 'object' && message !== null ? message as Bag : undefined;
  }
  return undefined;
};

/** One back turn whose main turn is not open yet, and how it ended where it already has. */
interface Opening {
  ended?: TurnEndEvent;
}

/** The key of one back turn in `opening`: its session and its id. */
const openingKey = (session: string, turn: string): string => `${session}\n${turn}`;

export const apply: Plugin['apply'] = (host, options) => {
  const asked = options.root as string | undefined;
  const chosen = expandHome(asked === undefined || asked.trim() === '' ? defaults.root : asked);
  /*
   * A work folder under the configuration folder is refused: the records live
   * there, and a delete of a bot removes the folder of its data, so anything a
   * person keeps under the root would be one bad path from the same delete. The
   * default root is used instead, and the operator is told.
   */
  const inside = within(chosen, host.configDir);
  const root = inside ? expandHome(defaults.root) : chosen;
  if (inside) {
    host.problem(`${name}: root ${JSON.stringify(chosen)} is inside the configuration folder ${JSON.stringify(resolve(host.configDir))}; using ${JSON.stringify(root)}`);
  }
  /*
   * The default `AGENTS.md` template, written once where there is none.
   *
   * A person edits it by hand, so it is written only when it is absent and
   * never over: an update to ahpd does not replace what they wrote. A failure
   * to write it costs the file and not the plugin - a wake falls back to the
   * text ahpd ships - so the operator is told and the daemon goes on.
   */
  try {
    prepareAgentsTemplate(host.configDir);
  }
  catch (error) {
    host.problem(`${name}: the default AGENTS.md template was not written: ${reason(error)}`);
  }
  /*
   * What a main turn does when a back session's turn ends without a post.
   *
   * The schema checks that the option is a string and not which one, so a value
   * outside the table is reported here and `post` is used: a person waiting on
   * a reply is owed the bot's last words, not an empty turn caused by a typo in
   * the daemon's configuration.
   */
  const askedAbsent = options.mainTurnPostMessageAbsent;
  const absent: MainTurnAbsence = isMainTurnAbsence(askedAbsent) ? askedAbsent : defaults.mainTurnPostMessageAbsent;
  if (askedAbsent !== undefined && !isMainTurnAbsence(askedAbsent)) {
    host.problem(`${name}: mainTurnPostMessageAbsent is ${JSON.stringify(askedAbsent)}, which is not one of post, notice, silence or postNotice; using post`);
  }
  const kept = host.records('templates', { body: 'text' });
  const templates = {
    // A bot file is edited by hand too, so a name is checked again here.
    text: async (name: string): Promise<string | undefined> => {
      if (!isSlug(name)) return undefined;
      const text = (await kept.get(name))?.['text'];
      return typeof text === 'string' ? text : undefined;
    },
  };
  /*
   * The `AGENTS.md` a bot with no file is given: the template record it names,
   * or the default file under the configuration folder, filled with its words.
   * Read per bot rather than kept, because a template is a file a person edits.
   * A make and a wake both take it, so the file a bot starts with is the one a
   * first wake would have made.
   */
  const agents = (bot: BotRecord): Promise<string> => agentsTextOf(bot, templates, host.configDir);
  /*
   * The YAML the host reads its own files with, passed on so a bot's `AGENTS.md`
   * means here what it means in the store: the plugin imports no YAML parser,
   * and a host that gives none gives the plugin one that refuses.
   */
  const yaml: Yaml = {
    parseYaml: (text) => host.parseYaml(text),
    stringifyYaml: (value) => host.stringifyYaml(value),
  };
  /*
   * The data of the bots an older daemon kept, moved into each bot's folder
   * before any collection opens on the folder it reads. A move that cannot
   * place a file reports it and goes on; nothing of this stops the plugin.
   */
  moveData(host.configDir, yaml, (line) => { host.problem(`${name}: ${line}`); });
  /*
   * The bots, over the record store the host keeps them in. It reads and writes
   * each bot's `AGENTS.md`, and moves the parts of a record an older daemon
   * wrote into the file on the first load; it is built after the templates and
   * the YAML because it needs both for that move. A bot's record is
   * `bots/<slug>/bot.md`, so everything about one bot is in one folder.
   */
  const store = botStore(
    host.records(BOTS_DIR, { body: 'instructions', file: BOT_FILE }),
    host.records(GONE),
    (line) => { host.problem(`${name}: ${line}`); },
    { yaml, agents },
  );
  /**
   * One collection of one bot's, opened the first time that bot's data is
   * touched.
   *
   * Opened once and kept, so a call that writes a row and a call that reads it
   * back answer the same collection: the main chat a read of a bot writes is
   * the one a wake of its chat finds.
   */
  const byName = new Map<string, RecordCollection>();
  const collection = (which: string): RecordCollection => {
    let one = byName.get(which);
    if (one === undefined) {
      one = host.records(which);
      byName.set(which, one);
    }
    return one;
  };
  /*
   * One row per bot and person, holding the chat they talk in. What makes a
   * read of `bot://` answer the same chat the second time as the first.
   */
  const chats = (bot: string): RecordCollection => collection(chatsOf(bot));
  /*
   * One row per back session: the bot, the person and the name a message
   * addresses, and the session that name is on. What makes a name a session a
   * person can come back to, rather than one started again every time.
   */
  const backs = backSessions((bot) => collection(sessionsOf(bot)));
  /*
   * The plugin's own connection to this host, opened by the first message that
   * needs one.
   *
   * A bot's work runs in a session of its own and a message reaches it as a
   * turn, which is a client action: a plugin is a client of its own host, and
   * `connect` is the only door onto one - there is no plugin-side "send a
   * turn". Opened here rather than when the daemon listens, because nothing
   * this plugin does needs it before somebody says something to a bot; a
   * connection that failed is dropped, so the next message tries again.
   *
   * The handshake offers every version the package speaks, most preferred
   * first, as the spec has a client offer them (docs/specification/versioning.md
   * at spec/v1.0.0, "Negotiation").
   */
  let opened: Promise<Opened> | undefined;
  const connection = (): Promise<Opened> => {
    opened ??= (async () => {
      const conn = host.connect();
      const sender = dispatcher(conn, CLIENT);
      await conn.request('initialize', { clientId: CLIENT, protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS] });
      return { conn, sender };
    })();
    const failed = (): void => { opened = undefined; };
    opened.catch(failed);
    return opened;
  };
  /** This host's own sessions, where a chat and a back session are started, and read for the one a bot has. */
  const sessions: BotSessions = {
    owner: (uri) => host.sessionOwner(uri),
    start: (wanted, named) => host.startSession(wanted, named),
  };
  /**
   * One action sent on a chat of this host, as a client sends one.
   *
   * The host echoes a taken action only to the subscribers of its channel, so
   * the chat is subscribed first. Shared by the wake, which sends a person's
   * message, and the asking, which sends their answer back.
   */
  const send = async (chat: string, action: Bag): Promise<string | undefined> => {
    const { conn, sender } = await connection();
    await conn.request('subscribe', { channel: chat });
    return await sender.dispatch(chat, action);
  };
  const catalogue = botCatalogue(store);
  catalogue.bind(host.registerChannel(CATALOGUE_SCHEME, catalogue.channel));
  host.on('users_changed', () => { catalogue.recompute(); });
  /*
   * Whether a bot's owner may start a session on the agent its record names.
   *
   * The host asks this of a caller, and neither place this plugin uses a
   * record is that ask: a write comes from a client that may already be
   * somebody else, and a wake starts a session for the person chatting rather
   * than for the bot's owner - so a hand-edited record naming another person's
   * agent would reach it through them. Asked at both, against the bot's owner.
   */
  const mayUse = (owner: Owner, provider: string | undefined): boolean => provider === undefined
    || mayUseAgentFor({ owner }, ownershipOf(host.agentOwners(), provider), { hasDirectory: host.hasUsers === true });
  /*
   * Whether this host still serves the agent a bot names.
   *
   * `machineNeeds` answers `undefined` for an agent nobody has and an empty
   * record for one that declares nothing, so it is an existence test rather
   * than a question about machines. A read of a bot whose agent went is
   * answered `unavailable`, which is a client being told that a message to it
   * would wake nothing.
   */
  const available = (provider: string): boolean => host.machineNeeds(provider) !== undefined;
  host.registerResourceProvider('bot', botProvider({
    root,
    botsDir: join(host.configDir, BOTS_DIR),
    store,
    catalogue,
    hostName: host.hostName,
    templates,
    yaml,
    agents,
    chats,
    backSessions: backs,
    sessions,
    mayUse,
    available,
  }));
  /*
   * The one grant a bot asks for: talking to it. The provider's own entry on
   * `ahpd.grants` takes its title, description and groups from the `bot` row
   * of the host's table, so this says only that the operation exists.
   */
  host.registerGrants('bot', { operations: ['chat'] });
  /*
   * The wake: every turn one of those chats begins, and every message steered
   * into an open one, goes to the back session the bot's record names. A chat
   * this plugin did not open - one a client started by itself - names no bot
   * in the rows and is left as it was.
   */
  const wake = botWake({
    store,
    chats,
    backs,
    sessions,
    /*
     * The bot's `AGENTS.md`, made when its folder is first prepared: the same
     * text a make writes, so a folder a make missed - one whose write failed -
     * is given the file a first wake would have made.
     */
    agents,
    /*
     * A back session's chat, and whether a turn is running in it: the two
     * things a message needs, both read off the session's own state, which is
     * what a subscribe answers. Idle means the message begins a turn, and
     * working means it steers the one that is running.
     */
    look: async (session) => {
      const { conn } = await connection();
      const answered = await conn.request('subscribe', { channel: session }) as { snapshot?: { state?: Bag } };
      const state = answered.snapshot?.state ?? {};
      const chat = state['defaultChat'];
      if (typeof chat !== 'string' || chat === '') {
        throw new Error(`${session} names no chat to say a message in`);
      }
      const status = typeof state['status'] === 'number' ? state['status'] : Status.Idle;
      if ((status & Status.InProgress) === 0) return { chat };
      // And the turn running there, off the chat's own state, which a stop
      // of the main turn cancels by its id.
      const opened = await conn.request('subscribe', { channel: chat }) as { snapshot?: { state?: Bag } };
      const active = opened.snapshot?.state?.['activeTurn'] as Bag | undefined;
      return { chat, ...(typeof active?.['id'] === 'string' ? { turn: active['id'] } : {}) };
    },
    send,
    mayUse,
    problem: (line) => { host.problem(`${name}: ${line}`); },
  }, absent);
  /*
   * A back session's connectors, which are the bot's: the host asks this at
   * each tool list and each call, so an edit to a bot reaches a session it has
   * already started at once. A session no bot of this one started is answered
   * nothing, which is every session that is not a back session.
   */
  host.registerBindings(wake.bindings);
  /*
   * A back session's question, asked in the main turn that woke it.
   *
   * The request is read off the session's own state, which is what the event
   * names but does not carry, and the answer is sent to the chat it was asked
   * in. A session no main chat is waiting on is left alone: it may be a
   * session of another plugin's, or one whose person's turn has ended.
   */
  const ask = botAsk({
    main: (backSession) => wake.main(backSession),
    request: async (session, id) => {
      const { conn } = await connection();
      const answered = await conn.request('subscribe', { channel: session }) as { snapshot?: { state?: Bag } };
      const list = answered.snapshot?.state?.['inputNeeded'];
      if (!Array.isArray(list)) return undefined;
      const found = list.find((one: unknown) => (
        typeof one === 'object' && one !== null && (one as Bag)['id'] === id
      ));
      return found === undefined ? undefined : found as Bag;
    },
    send,
    problem: (line) => { host.problem(`${name}: ${line}`); },
  });
  host.on('input_needed_set', (event) => {
    void ask.asked(event.session, event.id).catch((error: unknown) => {
      host.problem(`${name}: the request ${event.id} in ${event.session} was not shown: ${reason(error)}`);
    });
  });
  host.on('input_needed_removed', (event) => { ask.withdrawn(event.session, event.id); });
  /*
   * How a back session answers a main turn: the `post_message` tool, which
   * adds what the session says to it, and the end of the session's own turn,
   * which ends it - with no more text after a post, and otherwise as the option
   * `mainTurnPostMessageAbsent` says. The tool finds the chat from the calling
   * session, and the event names the session that ended a turn - neither can
   * name somebody else's.
   */
  host.registerTool(postMessage(wake));
  /*
   * The back turns `turn_start` is still reading, by `openingKey`, and the
   * `turn_end` of each one that ended during the reads.
   */
  const opening = new Map<string, Opening>();
  /*
   * The start of a turn somebody began in a back session.
   *
   * A person who types in the back session itself, or whatever else drives that
   * chat, begins a turn no main chat is waiting on. The main chat shows it as a
   * turn of its own, so the person watching there sees the work and its answer;
   * the wake holds it from then on, as it holds a turn a message woke.
   *
   * A turn this wake woke opens nothing: `woken` holds the main turn it is
   * answering already, and is told the turn began. The back session is found
   * from its row, which names the bot and the person, and the main chat from
   * that bot's row for the person - the one chat a person has with a bot. A
   * chat this host is not running opens nothing, and so does one that has a
   * turn open.
   *
   * The reads take time, and a back turn that fails or is stopped at once ends
   * before the main turn opens. Its `turn_end` is kept in `opening`, and the
   * main turn ends with it as soon as it opens.
   */
  host.on('turn_start', (event) => {
    /*
     * A turn of a back session a main turn waits on: the message it took up,
     * where it was one the wake sent, waits no more, and the main turn is
     * answered by the turn the last of them becomes.
     */
    if (wake.main(event.session) !== undefined) {
      wake.taken(event.session, event.turn, event.queuedMessageId);
      return;
    }
    const key = openingKey(event.session, event.turn);
    const note: Opening = {};
    opening.set(key, note);
    void (async (): Promise<void> => {
      try {
        await store.ready();
        for (const bot of store.all()) {
          const row = await backs.of(bot.id, event.session);
          if (row === undefined) continue;
          const owner = whose(row.user, host.hostName);
          const chatRow = await chats(bot.id).get(rowId([bot.id, owner]));
          const main = chatRow?.['chat'];
          if (typeof main !== 'string' || main === '') return;
          let handle: TurnHandle;
          try {
            handle = turns(main);
          }
          catch {
            return;
          }
          const { conn } = await connection();
          const answered = await conn.request('subscribe', { channel: event.chat }) as { snapshot?: { state?: unknown } };
          const message = messageOfTurn(answered.snapshot?.state, event.turn);
          if (message === undefined) return;
          const text = typeof message['text'] === 'string' ? message['text'] : '';
          /*
           * Whose message it is: a person began this turn, as every turn a person
           * types in a chat is theirs. Nothing where the event names nobody - a
           * turn the back session's own backend began - and the message keeps the
           * origin a person's has.
           */
          const from: MessageFrom | undefined = event.sender === undefined ? undefined : { origin: { kind: 'user' } };
          const turnId = handle.begin(text, from);
          if (turnId === undefined) return;
          /*
           * Nothing waits from here to the `finally` that drops the note, so a
           * `turn_end` that comes later finds the main turn held, as any does.
           */
          wake.began(event.session, main, handle, turnId, event.chat, event.turn);
          if (note.ended !== undefined) ended(note.ended);
          return;
        }
      }
      finally {
        if (opening.get(key) === note) opening.delete(key);
      }
    })().catch((error: unknown) => {
      host.problem(`${name}: the turn ${event.turn} in ${event.session} was not shown: ${reason(error)}`);
    });
  });
  /*
   * The end of a turn: the words it ended with, read off the session's chat.
   *
   * Every turn of the daemon raises the event, so one no main chat is waiting
   * on is left alone rather than read. The session is asked again after the
   * read, because a message that arrived meanwhile woke it again and holds a
   * turn of its own: answering that turn with these words would answer a
   * message nobody sent. A read that fails is reported and the main turn ends
   * with no text, so a person waiting on it is not left waiting on an error
   * they cannot see.
   */
  function ended(event: TurnEndEvent): void {
    const held = wake.main(event.session);
    if (held === undefined) return;
    /*
     * Whether this is still the main turn waiting when the read comes back: a
     * message that arrived meanwhile holds its own turn in the same chat, and
     * these words are not its answer. The handle is the chat's and is the same
     * for every turn in it, so the turn is compared as well.
     */
    const still = (): boolean => {
      const now = wake.main(event.session);
      return now !== undefined && now.handle === held.handle && now.turnId === held.turnId;
    };
    const read = (async (): Promise<string> => {
      const { conn } = await connection();
      const answered = await conn.request('subscribe', { channel: event.chat }) as { snapshot?: { state?: unknown } };
      return textOf(answered.snapshot?.state, event.turn);
    })();
    read.then((text) => {
      if (!still()) return;
      wake.finished(event.session, text, event.status === 'error' ? event.error ?? 'The turn failed' : undefined);
    }, (error: unknown) => {
      host.problem(`${name}: the end of turn ${event.turn} in ${event.chat} was not read: ${reason(error)}`);
      if (!still()) return;
      wake.finished(event.session, '');
    });
  }
  /* A back turn `turn_start` is still reading keeps its end for that read. */
  host.on('turn_end', (event) => {
    const note = opening.get(openingKey(event.session, event.turn));
    if (note !== undefined) {
      note.ended = event;
      return;
    }
    ended(event);
  });
  /*
   * A chat with a bot: a session of its own that runs no model, one JSON line
   * per turn under the daemon's configuration folder. Every message in one,
   * new or resumed, goes to the wake, and so does a stop of one of its turns.
   * See `chat.ts`.
   */
  host.registerAgent(botChatAgent(host.configDir, store, (message, handle) => {
    wake.woken(message, handle).catch((error: unknown) => {
      host.problem(`${name}: a message in ${message.session} was not woken: ${reason(error)}`);
    });
  }, (session, turnId) => {
    wake.stopped(session, turnId).catch((error: unknown) => {
      host.problem(`${name}: the work behind ${turnId} in ${session} was not stopped: ${reason(error)}`);
    });
  }));
};
