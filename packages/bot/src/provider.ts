import { rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { RpcError } from '@ahpd/sdk';
import { covers, ownerFilter } from '@ahpd/sdk';
import { instructionsProblem } from './agents.js';
import { AGENTS_FILE, fromAgents, makeFolder, partsOf, readAgentsFile, writeAgentsFile } from './folder.js';
import { CHAT_PROVIDER, NOT_ITS_OWN_FRONT } from './names.js';
import {
  BOT_BODIES, BOT_COLORS, checkRecord, isSlug,
} from './record.js';
import type { InstructionsIn, Yaml } from './agents.js';
import type { BotCatalogue } from './catalogue.js';
import type { BotRecord } from './record.js';
import type { Talks } from './talks.js';
import type { BotStore } from './store.js';
import type { BotTemplates } from './template.js';
import type {
  Bag, Entry, Metadata, Owner, Principal, Read, ResourceChange, ResourceProvider, SchemeDescription,
  Watcher, WatchOptions, Write,
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
 * A bot's address is `bot://<slug>`, the slug its authority, and a read of it
 * answers the record and starts nothing, as VS Code's reads answer content and
 * its sessions are made by a create. A person talks to a bot in a chat of their
 * own: a session of the `bot-chat` provider that `createSession` makes, naming
 * the bot in its config (see `chat.ts`).
 *
 * Who may see what is asked of `authorize` for reads and listings, and the
 * grant for everything else: the owner of a bot, a member of the team or
 * project it belongs to, and a holder of `bot:get` may read one, and a holder
 * of `bot:list` sees every one there is.
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

/** What the provider was configured with. */
export interface BotOptions {
  /** The folder a bot's own workspace is under, as `<root>/<slug>`. */
  root: string;
  /**
   * The folder the record store keeps the bots in, `<configDir>/bots`.
   *
   * Every bot's data is in `<botsDir>/<slug>/`: the record is `bot.md`, the
   * back session rows are in `sessions/` and the chat logs in `logs/`. A
   * delete of a bot removes that folder, which is the whole of what the daemon
   * kept of it.
   */
  botsDir: string;
  /** Where the records are kept. */
  store: BotStore;
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
  /** Where a bot's instructions are in its `AGENTS.md`: its own section unless this says the body. */
  instructionsIn?: InstructionsIn;
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
   * A bot's `preset` or `provider` is an agent of this host, and the host asks
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
  /**
   * The session each person talks to each bot in, answered on a read as
   * `session`. Absent where nobody talks to a bot, as in a test of the record
   * alone.
   */
  talks?: Talks;
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
  delete(uri: string, recursive?: boolean, owner?: Owner, reader?: Principal): Promise<void>;
  watch(uri: string, options: WatchOptions, onChange: (changes: ResourceChange[]) => void, reader?: Principal): Promise<Watcher>;
  describe(): SchemeDescription;
  authorize(uri: string, reader: Principal | undefined): Promise<boolean>;
}

/** A URI of this scheme, as a URL reads it. */
interface At {
  /** The slug, which is the authority: empty at the root. */
  slug: string;
  /**
   * The path after the authority: empty at the root and at a bot, so a URI
   * with one names nothing here.
   */
  path: string;
  /** The text after `?`, which only the root listing reads. */
  query: string;
}

/**
 * A URI of this scheme, read by a URL parser: `bot://<slug>` names a bot by
 * its authority, `bot://` is the root, and the query is kept apart, so
 * `bot://?owner=me` is the root listing asked for the caller's own rather than
 * a bot named `?owner=me`.
 */
const split = (uri: string): At | undefined => {
  let url: URL;
  try {
    url = new URL(uri);
  }
  catch {
    return undefined;
  }
  if (url.protocol !== 'bot:') return undefined;
  return { slug: url.host, path: url.pathname, query: url.search.slice(1) };
};

const absent = (uri: string): RpcError => new RpcError(-32008, `No bot at ${uri}`);

/** The refusal a change to somebody else's bot is owed. */
const notYours = (bot: BotRecord): RpcError => new RpcError(
  -32009,
  `Only the owner of ${bot.id}, a member of its team or project, an admin or this host may change it`,
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
    template: { type: 'string', description: 'The template its AGENTS.md is made from, by name. Absent is the default.' },
    provider: { type: 'string', description: 'The agent provider a session of it runs on.' },
    model: { type: 'string', description: 'The model it asks for.' },
    preset: { type: 'string', description: 'The session preset it starts from.' },
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
 * Whether this reader may talk to this bot in a session of their own.
 *
 * Two ways in, and no others: a bot's owner holds no grant for their own talk,
 * and `bot:chat` is what lets anybody else open one. A membership of the team
 * or project a bot belongs to is not a way in, because a talk is one person and
 * one bot. Asked after `mayRead`: a bot a person may not read is one they are
 * not told exists.
 *
 * A reader who is nobody - the root connection, and every connection on a host
 * with no users directory - is this host, which talks to any of its bots.
 */
export const mayChat = (bot: BotRecord, reader: Principal | undefined): boolean => {
  if (reader === undefined) return true;
  if (bot.owner === `user:${reader.id}`) return true;
  return reader.can('bot:chat');
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

/** One answer, as a read serves it. */
const json = (said: unknown): Read => ({
  data: JSON.stringify(said, null, 2),
  encoding: 'utf-8',
  contentType: 'application/json',
});

export function botProvider(options: BotOptions): BotProvider {
  const { root, store } = options;

  /** This host's own owner, whatever this machine is called today. */
  const self: Owner = `root:${options.hostName}`;

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
    // A folder outside the allowed roots is the protocol's PermissionDenied,
    // in the words VS Code's file resources refuse one with.
    // https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/common/errors.ts#L68-L79
    // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/resourceProviders/fileSystemResources.ts#L83
    if (asked !== undefined && existing === undefined && !resolve(asked).startsWith(`${resolve(root)}${sep}`)) {
      throw new RpcError(-32009, `Permission denied: ${asked}`);
    }
    const clash = store.all().find((one) => one.id !== slug && one.workspace === workspace);
    if (clash !== undefined) {
      throw new RpcError(-32602, `${workspace} is where ${clash.id} works; a bot's folder is its own`);
    }
    return workspace;
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
      if (held.slug === '') return held.path === '';
      const bot = store.get(held.slug);
      return bot !== undefined && mayRead(bot, reader);
    },

    /**
     * Every bot, `bot://`.
     *
     * Who may list the bots is asked the same way a read asks it. A bot is a
     * file, so a listing of one is of nothing there.
     *
     * `?owner=me` narrows the root listing to the bots whose owner is the
     * caller. It comes after who may list, so it only ever takes bots out of an
     * answer the reader was already shown, and a team bot they may read is not
     * theirs.
     */
    list: async (uri, reader) => {
      await store.ready();
      const held = at(uri);
      if (held.slug !== '' || held.path !== '') throw absent(uri);
      const every = store.all();
      const shown = reader === undefined || reader.can('bot:list')
        ? every
        : every.filter((one) => mayRead(one, reader));
      const only = ownerFilter(held.query, reader);
      const kept = only === undefined ? shown
        : only === null ? []
          : shown.filter((one) => one.owner === only);
      return kept.map((one) => ({ name: one.id, type: 'file' as const }));
    },

    /**
     * What is at this URI, without reading it: the root is a directory of bots
     * and a bot is a file, its record.
     *
     * The spec's resolve carries a time when it is known, and VS Code fills
     * only what the stat has: a bot's are its record's, and the root has none
     * of its own. A bot's size is left out, because this road has no reader
     * and a bot's read answers what it reads from its `AGENTS.md` now.
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/common/commands.ts#L1076-L1085
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/resourceProviders/fileSystemResources.ts#L305-L307
     */
    resolve: async (uri) => {
      await store.ready();
      const held = at(uri);
      if (held.path !== '') throw absent(uri);
      if (held.slug === '') return { uri, type: 'directory' };
      const bot = store.get(held.slug);
      if (bot === undefined) throw absent(uri);
      const mtime = moment(bot.updatedAt);
      const ctime = moment(bot.createdAt);
      return {
        uri,
        type: 'file',
        ...(mtime === undefined ? {} : { mtime }),
        ...(ctime === undefined ? {} : { ctime }),
        // What an edit is checked against: the moment the record last changed,
        // so a write that read the bot before somebody else's edit is refused
        // rather than quietly undoing it.
        etag: bot.updatedAt,
      };
    },

    /**
     * The record, and nothing else: a read starts nothing, as VS Code's reads
     * answer content and its sessions are made by a create.
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/common/commands.ts#L610-L611
     */
    read: async (uri, _wanted, reader) => {
      await store.ready();
      const held = at(uri);
      if (held.slug === '' || held.path !== '') throw absent(uri);
      const known = store.get(held.slug);
      if (known === undefined) throw absent(uri);
      // The file's parts, read now rather than answered from the cache: an edit
      // the bot made to its own file shows on the next read, without anything
      // having to notice the write.
      const bot = fromAgents(options.yaml, known, options.instructionsIn);
      /*
       * The agent it names is the bot's session's, and one this host does not
       * serve is said so here: a bot whose agent went is one that wakes
       * nothing, and a client reading it is told rather than left to find out
       * when a message goes unanswered.
       */
      const provider = bot.preset ?? bot.provider;
      const state = provider !== undefined && options.available !== undefined && !options.available(provider)
        ? { state: 'unavailable' as const }
        : {};
      /*
       * The reader's own session with the bot, where they have one: theirs
       * alone, so a read by anybody else answers the record without it. The
       * read starts nothing.
       */
      // A read with no reader is the root's, as a root connection has no
      // principal; a plugin's own read has no talk.
      const talk = options.talks === undefined || reader?.plugin !== undefined
        ? undefined
        : await options.talks.of(bot.id, reader === undefined ? undefined : `user:${reader.id}`);
      return json({ ...bot, ...state, ...(talk === undefined ? {} : { session: talk }) });
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
      if (held.path !== '') {
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
      const existing = known === undefined ? undefined : fromAgents(options.yaml, known, options.instructionsIn);
      if (existing !== undefined && !mayWrite(existing, owner, reader)) throw notYours(existing);
      if (existing === undefined && store.tombstoned(slug)) {
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
      const provider = draft.preset ?? draft.provider;
      if (draft.provider === CHAT_PROVIDER) throw new RpcError(-32602, NOT_ITS_OWN_FRONT);
      if (provider !== undefined && options.mayUse !== undefined && !options.mayUse(whose, provider)) {
        throw new RpcError(-32009, `${provider} is not an agent ${whose} may use`);
      }
      // A template the body names is read, and one that is missing is refused.
      // A body that names none reads none, so a bot whose template was removed
      // can still be edited.
      const named = (said as Bag)['template'] === undefined ? undefined : draft.template;
      if (named !== undefined && await options.templates.text(named) === undefined) {
        throw new RpcError(-32602, `The template ${named} does not exist.`);
      }
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
        ...(draft.provider === undefined ? {} : { provider: draft.provider }),
        ...(draft.model === undefined ? {} : { model: draft.model }),
        ...(draft.preset === undefined ? {} : { preset: draft.preset }),
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
       * rather than written and read back short. Instructions that are the
       * whole body hold any line.
       */
      const wrong = instructionsProblem(record.instructions ?? '', options.instructionsIn);
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
        const file = readAgentsFile(record.workspace, options.yaml, options.instructionsIn);
        if (file.kind === 'unreadable') {
          throw new RpcError(-32603, `${join(record.workspace, AGENTS_FILE)} cannot be read, so it was not written: ${String(file.error)}`);
        }
        if (existing === undefined && file.kind === 'missing') {
          makeFolder(record.workspace, await options.agents(record), options.yaml, partsOf(record), options.instructionsIn);
        }
        else {
          writeAgentsFile(record.workspace, options.yaml, partsOf(record), options.instructionsIn);
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
    delete: async (uri, _recursive, owner, reader) => {
      await store.ready();
      const held = at(uri);
      if (held.path !== '' || held.slug === '') {
        throw new RpcError(-32602, `${uri} is not a bot to delete; delete bot://<slug>`);
      }
      const bot = store.get(held.slug);
      if (bot === undefined) throw absent(uri);
      if (!mayWrite(bot, owner, reader)) throw notYours(bot);
      await store.remove(held.slug);
      /*
       * The folder, which is the whole of what the daemon kept of the bot: the
       * record, its back session rows and its chat logs. The
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
     * told to a watcher that may read the bot. The reader is the one whose
     * subscribe attached this watcher, so a membership changed after that
     * applies at the next watcher. A bot has no children, so `recursive` and
     * the globs change nothing.
     */
    watch: async (uri, _options, onChange, reader) => {
      await store.ready();
      const held = at(uri);
      if (held.path !== '') throw absent(uri);
      if (held.slug !== '' && store.get(held.slug) === undefined) throw absent(uri);
      const one: Watching = { slug: held.slug, reader, onChange };
      watching.add(one);
      return { close: () => { watching.delete(one); } };
    },
  };
}
