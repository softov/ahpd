import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Owner, RecordCollection } from '@ahpd/sdk';

/**
 * The names a bot's chats are addressed by.
 *
 * A bot is a record and a folder, and what a person says to it is said in a
 * chat. `bot://<slug>` is the bot itself, `bot://<slug>/<user>` is one person's
 * main chat with it, and `bot://<slug>/<user>/<name>` is one of the back
 * sessions that chat is answered by - the sessions a message wakes, each on the
 * bot's own harness, so a person continues one or starts a new one by naming it.
 *
 * The `<user>` is the id a person is signed in with rather than the owner they
 * are charged as: `user:ana` is `ana` in the path. A reader who is nobody is
 * this host, which is handed in as `root:<hostName>`, so the main chat of a
 * host with no users directory is named after the machine.
 *
 * The `<name>` is a person's to choose, and a session URI is the host's to
 * mint, so the two are kept as one row in the collection `bots/<slug>/sessions`:
 * the row is what says which session a name is on today.
 *
 * Everything about one bot is in `<configDir>/bots/<slug>/`, so a delete of the
 * bot is a delete of one folder: its record, its main chat rows, its back
 * session rows and its chat logs all go with it.
 */

/** The folder a bot's own data is under, inside the daemon's configuration folder. */
export const BOTS_DIR = 'bots';

/** The collection one bot's main chat rows are kept in. */
export const chatsOf = (slug: string): string => `${BOTS_DIR}/${slug}/chats`;

/** The collection one bot's back session rows are kept in, which this file reads. */
export const sessionsOf = (slug: string): string => `${BOTS_DIR}/${slug}/sessions`;

/** The folder one bot's chat logs are kept in. */
export const logsOf = (configDir: string, slug: string): string => join(configDir, BOTS_DIR, slug, 'logs');

/** The folder the chat rows were kept in before each bot had a folder of its own. */
export const LEGACY_CHATS = 'bot-chats';

/** The folder the back session rows were kept in before each bot had a folder of its own. */
export const LEGACY_SESSIONS = 'bot-sessions';

/** One back session, as it is kept: the three words that name it, and the session they are on. */
export type BackSession = {
  /** The row's id, which `rowId` makes of the three words. */
  id: string;
  /** The bot whose session it is, by slug. */
  bot: string;
  /** Whose it is, as the `<user>` of its path. */
  user: string;
  /** What the person called it. */
  name: string;
  /** The session itself. */
  session: string;
};

/**
 * How much of a row's id is the readable part: forty is a record id, and the
 * hash is nine of them.
 */
const ROW = 31;

/**
 * The row id the words that name one thing are kept under.
 *
 * A record id is lowercase letters, digits and dashes, one to forty of them, so
 * the words are written as one name with everything else a dash and the first
 * eight hex of them sha256'd on the end - the way a state volume is named, and
 * for the same reason: two rows whose readable names meet, `user:a.b` with `x`
 * and `user:a-b` with `x`, still get an id each.
 */
export const rowId = (words: readonly string[]): string => {
  const readable = words.join('.').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, ROW);
  return `${readable}-${createHash('sha256').update(words.join('\0')).digest('hex').slice(0, 8)}`;
};

/**
 * The `<user>` of an owner: the id after the kind.
 *
 * `user:ana` is `ana`, and a reader who is nobody is this host, which the
 * provider hands in as `root:<hostName>` - so the host's own name is what a
 * main chat is called where there is no person to name.
 */
export const userOf = (owner: Owner): string => {
  const at = owner.indexOf(':');
  return at === -1 ? owner : owner.slice(at + 1);
};

/**
 * The owner a path's `<user>` names, which is the other direction of `userOf`.
 *
 * A chat is kept against an owner and a path names an id, so a read has to put
 * one back: everything is a person except this host's own name, which is
 * `root:<hostName>` rather than `user:<hostName>`.
 */
export const whose = (user: string, hostName: string): Owner =>
  (user === hostName ? `root:${hostName}` : `user:${user}`);

/**
 * What one path under a bot names.
 *
 * `sessions` is the directory spelling, which is the path with a slash on the
 * end: it is what a client lists to be shown the names, and the name without it
 * is a file - the main chat a read answers.
 */
export type Named =
  | { at: 'chat'; user: string }
  | { at: 'sessions'; user: string }
  | { at: 'back'; user: string; name: string };

/**
 * What a path under a bot names, or nothing when it names nothing here.
 *
 * A bot's own address has no path at all, so the empty one is nothing: that is
 * the record, and the read road answers it before asking this. Anything deeper
 * than a name is nothing either, because there is no fourth place under a bot.
 * Whether a person or a name is one this host has is not asked here: the rows
 * are what know which names there are, and a read of one nobody has is a read
 * of something absent.
 */
export const named = (path: string): Named | undefined => {
  const parts = path.split('/');
  const user = parts[0] ?? '';
  if (user === '') return undefined;
  if (parts.length === 1) return { at: 'chat', user };
  if (parts.length !== 2) return undefined;
  const name = parts[1] ?? '';
  return name === '' ? { at: 'sessions', user } : { at: 'back', user, name };
};

/**
 * The names of one bot and person's back sessions, as the plugin keeps them.
 *
 * A back session is an ordinary session of the host, and this is the index from
 * the name a person gave it to the session it is: `get` is what a message
 * addresses, `put` is what starting one writes down, and `list` is what a
 * client opening `bot://<slug>/<user>/` is shown.
 *
 * A name is looked up by the id `put` wrote it under, which is the three words
 * made a record id; `list` cannot, because a person chooses their own names, so
 * it asks the collection which rows are this bot's and this person's.
 */
export interface BackSessions {
  /** The session this name is on, or nothing when no row has it. */
  get(bot: string, user: string, name: string): Promise<string | undefined>;
  /**
   * The row one session is named by, or nothing when no row names it.
   *
   * The other direction of `get`: a turn that arrives naming a session says
   * which session it is in and nothing of who started it, and the row says
   * which bot and person that is.
   */
  of(bot: string, session: string): Promise<BackSession | undefined>;
  /** Keep that this name is on this session. */
  put(bot: string, user: string, name: string, session: string): Promise<void>;
  /** The names this person has with this bot, in order. */
  list(bot: string, user: string): Promise<string[]>;
  /**
   * The sessions this bot's rows name, whatever the person and the name.
   *
   * What the wake reads at load to know which of a bot's sessions are the
   * bot's: a session this host still has was started by a bot before this
   * daemon did, and its bindings are the bot's as much as a fresh one's.
   */
  sessions(bot: string): Promise<string[]>;
}

/**
 * The seam over the collections one bot's back session rows are kept in.
 *
 * One collection per bot, because one folder per bot: `rows` answers the
 * collection `bots/<slug>/sessions` of the bot it is asked about, and opens it
 * the first time a name of that bot is read or written.
 */
export const backSessions = (rows: (bot: string) => RecordCollection): BackSessions => ({
  get: async (bot, user, name) => {
    const row = await rows(bot).get(rowId([bot, user, name]));
    const held = row?.['session'];
    return typeof held === 'string' && held !== '' ? held : undefined;
  },

  of: async (bot, session) => {
    const found = (await rows(bot).find({ bot, session }))[0];
    const user = found?.['user'];
    const name = found?.['name'];
    if (typeof user !== 'string' || typeof name !== 'string') return undefined;
    return { id: rowId([bot, user, name]), bot, user, name, session };
  },

  put: async (bot, user, name, session) => {
    const row: BackSession = { id: rowId([bot, user, name]), bot, user, name, session };
    await rows(bot).put(row);
  },

  list: async (bot, user) => {
    const found = await rows(bot).find({ bot, user });
    return found
      .map((row) => row['name'])
      .filter((name): name is string => typeof name === 'string' && name !== '')
      .sort();
  },

  sessions: async (bot) => {
    const found = await rows(bot).find({ bot });
    return found
      .map((row) => row['session'])
      .filter((session): session is string => typeof session === 'string' && session !== '');
  },
});
