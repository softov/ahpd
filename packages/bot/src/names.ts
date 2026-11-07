import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Owner, RecordCollection } from '@ahpd/sdk';

/**
 * The names a bot's back sessions are kept by.
 *
 * A bot is a record and a folder, and the work a message to it wakes is done
 * in a back session, on the bot's own harness: the session its record names,
 * `work` unless somebody chose another, which one person continues by that
 * name. The name is the bot's and the person's to choose, and a session URI is
 * the host's, so the two are kept as one row in the collection
 * `bots/<slug>/sessions`: the row is what says which session a name is on
 * today. A person is the id they are signed in with, `user:ana` being `ana`.
 *
 * Everything about one bot is in `<configDir>/bots/<slug>/`, so a delete of the
 * bot is a delete of one folder: its record, its back session rows and its
 * chat logs all go with it.
 */

/** The folder a bot's own data is under, inside the daemon's configuration folder. */
export const BOTS_DIR = 'bots';

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
  /** Whose it is, as `userOf` names a person. */
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
 * A person of an owner: the id after the kind, `user:ana` being `ana`, and this
 * host's own `root:<hostName>` being its name.
 */
export const userOf = (owner: Owner): string => {
  const at = owner.indexOf(':');
  return at === -1 ? owner : owner.slice(at + 1);
};

/**
 * The names of one bot and person's back sessions, as the plugin keeps them.
 *
 * A back session is an ordinary session of the host, and this is the index from
 * the name a person gave it to the session it is: `get` is what a message
 * addresses and `put` is what starting one writes down. A name is looked up by
 * the id `put` wrote it under, which is the three words made a record id.
 */
export interface BackSessions {
  /** The session this name is on, or nothing when no row has it. */
  get(bot: string, user: string, name: string): Promise<string | undefined>;
  /** Keep that this name is on this session. */
  put(bot: string, user: string, name: string, session: string): Promise<void>;
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

  put: async (bot, user, name, session) => {
    const row: BackSession = { id: rowId([bot, user, name]), bot, user, name, session };
    await rows(bot).put(row);
  },

  sessions: async (bot) => {
    const found = await rows(bot).find({ bot });
    return found
      .map((row) => row['session'])
      .filter((session): session is string => typeof session === 'string' && session !== '');
  },
});
