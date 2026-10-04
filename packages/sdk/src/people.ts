/**
 * The four schemes the users directory is served under.
 *
 * People, teams, projects and roles were reachable only from the CLI and
 * `/api`, under one `users` subject for all of them. Here they are `user:`,
 * `team:`, `project:` and `role:` resource schemes, advertised the way
 * `computer:` is and gated by the grant whose subject is the scheme - decision
 * `people-are-resource-schemes-with-a-grant-each`.
 *
 * A record is a file whose bytes are its JSON, and the scheme's root is a
 * directory of them. There is no leaf under a record and no directory but the
 * root: a team is an id and a title, a person is a record, and a hierarchy
 * under either would be something the file has nowhere to hold.
 *
 * Nothing here answers with a credential. The hash is in the file and the
 * secret behind it was shown once by `user token`; every answer below is built
 * from the `Users` port, which has never returned the hash and does not now.
 */

import { RpcError } from './rpc.js';
import type { Entry, Metadata, Read, ResourceProvider, SchemeDescription, Write } from './types/resources.js';
import type { Grant, Named, Users } from './types/users.js';

/** The four, in the order a client's screen would draw them. */
const SCHEMES = ['user', 'team', 'project', 'role'] as const;

/**
 * What one of the four providers implements.
 *
 * Narrower than `ResourceProvider`, whose members are all but `read` optional:
 * each of these four has all of them, so a caller holding one should not have
 * to test for what is always there.
 */
export interface PeopleProvider extends ResourceProvider {
  list(uri: string): Promise<Entry[]>;
  resolve(uri: string, followSymlinks?: boolean): Promise<Metadata>;
  read(uri: string, wanted?: string): Promise<Read>;
  write(uri: string, content: Write): Promise<void>;
  remove(uri: string, recursive?: boolean): Promise<void>;
  describe(): SchemeDescription;
}

/** One of the four schemes, which is also its grant subject. */
type Scheme = typeof SCHEMES[number];

/**
 * One scheme's records, as five questions about them.
 *
 * Every scheme answers the same five, so nothing below the interface has to
 * know which one it is serving: the URI and the body are read once, and what a
 * record is made of is the scheme's own business.
 */
interface Records {
  /** What the scheme is called on screen. */
  readonly title: string;
  /** One line about what a record is. */
  readonly description: string;
  /** The body a write to the scheme's root makes something from. */
  readonly manifest: Record<string, unknown>;
  /** Every record's id, in the order the file lists them. */
  ids(): Promise<string[]>;
  /** One record as it stands, or nothing when the directory holds none. */
  find(id: string): Promise<Record<string, unknown> | undefined>;
  /** Name one, or edit the one already there. */
  put(id: string, body: Record<string, unknown>): Promise<void>;
  /** Take one out. `true` when one was there. */
  drop(id: string): Promise<boolean>;
}

/**
 * A refusal the directory made, said as the call's own.
 *
 * Every rule below is the port's, so the sentence a client gets here is the one
 * it would get from `ahpd team rm`: this is another door onto the same
 * directory, not a second set of rules.
 */
const said = (error: unknown): never => {
  throw new RpcError(-32602, error instanceof Error ? error.message : String(error));
};

/**
 * A write's body, decoded and parsed, or a refusal saying what a body is.
 *
 * An empty body is an empty object rather than a refusal, so a client that
 * writes nothing to name a team means exactly that.
 */
const bodyOf = (content: Write, scheme: string): Record<string, unknown> => {
  const text = content.encoding === 'base64' ? Buffer.from(content.data, 'base64').toString('utf8') : content.data;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text === '' ? '{}' : text);
  }
  catch {
    throw new RpcError(-32602, `A ${scheme} is made from a JSON object; that body is not one`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RpcError(-32602, `A ${scheme} is made from a JSON object, and that body is not one`);
  }
  return parsed as Record<string, unknown>;
};

/** One field of text, or nothing when the body said nothing usable. */
const textOf = (held: Record<string, unknown>, key: string): string | undefined => {
  const value = held[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
};

/** One list of text, or nothing when the body said none or said something else. */
const listOf = (held: Record<string, unknown>, key: string, scheme: string): string[] | undefined => {
  const value = held[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((one) => typeof one !== 'string')) {
    throw new RpcError(-32602, `A ${scheme} is written with ${key} as a list of strings`);
  }
  return (value as string[]).map((one) => one.trim()).filter((one) => one !== '');
};

/** A record as a client reads it: its JSON, indented, as every other scheme writes one. */
const asFile = (data: string): Read =>
  ({ data, encoding: 'utf-8', contentType: 'application/json' });

/**
 * When a record was made, which this directory does not keep.
 *
 * The file holds no timestamp for a person, a team or a role, and inventing one
 * - the time of this read - would be a client told a record changed when
 * nothing did. The epoch is the answer every store without a clock gives.
 */
const moment = '1970-01-01T00:00:00.000Z';

/** One manifest field that is a line of text. */
const line = (title: string, description: string): Record<string, unknown> =>
  ({ type: 'string', title, description });

/** One manifest field that is a list of text. */
const lines = (title: string, description: string): Record<string, unknown> =>
  ({ type: 'array', title, description, items: { type: 'string' } });

/**
 * `user:`: a person, and the whole of what the file holds about them.
 *
 * The record is the one `ahpd user list` prints, and a client that read one and
 * wrote the same JSON back has not changed them. What is refused here is what
 * the port refuses - a role nothing defines, a membership naming a team this
 * file does not hold - because the scheme is another door onto the same
 * directory rather than a second set of rules.
 */
const people = (directory: Users): Records => ({
  title: 'People',
  description: 'Somebody who may use this host, and what their record holds.',
  manifest: {
    type: 'object',
    properties: {
      roles: {
        ...lines('Roles', 'What they hold. Every one has to be a role this host defines.'),
        default: ['guest'],
      },
      issuer: {
        ...line('Issuer', 'The authorization server they sign in through, when it is not this host: `github`, or an issuer URL this host may reach. `null` takes the one they have away.'),
        nullable: true,
      },
      rolesFrom: {
        ...line('Roles from', 'The claim the issuer\'s answer carries their roles in, such as `groups`. Its values have to be role names too. `null` takes the one they have away.'),
        nullable: true,
      },
      memberships: lines('Memberships', 'What their work may be charged to, each written team, team:* or team:project, and each naming something this host holds.'),
      primary: {
        ...line('Primary', 'The membership their work naming no scope of its own is charged to. `null` takes the one they have away.'),
        nullable: true,
      },
    },
  },
  ids: async () => (await directory.list()).map((one) => one.id),
  find: async (id) => {
    const held = (await directory.list()).find((one) => one.id === id);
    return held === undefined ? undefined : { ...held } as Record<string, unknown>;
  },
  put: async (id, body) => {
    const was = (await directory.list()).find((one) => one.id === id);
    const roles = listOf(body, 'roles', 'person');
    const memberships = listOf(body, 'memberships', 'person');
    // `null` is how an issuer, a roles-from and a primary are taken away, and
    // how leaving a team is not.
    const issuer = body['issuer'] === null ? null : textOf(body, 'issuer');
    const rolesFrom = body['rolesFrom'] === null ? null : textOf(body, 'rolesFrom');
    const primary = body['primary'] === null ? null : textOf(body, 'primary');
    /*
     * A field the body does not name is the one the record already had.
     *
     * The port replaces the roles and the memberships it is given and leaves
     * the rest alone, so a body naming only a primary does not quietly move
     * somebody off their team. Somebody who was not there is made `guest`,
     * which is what `ahpd user add` makes of one given no role.
     */
    await directory.add(id, roles ?? was?.roles ?? ['guest'], {
      ...(issuer === undefined ? {} : { issuer }),
      ...(rolesFrom === undefined ? {} : { rolesFrom }),
      ...(memberships === undefined ? {} : { memberships }),
      ...(primary === undefined ? {} : { primary }),
    }).catch(said);
  },
  drop: async (id) => directory.remove(id),
});

/**
 * `team:` and `project:`: a name a membership is written out of.
 *
 * One declaration told which it is, the way `ahpd team` and `ahpd project`
 * share a verb set: a team and a project are both an id and a title, and which
 * list either is an entry of is the file's own decision.
 */
const named = (directory: Users, what: 'team' | 'project'): Records => {
  const rows = (): Promise<Named[]> => (what === 'team' ? directory.teams() : directory.projects());
  const name = (id: string, title?: string): Promise<void> =>
    (what === 'team' ? directory.addTeam(id, title) : directory.addProject(id, title));
  const unname = (id: string): Promise<boolean> =>
    (what === 'team' ? directory.removeTeam(id) : directory.removeProject(id));
  return {
    title: what === 'team' ? 'Teams' : 'Projects',
    description: `What this install names as a ${what}, and what a membership may be written out of.`,
    manifest: {
      type: 'object',
      properties: {
        // The id is the URI, so a body naming one is a body saying two things
        // and one of them is the address.
        title: line('Title', 'What a client shows instead of the id.'),
      },
    },
    ids: async () => (await rows()).map((one) => one.id),
    find: async (id) => {
      const held = (await rows()).find((one) => one.id === id);
      return held === undefined ? undefined : { ...held };
    },
    // Naming one that is already there sets its title and moves nothing, which
    // is what this directory has always done and what an edit has to be.
    put: async (id, body) => { await name(id, textOf(body, 'title')).catch(said); },
    drop: async (id) => unname(id).catch(said),
  };
};

/**
 * `role:`: a name a record holds, and the whole of what it confers.
 *
 * A role is its grants and nothing else, so this is the shortest of the four:
 * no title to show, and no id in the body, because the URI is the name a
 * person's `roles` entry is written with.
 */
const roles = (directory: Users): Records => ({
  title: 'Roles',
  description: 'What a person holding this role may do, as <subject>:<verb>.',
  manifest: {
    type: 'object',
    properties: {
      grants: lines('Grants', 'What somebody holding this role may do. `*` stands in for either half, as it does in every other role.'),
    },
    required: ['grants'],
  },
  ids: async () => (await directory.roles()).map((one) => one.id),
  find: async (id) => {
    const held = (await directory.roles()).find((one) => one.id === id);
    return held === undefined ? undefined : { id: held.id, grants: [...held.grants] };
  },
  put: async (id, body) => {
    const grants = listOf(body, 'grants', 'role');
    /*
     * The one body here that must name something.
     *
     * A person holding a role that confers nothing holds nothing, and reads
     * on every later call exactly like somebody whose role was misspelled -
     * which is the reading the directory already refuses to give at
     * `user add`.
     */
    if (grants === undefined) throw new RpcError(-32602, 'A role is written from {"grants": ["file:read"]}; that body names none');
    await directory.addRole(id, grants as Grant[]).catch(said);
  },
  drop: async (id) => directory.removeRole(id).catch(said),
});

/** A URI, split into the record it names and the leaf under it. */
interface At {
  /** The record's id, empty at the root. */
  id: string;
  /** Empty for every record here, because nothing is under one. */
  leaf: string;
}

const providerFor = (directory: Users, what: Scheme): PeopleProvider => {
  const records: Records = what === 'user' ? people(directory)
    : what === 'role' ? roles(directory)
      : named(directory, what);

  const split = (uri: string): At => {
    const match = /^([a-zA-Z][\w+.-]*):\/\/(.*)$/.exec(uri);
    if (match === null || match[1] !== what) throw new RpcError(-32609, `${uri} is not a ${what}: URI`);
    const rest = match[2] ?? '';
    const slash = rest.indexOf('/');
    return slash === -1 ? { id: rest, leaf: '' } : { id: rest.slice(0, slash), leaf: rest.slice(slash + 1) };
  };
  const absent = (uri: string): RpcError => new RpcError(-32008, `No ${what} resource at ${uri}`);
  const description: SchemeDescription = {
    title: records.title,
    description: records.description,
    manifest: records.manifest,
  };

  return {
    describe: () => description,

    list: async (uri) => {
      const at = split(uri);
      if (at.leaf !== '') throw absent(uri);
      if (at.id !== '') throw new RpcError(-32008, `${uri} is a ${what}; list ${what}://`);
      return (await records.ids()).map((one): Entry => ({ name: one, type: 'file' }));
    },

    resolve: async (uri) => {
      const at = split(uri);
      if (at.id === '') return { uri, type: 'directory', mtime: moment, ctime: moment } as Metadata;
      if (at.leaf !== '') throw absent(uri);
      const body = JSON.stringify(await records.find(at.id), null, 2);
      /*
       * `size` is the body that was there, or the body that would be: a URI
       * naming no record still has the shape of one, which is what a client
       * drawing a form before it asks for anything needs to know.
       */
      return {
        uri,
        type: 'file',
        size: Buffer.byteLength(body ?? '', 'utf8'),
        // No etag. `ifMatch` would then be a validator nothing computed, and a
        // stale one is worse than none for a record whose whole value is a read.
        mtime: moment,
        ctime: moment,
      } as Metadata;
    },

    read: async (uri) => {
      const at = split(uri);
      if (at.id === '') throw new RpcError(-32008, `${uri} is the ${what} directory; read ${what}://<id>`);
      if (at.leaf !== '') throw absent(uri);
      const held = await records.find(at.id);
      if (held === undefined) throw absent(uri);
      return asFile(JSON.stringify(held, null, 2));
    },

    /**
     * A record is made or edited here, and the URI is its id.
     *
     * The same body either way, because a person and a team are written whole:
     * a field the body does not name is the one the record already had, and a
     * client that read a record and wrote it back has changed nothing.
     */
    write: async (uri, content) => {
      const at = split(uri);
      if (at.id === '') throw new RpcError(-32602, `${uri} is not a name for a new ${what}; write to ${what}://<id>`);
      if (at.leaf !== '') throw new RpcError(-32602, `${uri} is not something to write; a ${what} is written whole, at ${what}://<id>`);
      // `createOnly` is the protocol's own word for refusing one that is there.
      if (content.createOnly === true && (await records.find(at.id)) !== undefined) {
        throw new RpcError(-32010, `${at.id} is already a ${what}; edit it or choose another id`);
      }
      await records.put(at.id, bodyOf(content, what));
    },

    /**
     * A record is taken out here.
     *
     * Refused while something still names it - a membership naming a team, a
     * record holding a role - and it says who, which is the refusal the command
     * of the same name makes.
     */
    remove: async (uri) => {
      const at = split(uri);
      if (at.id === '') throw new RpcError(-32602, `${uri} is the ${what} directory; remove ${what}://<id>`);
      if (at.leaf !== '') throw absent(uri);
      if (!await records.drop(at.id)) throw absent(uri);
    },
  };
};

/**
 * The four providers, by scheme, for a host that has a users directory.
 *
 * A host with no directory registers none: there is nothing to list, and a
 * scheme answering an empty root would be a client drawing a screen over a host
 * with no people in it.
 */
export const peopleProviders = (directory: Users): Record<string, PeopleProvider> =>
  Object.fromEntries(SCHEMES.map((what) => [what, providerFor(directory, what)]));
