import { AGENTS_FILE, makeFolder, partsOf, readAgentsFile, withAgents, writeAgentsFile } from './folder.js';
import { BOT_BODIES, DEFAULT_SESSION, isBotColor, isSlug, withoutParts } from './record.js';
import type { AgentsParts, InstructionsIn, Yaml } from './agents.js';
import type { BotRecord, KeptBot } from './record.js';
import type { RecordChange, RecordCollection, StoredRecord } from '@ahpd/sdk';

/**
 * The bots this daemon keeps, in the record store the host gave it.
 *
 * The `bots` collection holds one record per bot, and the record is what its
 * `AGENTS.md` cannot say: the folder it works in, its owner, the body and
 * colour it is drawn with, the session a message wakes. Its persona - `name`,
 * `description`, `instructions` - is the file's, and the file is the one copy.
 *
 * A record made before that was true still has the persona in it. It is moved
 * into the file on the first load: the file is written with those parts, a file
 * that had none gets a frontmatter on top of the text it already had, and the
 * record is put back without them.
 *
 * A deleted slug leaves a tombstone in `bots-gone`. The slug is what a client
 * has the address of, so a bot deleted and made again under the same name would
 * be a different bot answering to a name somebody already knows; the tombstone
 * is what makes a re-make `-32010` rather than a surprise.
 *
 * The collections answer later, so every read here is answered from a cache
 * that `ready` loads once and the collection's watch keeps current. That is
 * what lets `all`, `get` and `tombstoned` stay synchronous: the provider reads ten
 * times and writes twice, and only the writes wait.
 *
 * No file and no format is named here. What a record looks like on disk is the
 * record store's business, and a plugin that keeps the records in a database
 * takes that business over with one `registerRecords` call.
 */

/** One change to the bots that this store did not make. */
export interface BotChange {
  /** What happened to the bot. */
  type: 'added' | 'updated' | 'deleted';
  /** The bot as it is now; for `deleted`, the record as it was when it went. */
  bot: BotRecord;
  /** The bot as it was before, when the type is `updated`; nothing otherwise. */
  before: BotRecord | undefined;
}

export interface BotStore {
  /** Every bot, in no particular order. */
  all(): BotRecord[];
  /** One bot, or nothing when the slug has none. */
  get(slug: string): BotRecord | undefined;
  /** Whether this slug had a bot that was deleted, and keeps its tombstone. */
  tombstoned(slug: string): boolean;
  /** Read both collections into the cache, once. Every read waits for this. */
  ready(): Promise<void>;
  /** Keep one bot, replacing what the slug held, once the collection has it. */
  put(record: BotRecord): Promise<void>;
  /** Delete one bot, leaving the tombstone behind, once the collection has both. */
  remove(slug: string): Promise<void>;
  /**
   * Hear each change to the collection that this store did not make.
   *
   * The provider gives one, and tells the watchers and the catalogue from it:
   * a bot a person edited by hand reaches both as any other edit does.
   */
  onChange(heard: (change: BotChange) => void): void;
}

/**
 * What one record said, where it is a bot this host can use.
 *
 * The store knows no plugin's record shape, so every field is checked here: a
 * record a person edited by hand can say anything, and a store that answered
 * something else is caught by the same check.
 *
 * Two keys are filled in rather than checked, because a bot with no word for
 * them and a bot whose word nobody has read are the same bot: the body it is
 * drawn with, and the name of the back session a message wakes.
 *
 * The persona is optional here: a record this host wrote has none, because the
 * file is its one copy, and one an older daemon wrote still carries it. What to
 * answer is decided where the file is read, in `withAgents`.
 */
const kept = (said: unknown): KeptBot | undefined => {
  if (typeof said !== 'object' || said === null || Array.isArray(said)) return undefined;
  const one = said as Record<string, unknown>;
  if (typeof one['id'] !== 'string' || !isSlug(one['id'])) return undefined;
  for (const key of ['name', 'description', 'instructions']) {
    if (one[key] !== undefined && typeof one[key] !== 'string') return undefined;
  }
  if (typeof one['workspace'] !== 'string' || typeof one['owner'] !== 'string') return undefined;
  if (typeof one['createdAt'] !== 'string' || typeof one['updatedAt'] !== 'string') return undefined;
  if (!isBotColor(one['color'])) return undefined;
  if (!Array.isArray(one['labels']) || one['labels'].some((label) => typeof label !== 'string')) return undefined;
  // A body is a tag, so any word is kept, and a file with none is drawn with
  // the first suggestion rather than left out of the listing.
  const body = typeof one['body'] === 'string' && one['body'].trim() !== '' ? one['body'] : BOT_BODIES[0];
  /*
   * And a back session's name, which a file that names none has as `work`: a
   * bot this host answers always names the session a message wakes, so nothing
   * that reads one has to know what the default is. Whether the name is one a
   * session can have is not asked here - a hand-written name that is no name is
   * refused where the message arrives, by the wake.
   */
  const session = typeof one['session'] === 'string' && one['session'].trim() !== '' ? one['session'].trim() : DEFAULT_SESSION;
  const rest: Record<string, unknown> = { ...one, body, session };
  return rest as unknown as KeptBot;
};

/** Whether two records say the same thing, whatever order their fields are in. */
const same = (one: BotRecord, other: BotRecord): boolean => {
  const left = one as unknown as Record<string, unknown>;
  const right = other as unknown as Record<string, unknown>;
  for (const field of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (JSON.stringify(left[field]) !== JSON.stringify(right[field])) return false;
  }
  return true;
};

/**
 * Whether a file read back holds the parts a write asked it to.
 *
 * The instructions are asked for as a prefix rather than as the whole section:
 * a file with no section gets one above the text the bot already had, and that
 * text then reads as the rest of the section.
 */
const holds = (wanted: AgentsParts, got: AgentsParts): boolean =>
  got.name.trim() === wanted.name.trim()
  && got.description.trim() === wanted.description.trim()
  && got.instructions.trim().startsWith(wanted.instructions.trim());

/**
 * What the store reads a bot's folder with.
 *
 * Both are the plugin's own seams rather than anything this file does for
 * itself: the YAML is the host's, and the filled template is read from the
 * `templates` collection and the default file. A store given neither - as the
 * cases that build one over records alone do - keeps each record's parts in the
 * cache and writes no file.
 */
export interface BotStoreSeams {
  /** The YAML a bot's `AGENTS.md` is read and written with. */
  yaml?: Yaml;
  /** Where a bot's instructions are in its `AGENTS.md`: its own section unless this says the body. */
  instructionsIn?: InstructionsIn;
  /** The `AGENTS.md` a bot with no file is given: its template, filled with its words. */
  agents?(bot: BotRecord): Promise<string>;
}

/**
 * The bots in one record store, over the `bots` and `bots-gone` collections.
 *
 * `onProblem` is told about each record that was there and could not be used,
 * one line each, and the store keeps everything else.
 */
export function botStore(
  bots: RecordCollection,
  graves: RecordCollection,
  onProblem: (line: string) => void,
  seams: BotStoreSeams = {},
): BotStore {
  /** Every bot this store has read, by slug. */
  const held = new Map<string, BotRecord>();
  /** Every slug that had a bot and lost it: the tombstones, as VS Code names a deleted record's marker. */
  const tombstoned = new Set<string>();
  /** The one load of both collections, which every read waits for. */
  let loading: Promise<void> | undefined;
  /** The provider's ear for a change this store did not make. */
  let heard: ((change: BotChange) => void) | undefined;
  /*
   * The slugs this store is writing or removing right now.
   *
   * A collection tells its watchers what a put or a remove did, its own caller
   * included, and that caller moves the cache itself once the collection has
   * answered. The echo is dropped here rather than compared away, because at
   * the moment it arrives the cache has not moved yet.
   */
  const writing = new Set<string>();

  /** Leave the tombstone a slug needs, if it is not there already. */
  const tombstone = async (slug: string): Promise<void> => {
    if (tombstoned.has(slug)) return;
    await graves.put({ id: slug, deletedAt: new Date().toISOString() });
  };

  /**
   * Take one change the store did not make, once the collection has it.
   *
   * A record a person edited by hand can say anything, so it is read as any
   * other record is, through `kept`. The two fields a hand edit may not change
   * are refused here, because nothing before this point has seen the record.
   * So is a bot whose slug has a tombstone: its file came back after the
   * delete, and the name it would answer to is spent.
   */
  const take = async (change: RecordChange): Promise<void> => {
    if (change.type === 'deleted') {
      const before = held.get(change.id);
      // A slug nothing here held: this store has no change to make or to tell.
      if (before === undefined) return;
      held.delete(change.id);
      /*
       * A bot deleted by hand leaves the tombstone a delete through the scheme
       * leaves. The record is gone and nothing says who took it, so the name is
       * spent rather than handed to another bot.
       */
      await tombstone(change.id);
      tombstoned.add(change.id);
      heard?.({ type: 'deleted', bot: before, before: undefined });
      return;
    }
    // A file that came back after its tombstone is the older copy of a bot
    // whose name is spent, and nothing of it is a bot this host answers.
    if (tombstoned.has(change.id)) {
      onProblem(`bots/${change.id} has a tombstone; the name is spent and it was left out`);
      return;
    }
    const said = await bots.get(change.id);
    // It went again before this read: the delete that follows says so.
    if (said === undefined) return;
    const one = kept(said);
    if (one === undefined) {
      onProblem(`bots/${change.id} is not a bot record; the bot was left as it was`);
      return;
    }
    // The record's parts where it still carries some - the older copy a load
    // moves - and the file's everywhere else. A hand edit of the record alone
    // therefore answers with the persona the bot's own file has.
    const bot = withAgents(seams.yaml, one, seams.instructionsIn);
    const before = held.get(bot.id);
    if (before !== undefined && before.owner !== bot.owner) {
      onProblem(`bots/${bot.id} changed owner; the bot was left as it was`);
      return;
    }
    if (before !== undefined && before.workspace !== bot.workspace) {
      onProblem(`bots/${bot.id} changed workspace; the bot was left as it was`);
      return;
    }
    // A write of what is already here moved nothing, and is not a change.
    if (before !== undefined && same(before, bot)) return;
    held.set(bot.id, bot);
    heard?.({ type: before === undefined ? 'added' : 'updated', bot, before });
  };

  /** Whether this record is from before the file was the one copy: it still carries a part. */
  const older = (one: KeptBot): boolean =>
    one.computer === undefined
    && (one.name !== undefined || one.description !== undefined || one.instructions !== undefined);

  /**
   * Move an older record's parts into its `AGENTS.md`, and put the record back
   * without them.
   *
   * A folder that has a file keeps every byte the bot wrote: the parts go into
   * its frontmatter and its Instructions section, and the rest stays below. A
   * folder with no file is made with the bot's template, filled with its words,
   * which is the file a bot made today would have had from its first moment.
   *
   * The record is put back only once the file reads back with the parts, and a
   * file this host cannot read is written over by nothing: either one leaves
   * the record as the copy, and the next load tries again rather than dropping
   * the persona between the two.
   */
  const move = async (one: KeptBot, yaml: Yaml): Promise<BotRecord> => {
    const at = seams.instructionsIn;
    const bot = withAgents(yaml, one, at);
    const parts = partsOf(bot);
    try {
      const file = readAgentsFile(bot.workspace, yaml, at);
      if (file.kind === 'unreadable') {
        onProblem(`bots/${bot.id} was left in its record: its ${AGENTS_FILE} cannot be read: ${String(file.error)}`);
        return bot;
      }
      if (file.kind === 'parts') {
        writeAgentsFile(bot.workspace, yaml, parts, at);
      }
      else if (seams.agents !== undefined) {
        makeFolder(bot.workspace, await seams.agents(bot), yaml, parts, at);
      }
      else {
        writeAgentsFile(bot.workspace, yaml, parts, at);
      }
      /*
       * Read back before the record gives the parts up: a write that reached no
       * file has nothing to answer them, and the record is the only copy left.
       */
      const back = readAgentsFile(bot.workspace, yaml, at);
      if (back.kind !== 'parts' || !holds(parts, back.parts)) {
        onProblem(`bots/${bot.id} was left in its record: its ${AGENTS_FILE} does not read back with those parts`);
        return bot;
      }
      // This store's own put, dropped from the watch the way every other put
      // is: the record says what the cache already does.
      writing.add(bot.id);
      try {
        await bots.put(withoutParts(bot));
      }
      finally {
        writing.delete(bot.id);
      }
    }
    catch (error) {
      onProblem(`bots/${bot.id} was not moved into its AGENTS.md: ${String(error)}`);
    }
    return bot;
  };

  /**
   * Read both collections into the cache, once.
   *
   * A collection waits for the fold that names the record store, so this cannot
   * run while the plugin applies: it is a promise the first call waits for, not
   * something `apply` does before it returns.
   */
  const load = async (): Promise<void> => {
    /*
     * The watch first, so a change made while the two listings are read is
     * taken as well. The collection opens on its first call either way, and a
     * watch asked for before that sees everything from the moment it opens.
     */
    bots.watch((change) => {
      if (writing.has(change.id)) return;
      take(change).catch((error: unknown) => {
        onProblem(`bots/${change.id} could not be read: ${String(error)}`);
      });
    });
    const yaml = seams.yaml;
    /*
     * The tombstones first, so a bot file that came back after its delete is
     * known to be one before it is read: a tombstone is a record too, and only
     * its id is read - it says which slug was a bot, never what that bot was.
     */
    for (const said of await graves.list()) tombstoned.add(said.id);
    for (const said of await bots.list()) {
      const one = kept(said);
      if (one === undefined) {
        onProblem(`bots/${said.id} is not a bot record; it was left out`);
        continue;
      }
      if (tombstoned.has(one.id)) {
        onProblem(`bots/${one.id} has a tombstone; the name is spent and it was left out`);
        continue;
      }
      // A record made before the file was the one copy is moved into its file
      // here, once, rather than at every read: the next daemon to load it finds
      // a record with no parts.
      held.set(one.id, yaml !== undefined && older(one) ? await move(one, yaml) : withAgents(yaml, one, seams.instructionsIn));
    }
  };

  const ready = (): Promise<void> => {
    loading ??= load();
    return loading;
  };

  /** In the order a listing shows them, which is the order a slug sorts in. */
  const sorted = (): BotRecord[] => [...held.values()].sort((one, other) => (one.id < other.id ? -1 : one.id > other.id ? 1 : 0));

  return {
    all: sorted,
    get: (slug) => held.get(slug),
    tombstoned: (slug) => tombstoned.has(slug),
    ready,
    onChange: (one) => { heard = one; },
    put: async (record) => {
      // The file has the parts by now - the provider wrote them before it got
      // here - so the record keeps what the file cannot say. A bot on a computer
      // keeps its parts, because this host cannot reach its file, and so does
      // every bot of a store with no YAML: a store that writes no file has no
      // other copy to keep them in.
      const stored: StoredRecord = record.computer === undefined && seams.yaml !== undefined
        ? withoutParts(record)
        : { ...record };
      writing.add(record.id);
      try {
        // The collection first: a write that failed is a cache that never moved.
        await bots.put(stored);
      }
      finally {
        writing.delete(record.id);
      }
      held.set(record.id, record);
    },
    remove: async (slug) => {
      writing.add(slug);
      try {
        // The tombstone first, so a failure between the two leaves a name that
        // can never be made again rather than one that quietly can.
        await tombstone(slug);
        await bots.remove(slug);
      }
      finally {
        writing.delete(slug);
      }
      held.delete(slug);
      tombstoned.add(slug);
    },
  };
}
