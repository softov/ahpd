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

import { line, lines, recordsProvider, type Records, type RecordsProvider } from './records.js';
import { INVALID_PARAMS, RpcError } from './rpc.js';
import { grantProblem } from './users.js';
import type { Grant, Named, Users } from './types/users.js';

/** The four, in the order a client's screen would draw them. */
const SCHEMES = ['user', 'team', 'project', 'role'] as const;

/** One of the four schemes, which is also its grant subject. */
type Scheme = typeof SCHEMES[number];

/**
 * What one of the four providers implements.
 *
 * The provider itself is `records.ts`'s, over whichever store a scheme is:
 * these four are four `Records`, and what a client sees of them is the shared
 * one's rules.
 */
export type PeopleProvider = RecordsProvider;

/**
 * A refusal the directory made, said as the call's own.
 *
 * Every rule below is the port's, so the sentence a client gets here is the one
 * it would get from `ahpd team rm`: this is another door onto the same
 * directory, not a second set of rules.
 */
const said = (error: unknown): never => {
  throw new RpcError(INVALID_PARAMS, error instanceof Error ? error.message : String(error));
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
    throw new RpcError(INVALID_PARAMS, `A ${scheme} is written with ${key} as a list of strings`);
  }
  return (value as string[]).map((one) => one.trim()).filter((one) => one !== '');
};

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
        ...line('Issuer', 'The authorization server they sign in through, when it is not this host: `github`, or an issuer URL this host may reach. Empty removes it.'),
        nullable: true,
      },
      rolesFrom: {
        ...line('Roles from', 'The claim the issuer\'s answer carries their roles in, such as `groups`. Its values have to be role names too. Empty removes it.'),
        nullable: true,
      },
      memberships: lines('Memberships', 'What their work may be charged to, each written team, team:* or team:project, and each naming something this host holds.'),
      primary: {
        ...line('Primary', 'The membership their work naming no scope of its own is charged to. Empty removes it.'),
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
    description: what === 'team' ? 'Teams people belong to.' : 'Projects people work on.',
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
  /*
   * Operations, not verbs.
   *
   * A grant is `<subject>:<operation>` and the operation is one the subject
   * has - decision
   * `a-grant-names-an-operation-and-read-and-write-are-its-groups`. `read` and
   * `write` are still writable here because they are the two names that group a
   * subject's operations, and `*` is still either half.
   */
  description: 'What a person with this role may do.',
  manifest: {
    type: 'object',
    properties: {
      grants: lines('Grants', 'What this role allows, one subject:operation each. read and write cover a group of operations, and * covers all of them.'),
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
    if (grants === undefined) throw new RpcError(INVALID_PARAMS, 'A role is written from {"grants": ["session:read"]}; that body names none');
    /*
     * Checked here rather than left to the directory, so the refusal names the
     * subject's operations whether the directory behind this port is the file
     * or somebody else's: an operation no subject has would be a grant that
     * matches nothing, and the sentence is what lets somebody fix it.
     */
    for (const one of grants) {
      const why = grantProblem(one);
      if (why !== undefined) throw new RpcError(INVALID_PARAMS, why);
    }
    await directory.addRole(id, grants as Grant[]).catch(said);
  },
  drop: async (id) => directory.removeRole(id).catch(said),
});

/** Which of the four stores a scheme is read from. */
const recordsFor = (directory: Users, what: Scheme): Records =>
  (what === 'user' ? people(directory)
    : what === 'role' ? roles(directory)
      : named(directory, what));

/**
 * The four providers, by scheme, for a host that has a users directory.
 *
 * A host with no directory registers none: there is nothing to list, and a
 * scheme answering an empty root would be a client drawing a screen over a host
 * with no people in it.
 */
export const peopleProviders = (directory: Users): Record<string, PeopleProvider> =>
  Object.fromEntries(SCHEMES.map((what) => [what, recordsProvider(what, recordsFor(directory, what))]));
