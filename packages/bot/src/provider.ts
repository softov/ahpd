import { rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { RpcError } from '@ahpd/sdk';
import { covers, ownerFilter, ownerOfPrincipal } from '@ahpd/sdk';
import { instructionsProblem } from './agents.js';
import { CHAT_PROVIDER } from './chat.js';
import { AGENTS_FILE, fromAgents, makeFolder, partsOf, readAgentsFile, writeAgentsFile } from './folder.js';
import { named, rowId, userOf, whose } from './names.js';
import {
  BOT_BODIES, BOT_COLORS, checkRecord, DEFAULT_SESSION, isSlug, TURN_WORD,
} from './record.js';
import { DEFAULT_TEMPLATE, templateOf } from './template.js';
import type { Yaml } from './agents.js';
import type { BackSessions } from './names.js';
import type { BotCatalogue } from './catalogue.js';
import type { BotRecord } from './record.js';
import type { BotStore } from './store.js';
import type { BotTemplates } from './template.js';
import type {
  Bag, Entry, Metadata, Owner, Principal, Read, RecordCollection, ResourceChange, ResourceProvider, SchemeDescription,
  SessionRequest, Watcher, WatchOptions, Write,
} from '@ahpd/sdk';

/**
 * The `bot:` scheme.
 *
 * A bot is a record a person makes, edits and deletes through the four commands
 * every resource has. A write to `bot://<slug>` with `createOnly` makes one and
 * a write with `ifMatch` edits it, a read answers its record, a list answers
 * the bots the reader may see, and a delete leaves a tombstone behind.
 *
 * The record is what the bot's `AGENTS.md` cannot say: the folder it works in,
 * its owner, the body and colour it is drawn with, the session a message wakes.
 * Its `name`, `description` and `instructions` are the file's, so a read puts
 * those parts on the record from the file, and a make or an edit writes them to
 * the file. An edit the bot made to its own file is therefore what the next read
 * answers, and the record never carries a second copy to go stale.
 *
 * A bot's own address is the slug, and a read of it answers the record. Under it
 * are the chats: `bot://<slug>/<user>` is one person's main chat with the bot,
 * `bot://<slug>/<user>/` is the names of that person's back sessions, and
 * `bot://<slug>/<user>/<name>` is one of them. What those names mean is
 * `names.ts`; anything else under a bot is a URI this host has nothing at.
 *
 * Who may see what is asked of `authorize` for reads and listings, and the
 * grant for everything else: the owner of a bot, a member of the team or
 * project it belongs to, and a holder of `bot:get` may read one, and a holder
 * of `bot:list` sees every one there is.
 *
 * A read answers the record with one key more: `chat`, the reader's own direct
 * chat with that bot. Who may chat is who may read it and then either holds
 * `bot:chat` or owns it, and a reader who may not is answered the record alone.
 * The chat is started the first time one is asked for, kept against the bot and
 * the person in the bot's own `chats` collection, so the next read is the same
 * chat.
 *
 * The paths under a bot are those chats: a read of `bot://<slug>/<user>` answers
 * `chat`, the same session a read of the bot hands that person, and a read of
 * `bot://<slug>/<user>/<name>` answers `session`, the session that name was
 * started as - kept per name in the bot's own `sessions` collection. Neither is part
 * of the record, so neither is answered to everybody who may read the bot: a
 * person's chats are the person's, the bot's owner's and this host's.
 *
 * Who may change one is asked on the write and delete roads, and it is the
 * read road's list plus the host's own key: its owner, a member of the team or
 * project it belongs to, a holder of `*:*`, and this host. The grant that
 * makes a bot - `bot:put` - is not one of them, so a maker may make a bot of
 * their own and rewrite nobody else's.
 *
 * Who a bot may belong to is asked on the write road, with the same rule the
 * read road uses: a `team:` or `project:` named as the owner has to be one the
 * writer belongs to, so a bot is never made for a team its maker is outside of.
 * A holder of `*:*` may name any owner, the host among them.
 *
 * Any `root:` owner is this host. The name after it is the machine's hostname
 * when the record was written, and a renamed machine is the same host, so a
 * bot or a session that names an older one is still the host's.
 */

/**
 * The sessions this host keeps, as much of them as a bot is about.
 *
 * Read through the host rather than held here, the way `store` lives beside the
 * daemon: a chat is a session this host holds, and one it no longer holds - a
 * daemon that restarted - is a chat that is started again.
 */
export interface BotSessions {
  /** Whose the session at this URI is, or nothing where this host has none. */
  owner(uri: string): Promise<Owner | undefined>;
  /**
   * Start a session for the owner the request names, and answer its URI.
   *
   * `named` is called with the URI before the session is made, which is what
   * lets the wake answer for it - its connectors - from the first tool list the
   * backend is spawned with.
   */
  start(wanted: SessionRequest, named?: (uri: string) => void): Promise<string>;
}

/** What the provider was configured with. */
export interface BotOptions {
  /** The folder a bot's own workspace is under, as `<root>/<slug>`. */
  root: string;
  /**
   * The folder the record store keeps the bots in, `<configDir>/bots`.
   *
   * Every bot's data is in `<botsDir>/<slug>/`: the record is `bot.md`, the
   * main chat rows are in `chats/`, the back session rows in `sessions/` and
   * the logs in `logs/`. A delete of a bot removes that folder, which is the
   * whole of what the daemon kept of it.
   */
  botsDir: string;
  /** Where the records are kept. */
  store: BotStore;
  /** The host's sessions, where the chat a read opens is started. */
  sessions: BotSessions;
  /**
   * The main chat rows of one bot, in the collection `bots/<slug>/chats`.
   *
   * A call opens or answers the same collection each time, so the row a read
   * of the bot writes is the one a wake of its chat finds.
   */
  chats(bot: string): RecordCollection;
  /** The index of bot, person and name to the session that name is on. */
  backSessions: BackSessions;
  /**
   * What this host is called, for a bot made by work nobody is a person for.
   *
   * A connection that is neither a person nor the root one is handed no owner,
   * and a root connection on a host with no users directory is handed none
   * either - and a bot's owner is required, because it is what a listing and a
   * session started for it are charged to. `root:<hostName>` is what this host
   * calls itself, so that is whose bot it is.
   */
  hostName: string;
  /** The `x-ahpd-bots://` catalogue, told each make, edit and delete. */
  catalogue?: BotCatalogue;
  /** The templates a bot may name, read to refuse one that is not there. */
  templates: BotTemplates;
  /** The YAML a bot's `AGENTS.md` is read and written with. */
  yaml: Yaml;
  /**
   * The `AGENTS.md` a bot with no file is given: its template, filled with its
   * words.
   *
   * A make has no file to keep, so the file it leaves behind is the one its
   * template names, filled with what it was made as - not the bare parts an
   * edit writes, which would lose the sections a template adds.
   */
  agents(bot: BotRecord): Promise<string>;
  /**
   * Whether an owner may start a session on the agent a bot names, read at each
   * write.
   *
   * A bot's `preset` or `harness` is an agent of this host, and the host asks
   * its own rule of whoever starts a session on one. A write names it for the
   * bot's owner rather than for the person making the change, so the same rule
   * is asked here: one person cannot point their bot at another person's agent.
   * Absent on a host that checks nothing, where every agent is the daemon's.
   */
  mayUse?(owner: Owner, provider: string | undefined): boolean;
  /**
   * Whether this host serves an agent of this id, asked at each read.
   *
   * A bot names its agent by id, and a record that names one this host no
   * longer serves - a plugin removed, an agent record deleted - is answered
   * `state: 'unavailable'` rather than waking nothing without a word. Absent on
   * a host that has no agents to check against, where nothing is marked.
   */
  available?(provider: string): boolean;
}

/**
 * What this provider implements.
 *
 * Narrower than `ResourceProvider`, whose read methods are optional: this one
 * has all of them and a caller holding it should not have to test for what is
 * always there.
 */
export interface BotProvider extends ResourceProvider {
  list(uri: string, reader?: Principal): Promise<Entry[]>;
  resolve(uri: string, followSymlinks?: boolean): Promise<Metadata>;
  read(uri: string, wanted?: string, reader?: Principal): Promise<Read>;
  write(uri: string, content: Write, owner?: Owner, client?: string, reader?: Principal): Promise<void>;
  remove(uri: string, recursive?: boolean, owner?: Owner, reader?: Principal): Promise<void>;
  watch(uri: string, options: WatchOptions, onChange: (changes: ResourceChange[]) => void, reader?: Principal): Promise<Watcher>;
  describe(): SchemeDescription;
  authorize(uri: string, reader: Principal | undefined): Promise<boolean>;
}

/** A URI, split into the slug it names and the path under it. */
interface At {
  /** The slug, empty at the root. */
  slug: string;
  /** Whatever came after a further slash: the chat, or the chat's own name. */
  leaf: string;
  /** The text after `?`, which only the root listing reads. */
  query: string;
}

/**
 * `bot://<slug>` and `bot:/<slug>` are the same address.
 *
 * A client pastes a URI it was handed and a person types one, and the two
 * spellings are one character apart for the same resource. Both are read the
 * same way rather than one of them being a mistake. The query is kept apart
 * from the path, so `bot://?owner=me` is the root listing asked for the
 * caller's own rather than a bot named `?owner=me`.
 */
const split = (uri: string): At | undefined => {
  const match = /^([a-zA-Z][\w+.-]*):\/\/?(.*)$/.exec(uri);
  if (match === null || match[1] !== 'bot') return undefined;
  const rest = match[2] ?? '';
  const mark = rest.indexOf('?');
  const path = mark === -1 ? rest : rest.slice(0, mark);
  const query = mark === -1 ? '' : rest.slice(mark + 1);
  const slash = path.indexOf('/');
  return slash === -1
    ? { slug: path, leaf: '', query }
    : { slug: path.slice(0, slash), leaf: path.slice(slash + 1), query };
};

const absent = (uri: string): RpcError => new RpcError(-32008, `No bot at ${uri}`);

/** The refusal a back session no row names is owed. */
const noSession = (uri: string): RpcError => new RpcError(-32008, `No back session at ${uri}`);

/** The refusal a change to somebody else's bot is owed. */
const notYours = (bot: BotRecord): RpcError => new RpcError(
  -32009,
  `Only the owner of ${bot.id}, a member of its team or project, an admin or this host may change it`,
);

/** The refusal a look into somebody else's chats is owed. */
const notTheirs = (bot: BotRecord, user: string): RpcError => new RpcError(
  -32009,
  `Only ${user}, the owner of ${bot.id} or this host may read these chats`,
);

const at = (uri: string): At => {
  const held = split(uri);
  if (held === undefined) throw new RpcError(-32602, `${uri} is not a bot: URI`);
  return held;
};

/**
 * One moment, as a URI's metadata wants it, or nothing for a time that cannot
 * be read: the protocol's resolve carries a time only when it is known.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/common/commands.ts#L1082-L1085
 */
const moment = (iso: string): string | undefined => {
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? undefined : when.toISOString();
};

/** The bytes of a write, whichever encoding they arrived in. */
const bodyText = (content: Write): string => (content.encoding === 'base64'
  ? Buffer.from(content.data, 'base64').toString('utf8')
  : content.data);

/** The body a write carried, or the refusal a body that is not JSON is owed. */
const parsed = (uri: string, content: Write): unknown => {
  const text = bodyText(content).trim();
  if (text === '') throw new RpcError(-32602, `${uri} is made from an object with a name`);
  try {
    return JSON.parse(text);
  }
  catch {
    throw new RpcError(-32602, `${uri} is made from JSON`);
  }
};

/**
 * The body a write to the scheme's root makes one from.
 *
 * Built from the host's name, because the `owner` property names this host's
 * own owner as a `const`: a client is told `user:<id>` for a person, never the
 * host's key, so it sends the one it is handed here.
 */
const manifest = (hostName: string) => ({
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', description: 'What a person called it.' },
    labels: { type: 'array', items: { type: 'string' }, description: 'Words a client groups bots by.' },
    description: { type: 'string', description: 'One line about it, for a list of bots.' },
    body: { type: 'string', examples: [...BOT_BODIES], description: 'Which body it is drawn with: any word, and these are the suggestions.' },
    color: {
      type: 'string',
      anyOf: [{ enum: [...BOT_COLORS] }, { pattern: '^#[0-9a-fA-F]{6}$' }],
      description: 'Which colour it is drawn in: a name, or `#rrggbb`.',
    },
    instructions: { type: 'string', description: 'What it was asked to be, in its own words.' },
    template: { type: 'string', description: 'The template a chat with it would open with, by name. Absent is the default.' },
    harness: { type: 'string', description: 'The backend a session of it runs on.' },
    model: { type: 'string', description: 'The model it asks for.' },
    preset: { type: 'string', description: 'The session preset it starts from.' },
    session: {
      type: 'string',
      description: `The name of the back session a message to it wakes, as a slug, or one with ${TURN_WORD} in it for a session of its own per message. Absent is ${DEFAULT_SESSION}.`,
    },
    workspace: { type: 'string', description: 'The folder it works in, under the plugin root. Its own, and never moved.' },
    computer: { type: 'string', description: 'The machine it runs in.' },
    // Named here because a write takes it, and a schema a client follows says
    // every field the receiver accepts, as the schemas VS Code publishes do.
    connectors: {
      type: 'object',
      propertyNames: { pattern: '^[a-z][a-z0-9-]{0,39}$' },
      additionalProperties: { type: 'string', pattern: '^connectors://[^/]+/.+$' },
      description: 'The connectors its sessions may use, by alias: the word a model says, and the connectors://<adapter>/<id> it stands for.',
    },
    owner: {
      type: 'string',
      anyOf: [{ type: 'string' }, { const: `root:${hostName}`, title: 'This host' }],
      description: "Whose it is, as user:<id>, team:<team> or project:<team>:<project>. The maker where a body names none, and a team or project has to be one the maker belongs to. An admin may name any owner, this host among them.",
    },
  },
  additionalProperties: false,
} as const);

/**
 * Whether this reader may see this bot.
 *
 * Three ways in, and no others: it is theirs, they belong to the team or
 * project it belongs to, or they hold the grant that reads every bot - which is
 * what makes a scheme the host's rather than each maker's.
 */
export const mayRead = (bot: BotRecord, reader: Principal): boolean => {
  if (reader.can('bot:get')) return true;
  if (bot.owner === `user:${reader.id}`) return true;
  const memberships = reader.memberships ?? [];
  if (bot.owner.startsWith('team:')) return covers(memberships, bot.owner.slice('team:'.length));
  if (bot.owner.startsWith('project:')) return covers(memberships, bot.owner.slice('project:'.length));
  return false;
};

/**
 * Whether this writer may change or delete this bot.
 *
 * A bot is not every holder's to rewrite: it belongs to somebody, and its
 * instructions are what it does for them, so changing one is changing somebody
 * else's bot. Four ways in - it is theirs, they belong to the team or project
 * it belongs to, they hold `*:*`, or they are this host.
 *
 * `*:*` is the grant that is every grant, which is what the `admin` role holds
 * and what no other built-in role does. Asked as the wildcard itself rather
 * than as the grant this scheme writes with, because the question is whether
 * this is somebody who administers the host: a holder of `bot:put`, or of
 * `bot:*` for that matter, may make a bot and change no other. `bot:get` is
 * not a way in either, which is why this is the membership rule written out
 * again rather than the read road's answer.
 *
 * The writer and the reader are absent together - a host with no users
 * directory, and a connection that is neither a person nor the root one - and
 * neither can be asked whose a bot is. The first may change anything because
 * there is nobody to check against, the second because a root connection is
 * the host's own key.
 */
const mayWrite = (bot: BotRecord, writer: Owner | undefined, reader: Principal | undefined): boolean => {
  if (writer === undefined || writer.startsWith('root:')) return true;
  if (reader === undefined) return true;
  if (bot.owner === writer) return true;
  if (reader.can('*:*')) return true;
  const memberships = reader.memberships ?? [];
  if (bot.owner.startsWith('team:')) return covers(memberships, bot.owner.slice('team:'.length));
  if (bot.owner.startsWith('project:')) return covers(memberships, bot.owner.slice('project:'.length));
  return false;
};

/**
 * Whether this reader may talk to this bot in a chat of their own.
 *
 * Two ways in, and no others: a bot's owner is not made to hold a grant for
 * their own conversation, which is the read road's own rule for `bot:get`, and
 * `bot:chat` is what lets anybody else open one. A membership of the team or
 * project a bot belongs to is not a way in here, because a chat is one person
 * talking to one bot and there is nothing for a third to be shown.
 *
 * A reader who is nobody - the root connection, and every connection on a host
 * with no users directory - is this host, which chats with any of its bots and
 * has no grant to show for it.
 */
const mayChat = (bot: BotRecord, reader: Principal | undefined): boolean => {
  if (reader === undefined) return true;
  if (bot.owner === `user:${reader.id}`) return true;
  return reader.can('bot:chat');
};

/**
 * Whether this reader may look into these chats of a bot.
 *
 * Three ways in, and no others: they are the person the path names, they own
 * the bot - what somebody says to it is said to a bot of theirs - or they are
 * this host, which is the reader who is nobody: the root connection, and every
 * connection on a host with no users directory. The grant that reads the bot is
 * not a way in, because a bot's record is the host's to show and a chat is not:
 * one person's conversation with a bot is theirs and their bot's.
 *
 * The bot's owner is the owner on record and not a member of the team or
 * project it belongs to, the way `mayChat` reads it.
 */
const mayLook = (bot: BotRecord, user: string, reader: Principal | undefined): boolean => {
  if (reader === undefined) return true;
  const them = ownerOfPrincipal(reader);
  return userOf(them) === user || bot.owner === them;
};

/** One answer, as a read serves it. */
const json = (said: unknown): Read => ({
  data: JSON.stringify(said, null, 2),
  encoding: 'utf-8',
  contentType: 'application/json',
});

/** The row one person's chat with one bot is kept under. */
const chatRow = (slug: string, owner: Owner): string => rowId([slug, owner]);

export function botProvider(options: BotOptions): BotProvider {
  const { root, store } = options;

  /** This host's own owner, whatever this machine is called today. */
  const self: Owner = `root:${options.hostName}`;

  /**
   * The chats being started right now, by row id.
   *
   * One chat per bot and person means the second of two reads arriving together
   * waits on the first rather than opening a session of its own: what a person
   * gets for reading a bot twice at once is one chat, not two rows pointing at
   * two conversations.
   */
  const starting = new Map<string, Promise<string>>();

  /** One open watch: the slug it is on, empty for `bot://`, and who opened it. */
  interface Watching {
    slug: string;
    reader: Principal | undefined;
    onChange: (changes: ResourceChange[]) => void;
  }
  const watching = new Set<Watching>();

  /**
   * Whether this watcher hears about this bot.
   *
   * The same answer the reader gets when it asks: a watch on `bot://` hears
   * what the listing shows it, and a watch on one bot hears what a read of it
   * would show.
   */
  const hears = (one: Watching, bot: BotRecord): boolean => {
    if (one.slug !== '' && one.slug !== bot.id) return false;
    if (one.reader === undefined) return true;
    if (one.slug === '' && one.reader.can('bot:list')) return true;
    return mayRead(bot, one.reader);
  };

  /**
   * Tell each watcher that may read this bot what happened to it.
   *
   * A delete is told with the record as it was, so a watcher hears it exactly
   * when it could read the bot before it went. One watcher's callback that
   * throws does not stop the others.
   */
  const told = (type: ResourceChange['type'], bot: BotRecord): void => {
    const change: ResourceChange = { uri: `bot://${bot.id}`, type };
    for (const one of watching) {
      if (!hears(one, bot)) continue;
      try {
        one.onChange([change]);
      }
      catch {
        // A watcher that failed is the host's to drop, not ours to stop telling the rest.
      }
    }
  };

  /*
   * A bot changed outside this process - in the file a person edits, or in a
   * store a plugin replaced - arrives as a change the store did not make. It is
   * told to the same watchers and the same catalogue as a write through
   * `bot://`, because to both of them it is the same event: a bot that is not
   * what it was.
   */
  store.onChange((change) => {
    if (change.type === 'deleted') {
      told('deleted', change.bot);
      options.catalogue?.remove(change.bot);
      return;
    }
    told(change.type, change.bot);
    options.catalogue?.put(change.bot, change.before);
  });

  /** Whose a bot this write makes is, or the refusal it is owed. */
  const ownerFor = (
    asked: Owner | undefined,
    writer: Owner | undefined,
    reader: Principal | undefined,
    existing?: BotRecord,
  ): Owner => {
    if (asked === undefined) return existing?.owner ?? writer ?? self;
    // An edit keeps the owner on record: `checkRecord` has refused any other,
    // and a host owner under an older name stays as it was written.
    if (existing !== undefined) return existing.owner;
    /*
     * The host, named by whoever may name it, is written under today's name.
     *
     * Any `root:` is this host, so the name a body gives after it is not kept:
     * a record names the host the way the host calls itself now. The root
     * connection and a host with no users directory may name any owner, and a
     * holder of `*:*` administers the host, the same test `mayWrite` asks.
     */
    const admin = writer === undefined || writer.startsWith('root:') || (reader !== undefined && reader.can('*:*'));
    if (admin && asked.startsWith('root:')) return self;
    if (admin || asked === writer) return asked;
    /*
     * A team or a project named as the owner has to be the writer's own.
     *
     * The rule is the read road's own, `covers`, so a bot a write may make is
     * one its maker may then read: a membership of that team, or of a project
     * under it. The reader is absent on a host with no users directory and on
     * the root connection, and both may name any owner - the first because
     * there is no record to check a membership against, the second because it
     * is the host's own key.
     *
     * What is left is somebody else's `user:`, or this host's `root:`, which
     * is not this writer's to make short of `*:*`.
     */
    const named = asked.startsWith('team:') || asked.startsWith('project:')
      ? asked.slice(asked.indexOf(':') + 1)
      : undefined;
    if (named !== undefined && reader !== undefined && covers(reader.memberships ?? [], named)) return asked;
    throw new RpcError(-32009, `${writer} may not make a bot of ${asked} here`);
  };

  /** The folder a bot works in, or the refusal a folder another bot has is owed. */
  const workspaceFor = (slug: string, asked: string | undefined, existing?: BotRecord): string => {
    const workspace = asked ?? existing?.workspace ?? join(root, slug);
    // A named folder is one under `root`: the plugin makes it, and a maker
    // names folders only where the plugin's own are kept.
    if (asked !== undefined && existing === undefined && !resolve(asked).startsWith(`${resolve(root)}${sep}`)) {
      throw new RpcError(-32602, `${asked} is not under ${root}; a bot's folder is one there`);
    }
    const clash = store.all().find((one) => one.id !== slug && one.workspace === workspace);
    if (clash !== undefined) {
      throw new RpcError(-32602, `${workspace} is where ${clash.id} works; a bot's folder is its own`);
    }
    return workspace;
  };

  /**
   * The chat this owner talks to this bot in, started the first time one is
   * asked for.
   *
   * The row first, and the session the row names: a chat this host still has is
   * the chat, and one whose session has gone - a daemon that restarted, whose
   * session store is empty until somebody opens it again - is started afresh
   * and the row written over it.
   *
   * The start is the host's own road, so it is the owner who is asked for
   * `session:create` and a refusal there is this read's: a chat that could not
   * be opened is not a record answered with a key missing.
   */
  const chatOf = async (bot: BotRecord, whose: Owner): Promise<string> => {
    const id = chatRow(bot.id, whose);
    const rows = options.chats(bot.id);
    const row = await rows.get(id);
    const held = row?.['chat'];
    if (typeof held === 'string' && await options.sessions.owner(held) !== undefined) return held;
    const running = starting.get(id);
    if (running !== undefined) return running;
    const begun = options.sessions.start({
      owner: whose,
      provider: CHAT_PROVIDER,
      // The bot's own folder, which is where its work happens and so where a
      // conversation about that work belongs.
      workingDirectory: bot.workspace,
      config: { bot: bot.id },
      title: bot.name,
    }).then(async (chat) => {
      await rows.put({ id, bot: bot.id, owner: whose, chat });
      return chat;
    });
    starting.set(id, begun);
    // Held only while it is being started, whether it answers or refuses.
    const done = (): void => { starting.delete(id); };
    begun.then(done, done);
    return begun;
  };

  return {
    describe: (): SchemeDescription => ({
      title: 'Bot',
      description: 'A bot a person keeps on this host, with a workspace of its own.',
      manifest: manifest(options.hostName),
    }),

    authorize: async (uri, reader) => {
      if (reader === undefined) return true;
      await store.ready();
      const held = split(uri);
      if (held === undefined) return false;
      // The root is the listing, which the provider answers for whoever asks
      // and narrows to what each reader may see.
      if (held.slug === '') return held.leaf === '';
      const bot = store.get(held.slug);
      return bot !== undefined && mayRead(bot, reader);
    },

    /**
     * Every bot, `bot://`, or the back sessions of one person's chat with one
     * bot, `bot://<slug>/<user>/`.
     *
     * Who may list the bots is asked the same way a read asks it, and who may
     * list a person's back sessions is who may look into their chats: what a
     * person has running behind a bot is theirs, so a listing of the names is
     * not shown to whoever may read the bot.
     *
     * `?owner=me` narrows the root listing to the bots whose owner is the
     * caller. It comes after who may list, so it only ever takes bots out of an
     * answer the reader was already shown, and a team bot they may read is not
     * theirs.
     */
    list: async (uri, reader) => {
      await store.ready();
      const held = at(uri);
      if (held.slug === '') {
        if (held.leaf !== '') throw absent(uri);
        const every = store.all();
        const shown = reader === undefined || reader.can('bot:list')
          ? every
          : every.filter((one) => mayRead(one, reader));
        const only = ownerFilter(held.query, reader);
        const kept = only === undefined ? shown
          : only === null ? []
            : shown.filter((one) => one.owner === only);
        return kept.map((one) => ({ name: one.id, type: 'file' as const }));
      }
      const bot = store.get(held.slug);
      if (bot === undefined) throw absent(uri);
      const where = named(held.leaf);
      if (where === undefined || where.at !== 'sessions') throw absent(uri);
      if (!mayLook(bot, where.user, reader)) throw notTheirs(bot, where.user);
      const names = await options.backSessions.list(bot.id, where.user);
      return names.map((name) => ({ name, type: 'file' as const }));
    },

    /**
     * What is at this URI, without reading it.
     *
     * The root is a directory of bots and a bot is a file, its record. Under a
     * bot: `<user>` is a file, the main chat a read answers - it is there
     * whether or not anybody has said anything yet, because a read of it is
     * what opens it - `<user>/` is a directory, the back sessions of that
     * person, and `<user>/<name>` is a file only where a row names a session.
     *
     * A chat and a back session are answered the moment they are asked about,
     * because neither has a time of its own to name: what a read serves is
     * where the session is, and it is where it was a moment ago.
     *
     * The reader is not handed to this road, so this answers shape and never
     * permission, and `read` is where somebody looking into another person's
     * chats is refused.
     */
    resolve: async (uri) => {
      await store.ready();
      const held = at(uri);
      if (held.slug === '') {
        if (held.leaf !== '') throw absent(uri);
        const now = new Date().toISOString();
        return { uri, type: 'directory', mtime: now, ctime: now };
      }
      const bot = store.get(held.slug);
      if (bot === undefined) throw absent(uri);
      if (held.leaf === '') {
        const body = JSON.stringify(bot, null, 2);
        const mtime = moment(bot.updatedAt);
        const ctime = moment(bot.createdAt);
        return {
          uri,
          type: 'file',
          size: Buffer.byteLength(body, 'utf8'),
          ...(mtime === undefined ? {} : { mtime }),
          ...(ctime === undefined ? {} : { ctime }),
          // What an edit is checked against: the moment the record last changed,
          // so a write that read the bot before somebody else's edit is refused
          // rather than quietly undoing it.
          etag: bot.updatedAt,
        };
      }
      const where = named(held.leaf);
      if (where === undefined) throw absent(uri);
      const now = new Date().toISOString();
      if (where.at === 'sessions') return { uri, type: 'directory', mtime: now, ctime: now };
      if (where.at === 'chat') return { uri, type: 'file', mtime: now, ctime: now };
      const session = await options.backSessions.get(bot.id, where.user, where.name);
      if (session === undefined) throw noSession(uri);
      return { uri, type: 'file', mtime: now, ctime: now };
    },

    /**
     * The record and the reader's own chat with the bot, or the chat itself.
     *
     * A read is the only door a person has onto a bot they hold a grant for
     * rather than made, so it is where their chat is opened: the same read
     * twice is the same chat, and a reader who may not chat is answered the
     * record alone rather than a refusal - there is nothing wrong with their
     * read, there is simply no conversation of theirs to name.
     *
     * The chat is written under `chat` and nothing else of the record moves, so
     * a client that writes the whole record back is writing back a bot it read.
     *
     * The paths under a bot answer that same chat and the back sessions behind
     * it, and they answer a reader rather than whoever may read the bot: a main
     * chat is one person's, and the bot's owner and this host are the other two
     * who may see it. A name no row has is a back session that is not there,
     * which is a read of something absent rather than a refusal.
     */
    read: async (uri, _wanted, reader) => {
      await store.ready();
      const held = at(uri);
      if (held.slug === '') throw absent(uri);
      const known = store.get(held.slug);
      if (known === undefined) throw absent(uri);
      // The file's parts, read now rather than answered from the cache: an edit
      // the bot made to its own file shows on the next read, without anything
      // having to notice the write.
      const bot = fromAgents(options.yaml, known);
      if (held.leaf === '') {
        /*
         * The agent it names is the bot's session's, and one this host does not
         * serve is said so here: a bot whose agent went is one that wakes
         * nothing, and a client reading it is told rather than left to find out
         * when a message goes unanswered.
         */
        const provider = bot.preset ?? bot.harness;
        const state = provider !== undefined && options.available !== undefined && !options.available(provider)
          ? { state: 'unavailable' as const }
          : {};
        const answered = mayChat(bot, reader)
          ? { ...bot, ...state, chat: await chatOf(bot, reader === undefined ? self : ownerOfPrincipal(reader)) }
          : { ...bot, ...state };
        return json(answered);
      }
      const where = named(held.leaf);
      // A directory is not a read: what is under a person's chat is the names,
      // and a listing is what answers them.
      if (where === undefined || where.at === 'sessions') throw absent(uri);
      if (!mayLook(bot, where.user, reader)) throw notTheirs(bot, where.user);
      if (where.at === 'chat') {
        // The person themselves is asked what a read of the bot asks before it opens their chat.
        if (reader !== undefined && bot.owner !== ownerOfPrincipal(reader) && !mayChat(bot, reader)) throw notTheirs(bot, where.user);
        const chat = await chatOf(bot, whose(where.user, options.hostName));
        return json({ chat });
      }
      const session = await options.backSessions.get(bot.id, where.user, where.name);
      if (session === undefined) throw noSession(uri);
      return json({ session });
    },

    /**
     * A bot is made here, and edited here.
     *
     * The URI is the slug and the body is the record, so a make is a write with
     * `createOnly` and an edit is a write with the validator the last read
     * answered. A write that names neither is a make where there is nothing
     * yet and an edit where there is, which is the one reading that makes a
     * client's retry the same request.
     *
     * A make is any holder of the grant the host asks for on this command. An
     * edit is one of the four ways into a bot that already exists, and the
     * grant that makes one is not among them - which is asked before anything
     * else is said about the bot, so a write that may not touch one is told
     * that rather than what is in it.
     */
    write: async (uri, content, owner, _client, reader) => {
      await store.ready();
      const held = at(uri);
      if (held.leaf !== '') {
        throw new RpcError(-32602, `${uri} is not a bot; write to bot://<slug>`);
      }
      if (held.slug === '') throw new RpcError(-32602, `${uri} is not a name for a bot; write to bot://<slug>`);
      const { slug } = held;
      if (!isSlug(slug)) {
        throw new RpcError(-32602, `${slug} is not a bot's name: lowercase letters, digits and a dash, starting with a letter`);
      }

      // The file's parts over the record's: an edit that names no persona is
      // editing the bot as it is now, not as the store last read it.
      const known = store.get(slug);
      const existing = known === undefined ? undefined : fromAgents(options.yaml, known);
      if (existing !== undefined && !mayWrite(existing, owner, reader)) throw notYours(existing);
      if (existing === undefined && store.gone(slug)) {
        throw new RpcError(-32010, `${slug} was a bot here once; choose another name`);
      }
      if (existing !== undefined && content.createOnly === true) {
        throw new RpcError(-32010, `${slug} is already a bot here`);
      }
      if (content.ifMatch !== undefined && content.ifMatch !== existing?.updatedAt) {
        throw new RpcError(-32011, `${slug} is not the bot that was read; read it again`);
      }

      const said = parsed(uri, content);
      const draft = checkRecord(slug, said, existing);
      const whose = ownerFor(draft.owner, owner, reader, existing);
      /*
       * The agent the record names, checked against the bot's owner rather than
       * the person writing: a bot is the owner's work, and the host would ask
       * its own rule of whoever starts a session on it.
       */
      const provider = draft.preset ?? draft.harness;
      if (provider !== undefined && options.mayUse !== undefined && !options.mayUse(whose, provider)) {
        throw new RpcError(-32009, `${provider} is not an agent ${whose} may use`);
      }
      // A make reads its template. An edit reads it only where the body names
      // one, so a bot whose template was removed can still be edited; a template
      // that is named and missing is refused either way.
      const reads = existing === undefined || (said as Bag)['template'] !== undefined;
      const template = reads ? await templateOf(draft, options.templates) : DEFAULT_TEMPLATE;
      if (template === undefined) throw new RpcError(-32602, `The template ${draft.template as string} does not exist.`);
      const now = new Date().toISOString();
      const record: BotRecord = {
        id: slug,
        name: draft.name,
        labels: draft.labels,
        ...(draft.description === undefined ? {} : { description: draft.description }),
        body: draft.body,
        color: draft.color,
        ...(draft.instructions === undefined ? {} : { instructions: draft.instructions }),
        ...(draft.template === undefined ? {} : { template: draft.template }),
        ...(draft.harness === undefined ? {} : { harness: draft.harness }),
        ...(draft.model === undefined ? {} : { model: draft.model }),
        ...(draft.preset === undefined ? {} : { preset: draft.preset }),
        session: draft.session,
        workspace: workspaceFor(slug, draft.workspace, existing),
        ...(draft.computer === undefined ? {} : { computer: draft.computer }),
        ...(draft.connectors === undefined ? {} : { connectors: draft.connectors }),
        owner: whose,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      /*
       * The section ends at the next `##` line, so instructions with one of
       * their own would be cut at it: refused here, before anything is written,
       * rather than written and read back short.
       */
      const wrong = instructionsProblem(record.instructions ?? '');
      if (wrong !== undefined) throw new RpcError(-32602, wrong);
      /*
       * The file is written before the record, because the file is the one copy
       * of the persona: a record written over a file that never got the parts
       * would be the only copy of them, which is the thing this removes.
       *
       * A make leaves a folder behind with its `AGENTS.md` in it, from the
       * template filled with the bot's words, so the file a bot has from its
       * first moment is the one a first wake would have made. An edit writes the
       * parts into the file that is there and keeps everything else it says; so
       * does a make that finds a file already there.
       *
       * A bot on a computer has no folder on this host, so it is the one bot
       * whose record keeps the parts: its file is on a machine this write does
       * not reach.
       */
      if (record.computer === undefined) {
        // A file this host cannot read would be written over as if it were
        // empty, and its text is the bot's: the write is refused instead.
        const file = readAgentsFile(record.workspace, options.yaml);
        if (file.kind === 'unreadable') {
          throw new RpcError(-32603, `${join(record.workspace, AGENTS_FILE)} cannot be read, so it was not written: ${String(file.error)}`);
        }
        if (existing === undefined && file.kind === 'missing') {
          makeFolder(record.workspace, await options.agents(record), options.yaml, partsOf(record));
        }
        else {
          writeAgentsFile(record.workspace, options.yaml, partsOf(record));
        }
      }
      await store.put(record);
      told(existing === undefined ? 'added' : 'updated', record);
      options.catalogue?.put(record, existing);
    },

    /**
     * A bot is deleted here.
     *
     * The slug keeps a tombstone, so the name is not made again: a client that
     * had the address of one bot and is handed a different one under it has
     * been told something untrue about what it is holding.
     *
     * Who may is who may edit it, and a delete is the worse of the two to get
     * wrong: an edit can be edited back, and a bot that is gone is a name
     * nobody can answer on again. The flag a directory needs says nothing here,
     * so it is dropped: a bot has no children, and everything about one is in
     * the record.
     */
    remove: async (uri, _recursive, owner, reader) => {
      await store.ready();
      const held = at(uri);
      if (held.leaf !== '' || held.slug === '') {
        throw new RpcError(-32602, `${uri} is not a bot to delete; delete bot://<slug>`);
      }
      const bot = store.get(held.slug);
      if (bot === undefined) throw absent(uri);
      if (!mayWrite(bot, owner, reader)) throw notYours(bot);
      await store.remove(held.slug);
      /*
       * The folder, which is the whole of what the daemon kept of the bot: the
       * record, its main chat rows, its back session rows and its logs. The
       * tombstone is written first, so a delete that fails here is a bot that
       * is gone with its rows still on disk rather than a name made again.
       *
       * The work folder under the plugin root is not in here, so it survives.
       */
      rmSync(join(options.botsDir, held.slug), { recursive: true, force: true });
      told('deleted', bot);
      options.catalogue?.remove(bot);
    },

    /**
     * A watch on every bot, `bot://`, or on one, `bot://<slug>`.
     *
     * A make is `added`, an edit is `updated` and a delete is `deleted`, each
     * told to a watcher that may read the bot. The reader is the one that
     * opened the watch, so a membership changed after that applies at the next
     * watch. A bot has no children, so `recursive` and the globs change nothing.
     */
    watch: async (uri, _options, onChange, reader) => {
      await store.ready();
      const held = at(uri);
      if (held.leaf !== '') throw absent(uri);
      if (held.slug !== '' && store.get(held.slug) === undefined) throw absent(uri);
      const one: Watching = { slug: held.slug, reader, onChange };
      watching.add(one);
      return { close: () => { watching.delete(one); } };
    },
  };
}
