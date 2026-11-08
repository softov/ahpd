import { bindingTarget, isRecordSlug, RpcError } from '@ahpd/sdk';
import type { Bag, Owner, StoredRecord } from '@ahpd/sdk';

/**
 * What a bot is, and what a body may say about one.
 *
 * A bot is a record rather than a file in the host's store: it is made by a
 * write to `bot://<slug>`, and the slug is the URI path, the record's `id` and
 * the name of its own folder. So the slug is chosen once and is written nowhere
 * a body can reach - a write that names another `id` is refused rather than
 * obeyed, and a bot never moves.
 *
 * Everything here is about one write: what a body may carry, what is filled in
 * for the parts it left out, and what it may not change about a bot that is
 * already there. The store and the scheme are the other two files.
 */

/** The protocol's code for a resource that is not there. */
export const NOT_FOUND = -32008;

/** The protocol's code for a body this host will not take. */
export const INVALID_PARAMS = -32602;

/** The protocol's code for a resource that is already there. */
export const ALREADY_EXISTS = -32010;

/** The protocol's code for a write against a resource that has moved on. */
export const CONFLICT = -32011;

/**
 * The bodies a client is offered for a bot, and the ones a make with no body
 * is drawn from.
 *
 * A suggestion, not a limit: a bot's body is a tag, and any word is kept. A
 * client draws a body it does not know with one of its own.
 */
export const BOT_BODIES = [
  'robot', 'humanoid', 'alien', 'gumbo', 'circle',
  'semicircle', 'smash', 'square', 'triangle', 'pentagon',
  'hexagon', 'drop', 'bean', 'cloud', 'ghost',
] as const;

/** The colour names a bot may be drawn in. A bot's colour is one of these or a hex colour, `#rrggbb`. */
export const BOT_COLORS = [
  'red', 'orange', 'yellow', 'green', 'teal', 'blue',
  'purple', 'pink', 'brown', 'grey', 'black',
] as const;

/**
 * The name a bot's back session has when its record names none.
 *
 * One name and one session, so a person who says something to a bot a second
 * time is continuing the work of the first time rather than starting a
 * conversation that knows nothing about it.
 */
export const DEFAULT_SESSION = 'work';

/**
 * The word a back session's name may carry, which the turn id takes the place
 * of.
 *
 * A name that holds it is a name for every message: what is said the second
 * time is said in a session of its own, because that is what a person asks for
 * by naming this - the difference between a bot that continues one session and
 * one that starts a new one each time. The plan's Answers table has it as
 * `{turn}`, beside the default `work`.
 */
export const TURN_WORD = '{turn}';

/** A bot's body: one of `BOT_BODIES`, or any other word a person chose. */
export type BotBody = string;
/** One of `BOT_COLORS`, or a hex colour kept as `#rrggbb` in lowercase. */
export type BotColor = (typeof BOT_COLORS)[number] | `#${string}`;

/**
 * What the `bots` collection keeps of one bot: everything the host writes down.
 *
 * The persona is not here. `name`, `description` and `instructions` are the
 * parts of the bot's `AGENTS.md` (see `agents.ts`), and the file is their one
 * copy: a record that carried them would be a second copy, out of step the
 * first time the bot rewrote its own file. What is left is what the file
 * cannot say - the folder, the owner, the body it is drawn with, the session a
 * message wakes.
 *
 * A bot on a computer is the one exception, and only until an edit can reach
 * that computer: its folder is not on this host, so its record keeps the parts
 * it was made with as the last copy there is.
 */
export interface BotKept {
  /** The slug: the URI path, and the name of the folder this bot works in. */
  id: string;
  /** Words a client groups bots by. */
  labels: string[];
  /** Which body it is drawn with. */
  body: BotBody;
  /** Which colour it is drawn in. */
  color: BotColor;
  /** The template its `AGENTS.md` is made from, by name. Absent is the plugin's default. */
  template?: string;
  /** The agent provider a session of it runs on, AHP's `provider`, where a bot chooses one. */
  provider?: string;
  /** The model it asks for. */
  model?: string;
  /** The session preset it starts from. */
  preset?: string;
  /**
   * The name of the back session a message to it wakes.
   *
   * The session itself is not here: a name is what a person writes, and the
   * session a name is on is a row in the bot's own `sessions` collection,
   * because a session URI is the host's to mint and is not the same one twice.
   */
  session: string;
  /** The folder it works in, which is its own and never moves. */
  workspace: string;
  /** The machine it runs in, where it names one. */
  computer?: string;
  /**
   * The connectors its sessions may use, by alias.
   *
   * The same map a session's `connectors` config key holds: an alias a model
   * says, and the `connectors://<adapter>/<id>` it stands for. A session the
   * bot starts reads this map live - so an edit here reaches a session that is
   * already running, at its next tool list and its next call - and none of the
   * connectors it names is the record's to check: whether the person of a main
   * chat may use one is asked at each call.
   */
  connectors?: Record<string, string>;
  /** Whose it is. */
  owner: Owner;
  /** When it was made. */
  createdAt: string;
  /** When it was last written. */
  updatedAt: string;
}

/**
 * One bot, as a read answers it: the kept fields and the parts its `AGENTS.md`
 * owns.
 *
 * The parts are read from the file each time a bot is answered, so an edit the
 * bot made to its own file shows on the next read. A bot whose folder has no
 * file answers the parts an older record kept, and a slug as its name.
 */
export interface BotRecord extends BotKept {
  /** What a person called it: the file's `name`, or the slug where the file names none. */
  name: string;
  /** One line about it, for a list of bots, where the file says one. */
  description?: string;
  /** What it was asked to be, in its own words, where the file says one. */
  instructions?: string;
  /**
   * `unavailable` when the agent its `preset` or `provider` names is not one
   * this host serves, which is a bot that wakes nothing until the record or the
   * agent is changed.
   *
   * A read answers it and a write does not read it: a bot may name an agent
   * that is not installed yet, and the record says so rather than refusing the
   * name.
   */
  state?: 'unavailable';
}

/** A record as it was written, with whatever parts an older one kept, before its file is read. */
export type KeptBot = BotKept & Partial<Pick<BotRecord, 'name' | 'description' | 'instructions'>>;

/**
 * The record with the parts its `AGENTS.md` owns taken out.
 *
 * What the `bots` collection keeps. A record that carried the parts would be a
 * second copy of them, and one that goes stale the first time the bot edits
 * its own file. A bot on a computer is the caller's exception: its file is not
 * on this host, so what it was made with is all this host has.
 */
export function withoutParts(bot: BotRecord): StoredRecord {
  const taken: StoredRecord = { ...bot };
  delete taken['name'];
  delete taken['description'];
  delete taken['instructions'];
  return taken;
}

/**
 * What one write's body decided, with what it left out filled in.
 *
 * Absent where the body named nothing and there was no record behind it: the
 * owner, the folder and the two times are the host's, so they are filled in
 * where the record is composed rather than here.
 */
export interface BotDraft {
  /** What it is called, which a make must say and an edit may leave alone. */
  name: string;
  labels: string[];
  body: BotBody;
  color: BotColor;
  /** The back session's name, which is `work` unless the body names another. */
  session: string;
  owner?: Owner | undefined;
  workspace?: string | undefined;
  description?: string | undefined;
  instructions?: string | undefined;
  template?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  preset?: string | undefined;
  computer?: string | undefined;
  connectors?: Record<string, string> | undefined;
}

/** The keys a body may carry: a bot's own fields, and nothing else. */
const FIELDS = [
  'id', 'name', 'labels', 'description', 'body', 'color', 'instructions', 'template',
  'provider', 'model', 'preset', 'session', 'workspace', 'computer', 'connectors', 'owner',
  // The two times are here rather than refused, because a client that read a
  // bot and wrote the whole record back is writing what it was given. Neither
  // is read: what they hold is the host's.
  'createdAt', 'updatedAt',
  // Whether the agent it names is one this host serves. Answering a read and
  // never a record the host keeps, so a body that carries it back changes
  // nothing and a bot that names a missing agent is still a bot someone made.
  'state',
];

/** An owner, as the four kinds the usage rules spell. */
const OWNER = /^(?:user|team|project|root):.+$/;

/** Whether two owners are the same: equal, or both the host under any name. */
export const sameOwner = (one: Owner, other: Owner): boolean =>
  one === other || (one.startsWith('root:') && other.startsWith('root:'));

/**
 * Whether this is a slug a bot may have.
 *
 * Lowercase letters, digits and dashes, one to forty of them, starting with a
 * letter: the slug is a folder name and a URI path at once, and both of those
 * are safer with one spelling.
 */
export const isSlug = (slug: string): boolean => /^[a-z][a-z0-9-]{0,39}$/.test(slug);

/**
 * Whether this is a name a back session may have.
 *
 * A slug with `{turn}` allowed in it, which is asked of a name a body wrote
 * rather than of one a message filled: `x` stands in for the word, because a
 * turn id takes its place and a name is a name only once it has one. Whether
 * the *filled* name is a slug is a different question with a different answer -
 * a turn id is somebody else's to choose, so a name that cannot hold one is
 * refused where the message arrives rather than here.
 */
export const isBackName = (name: string): boolean => isSlug(name.replaceAll(TURN_WORD, 'x'));

/**
 * Whether a name a message filled is one a back session may have.
 *
 * Looser than a slug, because a turn id is a uuid: it may start with a digit,
 * and `work-` and a uuid are more than forty characters. The name is a path
 * segment and a row key, so lowercase letters, digits and a dash are enough.
 */
export const isFilledName = (name: string): boolean => /^[a-z0-9][a-z0-9-]{0,79}$/.test(name);

/** A name or a line, trimmed, where the body named one. */
const line = (key: string, said: unknown): string | undefined => {
  if (said === undefined) return undefined;
  if (typeof said !== 'string') throw new RpcError(INVALID_PARAMS, `${key} is a line of text`);
  const held = said.trim();
  return held === '' ? undefined : held;
};

/** The words a body listed, with a key of its own. */
const words = (said: unknown, fallback: string[]): string[] => {
  if (said === undefined) return fallback;
  if (!Array.isArray(said) || said.some((one) => typeof one !== 'string')) {
    throw new RpcError(INVALID_PARAMS, 'labels is a list of words, one per label');
  }
  return (said as string[]).map((one) => one.trim()).filter((one) => one !== '');
};

/** A word, trimmed, or the make's own default. */
const tag = (said: unknown, missing: string, fallback: string): string => {
  if (said === undefined) return fallback;
  if (typeof said !== 'string' || said.trim() === '') {
    throw new RpcError(INVALID_PARAMS, `${missing} is a word`);
  }
  return said.trim();
};

/** One of a closed list, or the make's own default. */
const among = <T extends string>(said: unknown, list: readonly T[], missing: string, fallback: T): T => {
  if (said === undefined) return fallback;
  if (typeof said !== 'string' || !(list as readonly string[]).includes(said)) {
    throw new RpcError(INVALID_PARAMS, `${String(said)} is not ${missing}`);
  }
  return said as T;
};

/** Whether a value is a colour a stored bot may have: one of the names, or `#rrggbb` in lowercase. */
export const isBotColor = (said: unknown): said is BotColor =>
  (BOT_COLORS as readonly unknown[]).includes(said) || (typeof said === 'string' && /^#[0-9a-f]{6}$/.test(said));

/** One of the colour names, a hex colour in lowercase, or the make's own default. */
const colour = (said: unknown, fallback: BotColor): BotColor => {
  if (typeof said === 'string' && /^#[0-9a-fA-F]{6}$/.test(said)) return said.toLowerCase() as BotColor;
  return among(said, BOT_COLORS, 'a colour a bot is drawn in', fallback as (typeof BOT_COLORS)[number]);
};

/** A body at random, which is what a make that named none is drawn with. */
const drawn = (): BotBody => BOT_BODIES[Math.floor(Math.random() * BOT_BODIES.length)] ?? BOT_BODIES[0];

/**
 * The bindings a body named, or the refusal it is owed.
 *
 * The same check `bindingsOf` makes when it reads a session's config: an alias
 * that is not a lowercase slug, and a value that is not
 * `connectors://<adapter>/<id>`, are what that reader skips. A bot is written
 * once and read on every message, so a binding it would skip is refused here
 * rather than dropped: the person who wrote it is told, while the session that
 * would have been offered nothing says nothing. The keys are kept in the order
 * the body wrote them, which is the order the model is offered them in.
 */
const aliased = (said: unknown): Record<string, string> => {
  if (typeof said !== 'object' || said === null || Array.isArray(said)) {
    throw new RpcError(INVALID_PARAMS, 'connectors is an object from an alias to connectors://<adapter>/<id>');
  }
  const out: Record<string, string> = {};
  for (const [alias, value] of Object.entries(said as Bag)) {
    if (!isRecordSlug(alias)) {
      throw new RpcError(INVALID_PARAMS, `${alias} is not a connector alias: lowercase letters, digits and a dash, starting with a letter`);
    }
    if (bindingTarget(value) === undefined) {
      throw new RpcError(INVALID_PARAMS, `${JSON.stringify(value)} is not a connector; write connectors://<adapter>/<id>`);
    }
    out[alias] = value as string;
  }
  return out;
};

/**
 * The draft one write's body makes, or the refusal it is owed.
 *
 * `existing` is the bot a write edits, where there is one, and it is what makes
 * an edit an edit: what the body left out is kept from it, and what it may not
 * move - the slug, the owner, the folder - is refused where the body names
 * another.
 */
export function checkRecord(slug: string, said: unknown, existing?: BotRecord): BotDraft {
  if (typeof said !== 'object' || said === null || Array.isArray(said)) {
    throw new RpcError(INVALID_PARAMS, `${slug} is made from an object with a name`);
  }
  const body = said as Bag;
  for (const key of Object.keys(body)) {
    if (!FIELDS.includes(key)) throw new RpcError(INVALID_PARAMS, `${key} is not something a bot has`);
  }

  const id = line('id', body['id']);
  if (id !== undefined && id !== slug) {
    throw new RpcError(INVALID_PARAMS, `${id} is not this bot; ${slug} is`);
  }

  const name = line('name', body['name']) ?? existing?.name;
  if (name === undefined) throw new RpcError(INVALID_PARAMS, `${slug} needs a name`);

  const said_ = line('owner', body['owner']);
  if (said_ !== undefined && !OWNER.test(said_)) {
    throw new RpcError(INVALID_PARAMS, `${said_} is not an owner; write user:, team:, project: or root:`);
  }
  if (said_ !== undefined && existing !== undefined && !sameOwner(said_ as Owner, existing.owner)) {
    throw new RpcError(INVALID_PARAMS, `${said_} is not whose this bot is; it is ${existing.owner}`);
  }

  const template = line('template', body['template']);
  if (template !== undefined && !isSlug(template)) {
    throw new RpcError(INVALID_PARAMS, `${template} is not a template name: lowercase letters, digits and a dash, starting with a letter`);
  }

  const workspace = line('workspace', body['workspace']);
  if (workspace !== undefined && existing !== undefined && workspace !== existing.workspace) {
    throw new RpcError(INVALID_PARAMS, `${workspace} is not where this bot works; it is ${existing.workspace}`);
  }

  // A name a message fills, so what is checked here is what a name may be
  // before there is a message to fill it: see `isBackName`.
  const session = line('session', body['session']) ?? existing?.session ?? DEFAULT_SESSION;
  if (!isBackName(session)) {
    throw new RpcError(INVALID_PARAMS, `${session} is not a name a back session can have: lowercase letters, digits, a dash and ${TURN_WORD}, starting with a letter`);
  }

  return {
    name,
    labels: words(body['labels'], existing?.labels ?? []),
    body: tag(body['body'], 'body', existing?.body ?? drawn()),
    color: colour(body['color'], existing?.color ?? BOT_COLORS[0]),
    session,
    owner: said_ as Owner | undefined,
    workspace,
    description: line('description', body['description']) ?? existing?.description,
    instructions: line('instructions', body['instructions']) ?? existing?.instructions,
    template: template ?? existing?.template,
    provider: line('provider', body['provider']) ?? existing?.provider,
    model: line('model', body['model']) ?? existing?.model,
    preset: line('preset', body['preset']) ?? existing?.preset,
    computer: line('computer', body['computer']) ?? existing?.computer,
    // Absent rather than empty where the body named none: a bot with no
    // connectors and one whose map nobody has read are the same bot, and the
    // reader answers nothing for both.
    connectors: body['connectors'] === undefined ? existing?.connectors : aliased(body['connectors']),
  };
}
