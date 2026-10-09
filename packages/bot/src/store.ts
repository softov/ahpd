import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BOT_BODIES, BOT_COLORS, isSlug } from './record.js';
import type { BotRecord } from './record.js';

/**
 * Where this daemon keeps its bots.
 *
 * One JSON file per bot, under `<configDir>/bots/`, named for the slug - the
 * same slug that is the bot's URI path and its `id`. A bot is a record somebody
 * is looking at rather than a tree anybody edits, so a file per bot is what
 * lets a person read one, copy one between hosts, and see at a glance what this
 * daemon holds.
 *
 * A deleted slug leaves a tombstone in `<configDir>/bots-gone/`. The slug is
 * what a client has the address of, so a bot deleted and made again under the
 * same name would be a different bot answering to a name somebody already
 * knows; the tombstone is what makes a re-make `-32010` rather than a surprise.
 *
 * Read once, when the daemon starts, and written through from then on - the way
 * every other store here is kept. A file that cannot be read is reported and
 * skipped rather than fatal: one bad record is not every bot gone.
 */
export interface BotStore {
  /** Every bot, in no particular order. */
  all(): BotRecord[];
  /** One bot, or nothing when the slug has none. */
  get(slug: string): BotRecord | undefined;
  /** Whether this slug had a bot that was deleted. */
  gone(slug: string): boolean;
  /** Keep one bot, replacing what the slug held. */
  put(record: BotRecord): void;
  /** Delete one bot, leaving the tombstone behind. */
  remove(slug: string): void;
}

/** The folder a deleted slug's tombstone goes in. */
const GONE = 'bots-gone';

/** One file, written whole: a temporary beside it, then renamed over it. */
const written = (file: string, body: unknown): void => {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  rmSync(temporary, { force: true });
  // 0600: what a bot is asked to be is nobody else's to read.
  writeFileSync(temporary, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
};

/** What one file said, where it is a bot this host can use. */
const kept = (slug: string, said: unknown): BotRecord | undefined => {
  if (typeof said !== 'object' || said === null || Array.isArray(said)) return undefined;
  const one = said as Record<string, unknown>;
  if (one['id'] !== slug) return undefined;
  if (typeof one['name'] !== 'string' || one['name'].trim() === '') return undefined;
  if (typeof one['workspace'] !== 'string' || typeof one['owner'] !== 'string') return undefined;
  if (typeof one['createdAt'] !== 'string' || typeof one['updatedAt'] !== 'string') return undefined;
  if (!(BOT_BODIES as readonly string[]).includes(String(one['body']))) return undefined;
  if (!(BOT_COLORS as readonly string[]).includes(String(one['color']))) return undefined;
  if (!Array.isArray(one['labels']) || one['labels'].some((label) => typeof label !== 'string')) return undefined;
  return said as BotRecord;
};

/** The `.json` files in one folder, as slugs, or nothing when it is not there. */
const slugsIn = (folder: string): string[] => {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((one) => one.isFile() && one.name.endsWith('.json'))
      .map((one) => one.name.slice(0, -'.json'.length));
  }
  catch {
    // A folder that is not there is a daemon that has never had one of these.
    return [];
  }
};

/**
 * The bots under one configuration folder.
 *
 * `onProblem` is told about each file that was there and could not be used, one
 * line each, and the store keeps everything else.
 */
export function botStore(configDir: string, onProblem: (line: string) => void): BotStore {
  const folder = join(configDir, 'bots');
  const graves = join(configDir, GONE);

  const bots = new Map<string, BotRecord>();
  const dead = new Set<string>(slugsIn(graves));

  for (const slug of slugsIn(folder)) {
    if (!isSlug(slug)) {
      onProblem(`${folder}/${slug}.json is not a bot: its name is not a slug`);
      continue;
    }
    let said: unknown;
    try {
      said = JSON.parse(readFileSync(join(folder, `${slug}.json`), 'utf8'));
    }
    catch (error) {
      onProblem(`${folder}/${slug}.json could not be read: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const one = kept(slug, said);
    if (one === undefined) {
      onProblem(`${folder}/${slug}.json is not a bot record; its slug was left out`);
      continue;
    }
    bots.set(slug, one);
  }

  /** In the order a listing shows them, which is the order a slug sorts in. */
  const sorted = (): BotRecord[] => [...bots.values()].sort((one, other) => (one.id < other.id ? -1 : one.id > other.id ? 1 : 0));

  return {
    all: sorted,
    get: (slug) => bots.get(slug),
    gone: (slug) => dead.has(slug),
    put: (record) => {
      written(join(folder, `${record.id}.json`), record);
      bots.set(record.id, record);
    },
    remove: (slug) => {
      bots.delete(slug);
      dead.add(slug);
      written(join(graves, `${slug}.json`), { id: slug, deletedAt: new Date().toISOString() });
      rmSync(join(folder, `${slug}.json`), { force: true });
    },
  };
}
