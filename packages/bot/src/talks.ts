import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { logsOf } from './names.js';
import type { Owner } from '@ahpd/sdk';
import type { FrontSessions } from './names.js';

/**
 * One person's talk with one bot: the one `bot-chat` session they have with it.
 *
 * A person has one session with each bot, so the bot keeps its memory of that
 * person from one talk to the next. The session is written down in the bot's
 * `fronts` rows when it is made, because a plugin cannot list the host's
 * sessions. A read of the bot answers it, and a second create for the same
 * person is refused naming it, unless the option `secondSession` is `allow`.
 *
 * A person who talked to a bot before the rows were kept has no row. Their last
 * used session with it becomes theirs: the newest Front log of that bot whose
 * session the host still holds and that person owns.
 */

/** What a second create for the same bot and person gets, as the option `secondSession` says. */
export type SecondSession = 'refuse' | 'allow';

/** Every value `secondSession` takes. */
export const SECOND_SESSIONS: readonly SecondSession[] = ['refuse', 'allow'];

/** Whether a value is one `secondSession` takes. */
export const isSecondSession = (value: unknown): value is SecondSession =>
  typeof value === 'string' && (SECOND_SESSIONS as readonly string[]).includes(value);

/** What the talks read through. */
export interface TalkSeams {
  /** The Front rows. */
  fronts: FrontSessions;
  /** The daemon's configuration folder, where each bot's Front logs are. */
  configDir: string;
  /** Whether the host still holds a session at this URI. */
  kept(uri: string): Promise<boolean>;
  /** Whose the session at this URI is, or nothing where the host has none. */
  owner(uri: string): Promise<Owner | undefined>;
}

/** The talks of every bot with every person. */
/**
 * Who a talk is kept for: the session's owner, with every `root:` owner as
 * `root`, and no owner, on a host with no users, as `root` too. The host's own
 * owner names the machine it runs on, so a talk kept under it is still the
 * root's when the configuration moves to another machine.
 */
export const talkerOf = (owner: Owner | undefined): string =>
  owner === undefined || owner.startsWith('root:') ? 'root' : owner;

export interface Talks {
  /** The option `secondSession`. */
  second: SecondSession;
  /** The session this person talks to this bot in, where the host still holds one. */
  of(bot: string, owner: Owner | undefined): Promise<string | undefined>;
  /** Write down the session this person talks to this bot in. */
  keep(bot: string, owner: Owner | undefined, session: string): Promise<void>;
}

/** The URIs a talk's session with this id may be held under: a window's own, and the older one named by the provider. */
export const urisOf = (id: string): string[] => [`ahp-session:/${id}`, `bot-chat:/${id}`];

/** The session ids of one bot's Front logs, newest first. */
const logIds = (dir: string): string[] => {
  let names: string[];
  try { names = readdirSync(dir); }
  catch { return []; }
  const found: { id: string; at: number }[] = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    let id: string;
    try { id = decodeURIComponent(name.slice(0, -'.jsonl'.length)); }
    catch { continue; }
    if (id === '') continue;
    let at: number;
    try { at = statSync(join(dir, name)).mtimeMs; }
    catch { continue; }
    found.push({ id, at });
  }
  return found.sort((one, other) => other.at - one.at).map((one) => one.id);
};

export function botTalks(seams: TalkSeams, second: SecondSession = 'refuse'): Talks {
  /** The last used session from before the rows were kept, and the row written for it. */
  const fromLogs = async (bot: string, owner: Owner | undefined): Promise<string | undefined> => {
    for (const id of logIds(logsOf(seams.configDir, bot))) {
      for (const uri of urisOf(id)) {
        if (!await seams.kept(uri)) continue;
        if (talkerOf(await seams.owner(uri)) !== talkerOf(owner)) continue;
        await seams.fronts.put(bot, talkerOf(owner), uri);
        return uri;
      }
    }
    return undefined;
  };
  return {
    second,
    of: async (bot, owner) => {
      const held = await seams.fronts.get(bot, talkerOf(owner));
      if (held !== undefined && await seams.kept(held)) return held;
      return await fromLogs(bot, owner);
    },
    keep: async (bot, owner, session) => {
      await seams.fronts.put(bot, talkerOf(owner), session);
    },
  };
}
