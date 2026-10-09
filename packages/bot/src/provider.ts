import { mkdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { RpcError } from '@ahpd/sdk';
import { covers } from '@ahpd/sdk';
import {
  BOT_BODIES, BOT_COLORS, checkRecord, isSlug,
} from './record.js';
import { sessionFor } from './start.js';
import type { BotRecord } from './record.js';
import type { BotStore } from './store.js';
import type {
  Bag, Entry, Metadata, Owner, Principal, Read, ResourceProvider, SchemeDescription, SessionRequest, Write,
} from '@ahpd/sdk';

/**
 * The `bot:` scheme.
 *
 * A bot is a record a person makes, edits and deletes through the four commands
 * every resource has. A write to `bot://<slug>` with `createOnly` makes one and
 * a write with `ifMatch` edits it, a read answers its record, a list answers
 * the bots the reader may see, and a delete leaves a tombstone behind.
 *
 * Nothing here is a leaf: a bot has no files under it, because everything about
 * one is in the record a read answers. The slug is the whole address, which is
 * why a second path segment is a bad URI rather than a file this host does not
 * have.
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
 */

/**
 * The sessions this host keeps, as much of them as a bot is about.
 *
 * Read through the host rather than held here, the way `store` lives beside the
 * daemon: a bot links a session the host already has, and a link is kept only
 * where the host opened that session for the bot's own owner.
 */
export interface BotSessions {
  /** Whose the session at this URI is, or nothing where this host has none. */
  owner(uri: string): Promise<Owner | undefined>;
  /** Start a session for the owner the request names, and answer its URI. */
  start(wanted: SessionRequest): Promise<string>;
}

/** What the provider was configured with. */
export interface BotOptions {
  /** The folder a bot's own workspace is under, as `<root>/<slug>`. */
  root: string;
  /** Where the records are kept. */
  store: BotStore;
  /** The host's sessions, for the link a record may make to one. */
  sessions: BotSessions;
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
  write(uri: string, content: Write, owner?: Owner, reader?: Principal): Promise<void>;
  remove(uri: string, recursive?: boolean, owner?: Owner, reader?: Principal): Promise<void>;
  describe(): SchemeDescription;
  authorize(uri: string, reader: Principal | undefined): Promise<boolean>;
}

/** A URI, split into the slug it names and the leaf under it. */
interface At {
  /** The slug, empty at the root. */
  slug: string;
  /** Whatever came after a further slash, which a bot never has. */
  leaf: string;
}

/**
 * `bot://<slug>` and `bot:/<slug>` are the same address.
 *
 * A client pastes a URI it was handed and a person types one, and the two
 * spellings are one character apart for the same resource. Both are read the
 * same way rather than one of them being a mistake.
 */
const split = (uri: string): At | undefined => {
  const match = /^([a-zA-Z][\w+.-]*):\/\/?(.*)$/.exec(uri);
  if (match === null || match[1] !== 'bot') return undefined;
  const rest = match[2] ?? '';
  const slash = rest.indexOf('/');
  return slash === -1 ? { slug: rest, leaf: '' } : { slug: rest.slice(0, slash), leaf: rest.slice(slash + 1) };
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

/** One moment, as a URI's metadata wants it. */
const moment = (iso: string): string => {
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? new Date(0).toISOString() : when.toISOString();
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

/** The body a write to the scheme's root makes one from. */
const MANIFEST = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', description: 'What a person called it.' },
    labels: { type: 'array', items: { type: 'string' }, description: 'Words a client groups bots by.' },
    description: { type: 'string', description: 'One line about it, for a list of bots.' },
    body: { type: 'string', enum: [...BOT_BODIES], description: 'Which body it is drawn with.' },
    color: { type: 'string', enum: [...BOT_COLORS], description: 'Which colour it is drawn in.' },
    instructions: { type: 'string', description: 'What it was asked to be, in its own words.' },
    harness: { type: 'string', description: 'The backend a session of it runs on.' },
    model: { type: 'string', description: 'The model it asks for.' },
    preset: { type: 'string', description: 'The session preset it starts from.' },
    workspace: { type: 'string', description: 'The folder it works in, under the plugin root. Its own, and never moved.' },
    computer: { type: 'string', description: 'The machine it runs in.' },
    session: { type: 'string', description: 'The session it is linked to, one this host has for its owner.' },
    owner: { type: 'string', description: "Whose it is, as user:<id>, team:<team> or project:<team>:<project>. The maker where a body names none, and a team or project has to be one the maker belongs to." },
  },
  additionalProperties: false,
} as const;

/**
 * Whether this reader may see this bot.
 *
 * Three ways in, and no others: it is theirs, they belong to the team or
 * project it belongs to, or they hold the grant that reads every bot - which is
 * what makes a scheme the host's rather than each maker's.
 */
const mayRead = (bot: BotRecord, reader: Principal): boolean => {
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
 * A bot is not every holder's to rewrite: its instructions are what a session
 * owned by whoever it belongs to is asked to be, so changing one is changing
 * what that person's session does. Four ways in - it is theirs, they belong to
 * the team or project it belongs to, they hold `*:*`, or they are this host.
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

export function botProvider(options: BotOptions): BotProvider {
  const { root, store } = options;

  /** Whose a bot this write makes is, or the refusal it is owed. */
  const ownerFor = (
    asked: Owner | undefined,
    writer: Owner | undefined,
    reader: Principal | undefined,
    existing?: BotRecord,
  ): Owner => {
    if (asked === undefined) return existing?.owner ?? writer ?? `root:${options.hostName}`;
    if (writer === undefined || writer.startsWith('root:') || asked === writer) return asked;
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
     * What is left is somebody else's `user:`, which is not this writer's to
     * make whatever they hold.
     */
    const named = asked.startsWith('team:') || asked.startsWith('project:')
      ? asked.slice(asked.indexOf(':') + 1)
      : undefined;
    if (named !== undefined && reader !== undefined && covers(reader.memberships ?? [], named)) return asked;
    throw new RpcError(-32009, `${writer} may not make a bot of ${asked} here`);
  };

  /**
   * Whether a body may link this bot to this session, or the refusal it is owed.
   *
   * A bot is talked to in its session and its instructions are what that
   * session is asked to be, so a link to somebody else's session would be this
   * bot's work in a conversation that is not the writer's to put it in. The
   * session has to be one this host has, opened for the bot's own owner.
   *
   * Two refusals that read differently because they are different mistakes: a
   * URI this host has no session for is a body that cannot be, and one that is
   * somebody else's is the writer reaching past what is theirs.
   */
  const mayLink = async (session: string, whose: Owner): Promise<void> => {
    const held = await options.sessions.owner(session);
    if (held === undefined) throw new RpcError(-32602, `${session} is not a session this host has`);
    if (held !== whose) throw new RpcError(-32009, `${session} is not a session of ${whose}`);
  };

  /** The folder a bot works in, or the refusal a folder another bot has is owed. */
  const workspaceFor = (slug: string, asked: string | undefined, existing?: BotRecord): string => {
    const workspace = asked ?? existing?.workspace ?? `${root}/${slug}`;
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

  return {
    describe: (): SchemeDescription => ({
      title: 'Bot',
      description: 'A bot a person keeps on this host, with a workspace of its own.',
      manifest: MANIFEST,
    }),

    authorize: async (uri, reader) => {
      if (reader === undefined) return true;
      const held = split(uri);
      if (held === undefined) return false;
      // The root is the listing, which the provider answers for whoever asks
      // and narrows to what each reader may see.
      if (held.slug === '') return held.leaf === '';
      const bot = store.get(held.slug);
      return bot !== undefined && mayRead(bot, reader);
    },

    list: async (uri, reader) => {
      const held = at(uri);
      if (held.slug !== '' || held.leaf !== '') throw absent(uri);
      const every = store.all();
      const shown = reader === undefined || reader.can('bot:list')
        ? every
        : every.filter((one) => mayRead(one, reader));
      return shown.map((one) => ({ name: one.id, type: 'file' as const }));
    },

    resolve: async (uri) => {
      const held = at(uri);
      if (held.leaf !== '') throw absent(uri);
      if (held.slug === '') {
        const now = new Date().toISOString();
        return { uri, type: 'directory', mtime: now, ctime: now };
      }
      const bot = store.get(held.slug);
      if (bot === undefined) throw absent(uri);
      const body = JSON.stringify(bot, null, 2);
      return {
        uri,
        type: 'file',
        size: Buffer.byteLength(body, 'utf8'),
        mtime: moment(bot.updatedAt),
        ctime: moment(bot.createdAt),
        // What an edit is checked against: the moment the record last changed,
        // so a write that read the bot before somebody else's edit is refused
        // rather than quietly undoing it.
        etag: bot.updatedAt,
      };
    },

    read: async (uri) => {
      const held = at(uri);
      if (held.leaf !== '' || held.slug === '') throw absent(uri);
      const bot = store.get(held.slug);
      if (bot === undefined) throw absent(uri);
      return { data: JSON.stringify(bot, null, 2), encoding: 'utf-8', contentType: 'application/json' };
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
    write: async (uri, content, owner, reader) => {
      const held = at(uri);
      if (held.leaf !== '') {
        throw new RpcError(-32602, `${uri} is not a bot; write to bot://<slug>`);
      }
      if (held.slug === '') throw new RpcError(-32602, `${uri} is not a name for a bot; write to bot://<slug>`);
      const { slug } = held;
      if (!isSlug(slug)) {
        throw new RpcError(-32602, `${slug} is not a bot's name: lowercase letters, digits and a dash, starting with a letter`);
      }

      const existing = store.get(slug);
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
      // Asked only where the body named a session: a link a write carried over
      // from the record is one an earlier write already had checked, and an
      // edit of the name is not an edit of this.
      const named = (said as Bag)['session'];
      if (typeof named === 'string' && named.trim() !== '') await mayLink(draft.session as string, whose);
      const now = new Date().toISOString();
      const record: BotRecord = {
        id: slug,
        name: draft.name,
        labels: draft.labels,
        ...(draft.description === undefined ? {} : { description: draft.description }),
        body: draft.body,
        color: draft.color,
        ...(draft.instructions === undefined ? {} : { instructions: draft.instructions }),
        ...(draft.harness === undefined ? {} : { harness: draft.harness }),
        ...(draft.model === undefined ? {} : { model: draft.model }),
        ...(draft.preset === undefined ? {} : { preset: draft.preset }),
        workspace: workspaceFor(slug, draft.workspace, existing),
        ...(draft.computer === undefined ? {} : { computer: draft.computer }),
        ...(draft.session === undefined ? {} : { session: draft.session }),
        owner: whose,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      /*
       * A bot made with no session gets one, and it is the maker's.
       *
       * The folder is made first, because the session runs in it: on this host
       * that is a directory to make, and in a computer the folder rides along
       * as the working directory and the machine makes it. The host is asked
       * before the record is saved and its refusal is the make's, so a start
       * that did not happen leaves no bot behind claiming a session it has not
       * got.
       */
      if (existing === undefined && record.session === undefined) {
        if (record.computer === undefined) mkdirSync(record.workspace, { recursive: true });
        record.session = await options.sessions.start(sessionFor(record));
      }
      store.put(record);
    },

    /**
     * A bot is deleted here.
     *
     * The slug keeps a tombstone, so the name is not made again: a client that
     * had the address of one bot and is handed a different one under it has
     * been told something untrue about what it is holding.
     *
     * Who may is who may edit it, and a delete is the worse of the two to get
     * wrong: an edit can be edited back, and the record a session of this bot
     * was made from cannot. The flag a directory needs says nothing here, so it
     * is dropped: a bot has no children, and everything about one is in the
     * record.
     */
    remove: async (uri, _recursive, owner, reader) => {
      const held = at(uri);
      if (held.leaf !== '' || held.slug === '') {
        throw new RpcError(-32602, `${uri} is not a bot to delete; delete bot://<slug>`);
      }
      const bot = store.get(held.slug);
      if (bot === undefined) throw absent(uri);
      if (!mayWrite(bot, owner, reader)) throw notYours(bot);
      store.remove(held.slug);
    },
  };
}
