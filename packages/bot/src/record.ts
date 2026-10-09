import { RpcError } from '@ahpd/sdk';
import type { Bag, Owner } from '@ahpd/sdk';

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
 * The bodies a bot is drawn with.
 *
 * A closed set, because a client draws one: a bot whose body this host invented
 * is a bot nothing can render.
 */
export const BOT_BODIES = [
  'robot', 'humanoid', 'alien', 'gumbo', 'circle',
  'semicircle', 'smash', 'square', 'triangle', 'pentagon',
  'hexagon', 'drop', 'bean', 'cloud', 'ghost',
] as const;

/** The colour a bot is drawn in, from the palette a client offers. */
export const BOT_COLORS = [
  'red', 'orange', 'yellow', 'green', 'teal', 'blue',
  'purple', 'pink', 'brown', 'grey', 'black',
] as const;

export type BotBody = (typeof BOT_BODIES)[number];
export type BotColor = (typeof BOT_COLORS)[number];

/** One bot, as it is kept and as a read answers it. */
export interface BotRecord {
  /** The slug: the URI path, and the name of the folder this bot works in. */
  id: string;
  /** What a person called it. */
  name: string;
  /** Words a client groups bots by. */
  labels: string[];
  /** One line about it, for a list of bots. */
  description?: string;
  /** Which body it is drawn with. */
  body: BotBody;
  /** Which colour it is drawn in. */
  color: BotColor;
  /** What it was asked to be, in its own words, for whoever it answers. */
  instructions?: string;
  /** The backend a session of it runs on, where a bot chooses one. */
  harness?: string;
  /** The model it asks for. */
  model?: string;
  /** The session preset it starts from. */
  preset?: string;
  /** The folder it works in, which is its own and never moves. */
  workspace: string;
  /** The machine it runs in, where it names one. */
  computer?: string;
  /** The session it is linked to, once one has been started for it. */
  session?: string;
  /** Whose it is. */
  owner: Owner;
  /** When it was made. */
  createdAt: string;
  /** When it was last written. */
  updatedAt: string;
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
  owner?: Owner | undefined;
  workspace?: string | undefined;
  description?: string | undefined;
  instructions?: string | undefined;
  harness?: string | undefined;
  model?: string | undefined;
  preset?: string | undefined;
  computer?: string | undefined;
  session?: string | undefined;
}

/** The keys a body may carry: a bot's own fields, and nothing else. */
const FIELDS = [
  'id', 'name', 'labels', 'description', 'body', 'color', 'instructions',
  'harness', 'model', 'preset', 'workspace', 'computer', 'session', 'owner',
  // The two times are here rather than refused, because a client that read a
  // bot and wrote the whole record back is writing what it was given. Neither
  // is read: what they hold is the host's.
  'createdAt', 'updatedAt',
];

/** An owner, as the four kinds the usage rules spell. */
const OWNER = /^(?:user|team|project|root):.+$/;

/**
 * Whether this is a slug a bot may have.
 *
 * Lowercase letters, digits and dashes, one to forty of them, starting with a
 * letter: the slug is a folder name and a URI path at once, and both of those
 * are safer with one spelling.
 */
export const isSlug = (slug: string): boolean => /^[a-z][a-z0-9-]{0,39}$/.test(slug);

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

/** One of a closed list, or the make's own default. */
const among = <T extends string>(said: unknown, list: readonly T[], missing: string, fallback: T): T => {
  if (said === undefined) return fallback;
  if (typeof said !== 'string' || !(list as readonly string[]).includes(said)) {
    throw new RpcError(INVALID_PARAMS, `${String(said)} is not ${missing}`);
  }
  return said as T;
};

/** A body at random, which is what a make that named none is drawn with. */
const drawn = (): BotBody => BOT_BODIES[Math.floor(Math.random() * BOT_BODIES.length)] ?? BOT_BODIES[0];

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
  if (said_ !== undefined && existing !== undefined && said_ !== existing.owner) {
    throw new RpcError(INVALID_PARAMS, `${said_} is not whose this bot is; it is ${existing.owner}`);
  }

  const workspace = line('workspace', body['workspace']);
  if (workspace !== undefined && existing !== undefined && workspace !== existing.workspace) {
    throw new RpcError(INVALID_PARAMS, `${workspace} is not where this bot works; it is ${existing.workspace}`);
  }

  return {
    name,
    labels: words(body['labels'], existing?.labels ?? []),
    body: among(body['body'], BOT_BODIES, 'a body a bot is drawn with', existing?.body ?? drawn()),
    color: among(body['color'], BOT_COLORS, 'a colour a bot is drawn in', existing?.color ?? BOT_COLORS[0]),
    owner: said_ as Owner | undefined,
    workspace,
    description: line('description', body['description']) ?? existing?.description,
    instructions: line('instructions', body['instructions']) ?? existing?.instructions,
    harness: line('harness', body['harness']) ?? existing?.harness,
    model: line('model', body['model']) ?? existing?.model,
    preset: line('preset', body['preset']) ?? existing?.preset,
    computer: line('computer', body['computer']) ?? existing?.computer,
    session: line('session', body['session']) ?? existing?.session,
  };
}
