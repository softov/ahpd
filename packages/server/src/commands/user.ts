/**
 * `ahpd user`: the people who may use this host, managed without one running.
 *
 * The path comes from `--users` or the configuration key and from nowhere else:
 * a verb that invented a file because neither was set would write a directory
 * nobody asked for, and the next daemon to start would not be the one that
 * reads it. Every sub-command accepts the file and the address, so a flag is
 * accepted wherever on the line it is typed; what a record is written with is
 * declared by the verb that writes it. Served over HTTP, the file and the
 * address are the daemon's own and the request cannot name either.
 */

import { hostname } from 'node:os';
import { output } from '@cofold/commands';
import type { Command, CommandContext, Registry } from '@cofold/commands';
import { HttpError } from '@cofold/remote';
import { covers, fileUsers, refusalReason } from '@ahpd/sdk';
import type { Grant, Principal, Users } from '@ahpd/sdk';
import { loadConfig, personalUrl } from '../config.js';
import { isRoot, SIGN_IN } from './authorize.js';
import { conflict, servedUserAddFields, servedUserPrimaryFields, servedUserTokenFields, stop, unsetField, userAddFields, userAt, userPrimaryFields, userTokenFields } from './options.js';
import type { ServedFacts } from './served.js';

/**
 * Whether a caller may give a role, or write for a person, at all.
 *
 * `user:write` says a caller manages people; what it may hand out is bounded by
 * what it holds, or granting a role it does not have is `admin` under another
 * name - decision `a-caller-gives-only-the-grants-it-holds`. The terminal's own
 * run has no caller to hold to anything, and the deployment token holds every
 * grant. A served call with nobody behind it is refused here as the registry's
 * hook refuses it, so the bound holds whatever hook the registry was built with.
 */
export const bounded = (context: Pick<CommandContext, 'request' | 'surface'>, grants: readonly Grant[]): void => {
  if (context.surface === 'cli') return;
  const actor = context.request?.actor as Principal | undefined;
  if (actor === undefined) throw new HttpError(401, SIGN_IN);
  if (isRoot(actor)) return;
  const missing = grants.find((one) => !actor.can(one));
  if (missing !== undefined) throw new HttpError(403, refusalReason(actor.id, missing));
};

/**
 * The directory, its path and the address a URL would name.
 *
 * The address is read for the daemon that was started with `--host` and
 * `--port` rather than with a configuration file, so `user token --url` names
 * where it actually is; those two are that verb's flags alone, and every other
 * verb is refused them. The configuration's issuer is passed too, so
 * `user list` says where a record that names none signs in; nothing here asks
 * a network. Served, the daemon's own directory and bound address are used, and
 * a daemon with no directory refuses.
 */
export function people(
  context: { input: Readonly<Record<string, unknown>>; surface?: string; error(text: string): void },
  served?: ServedFacts,
) {
  if (served !== undefined) {
    const path = served.options.users;
    if (path === undefined || served.users === undefined) {
      stop('This daemon was started without a users file, so it has no people to manage.');
    }
    const here = served.running();
    return { path, where: { host: here.host, port: here.port }, directory: served.users };
  }
  const input = context.input;
  const named = typeof input['users'] === 'string' ? input['users'] : undefined;
  const from = loadConfig(typeof input['configFile'] === 'string' ? input['configFile'] : undefined).values;
  const path = named ?? from.users;
  if (path === undefined) stop('No user file. Pass --users <file> or set "users" in the configuration.');
  const where = {
    host: typeof input['host'] === 'string' ? input['host'] : typeof from.host === 'string' ? from.host : '127.0.0.1',
    port: typeof input['port'] === 'number' ? input['port'] : typeof from.port === 'number' ? from.port : 9187,
  };
  const directory = fileUsers({
    path,
    ...(typeof from.issuer === 'string' ? { issuer: from.issuer } : {}),
    onProblem: (line) => { context.error(line); },
  });
  return { path, where, directory };
}

/** The id a sub-command was given; one spelled like an option is refused as an unknown flag would be. */
export const idOf = (context: { value<T = string>(name: string): T }, command: string): string => {
  const id = context.value<string>('id');
  if (id.startsWith('-')) stop(`${command} takes an id: ahpd ${command} <id>`);
  return id;
};

/**
 * The record of somebody who is in the file, or the refusal of one who is not.
 *
 * A verb that changes a person's memberships takes their roles with it, so it
 * has to read the record to write it back, and reading it is also the check
 * that the id names somebody at all.
 */
const recordOf = async (directory: Users, id: string) => {
  const one = (await directory.list()).find((row) => row.id === id);
  if (one === undefined) stop(`No user called ${id}.`);
  return one;
};

export const declareUser = (registry: Registry<object>, served?: ServedFacts): Command[] => {
  /** Where a person is managed: served, the daemon's own file and address, so no field could name another. */
  const at = served === undefined ? userAt : {};
  /** The whole record, which is what `user add` writes. */
  const whole = served === undefined ? userAddFields : servedUserAddFields;
  /** The flag `user token` prints a whole URL with, which no other verb reads. */
  const showing = served === undefined ? userTokenFields : servedUserTokenFields;
  /** The unset, which is what `user primary` writes when it is not setting one. */
  const unsetting = served === undefined ? userPrimaryFields : servedUserPrimaryFields;

  const list = registry.action({
    id: 'user.list',
    summary: 'Who is in the file',
    surfaces: { cli: { pattern: ['user', 'list'] }, http: { method: 'GET', path: '/user/list' } },
    input: at,
    // The two the answer is made of: who they are, and what the roles they
    // hold resolved to - decision
    // `people-are-resource-schemes-with-a-grant-each`.
    scopes: ['user:read', 'role:read'],
    run: async (context) => {
      const { path, directory } = people(context, served);
      const rows = await directory.list();
      // The roles they hold, what those roles resolve to, whether the door
      // already identifies them or they still have to sign in, and through
      // which issuer when it is not this host that vouches for them.
      const text = rows.length === 0
        ? `no users in ${path}\n`
        : `${rows.map((one) => [
          one.id,
          one.roles.length > 0 ? `(${one.roles.join(', ')})` : '(no roles)',
          one.grants.length > 0 ? one.grants.join(' ') : 'nothing',
          one.trusted ? 'trusted' : 'sign-in',
          ...(one.issuer === undefined ? [] : [one.issuer]),
          ...(one.rolesFrom === undefined ? [] : [`rolesFrom=${one.rolesFrom}`]),
          // Who their work may be charged to, which is what they may name and
          // where it lands when the work names none of it.
          ...(one.memberships === undefined || one.memberships.length === 0 ? [] : [`of ${one.memberships.join(' ')}`]),
          ...(one.primary === undefined ? [] : [`primary ${one.primary}`]),
        ].join(' ')).join('\n')}\n`;
      return output(rows, text);
    },
  });

  const add = registry.action({
    id: 'user.add',
    summary: 'Add a person',
    description: 'With --role <name> once per role, --membership <team[:project]> for what their work may be charged to, --primary <team[:project]> for where work naming no scope of its own lands, and --issuer <name> for a provider of their own.',
    surfaces: { cli: { pattern: ['user', 'add', ':id'] }, http: { method: 'POST', path: '/user/add/{id}' } },
    input: { ...whole, id: { type: 'string', description: 'The identifier their credential answers with.' } },
    scopes: ['user:write'],
    run: async (context) => {
      const { directory } = people(context, served);
      const id = idOf(context, 'user add');
      const roles = context.list<string>('role');
      const held = roles.length > 0 ? roles : ['guest'];
      const issuer = context.optional<string>('issuer');
      // Adding a person who is already in the file replaces their roles, so
      // the roles they hold now are bounded as well as the ones being given.
      const current = await directory.grantsOfPerson(id) ?? [];
      bounded(context, [...await directory.grantsOfRoles(held), ...current]);
      const memberships = context.list<string>('membership');
      const primary = context.optional<string>('primary');
      /*
       * Each left alone when the flag is not there, the way `issuer` is: adding
       * a role to somebody who already belongs to a team must not move their
       * work. `primary` is checked against the memberships named here, and
       * against the record's own when none are.
       */
      const record = {
        ...(issuer === undefined ? {} : { issuer }),
        ...(memberships.length === 0 ? {} : { memberships }),
        ...(primary === undefined ? {} : { primary }),
      };
      // A role, an issuer, a membership or a primary that names nothing is
      // refused by the directory; said here so it reads as the verb's own
      // refusal rather than a stack trace.
      await directory.add(id, held, record)
        .catch((error: unknown) => {
          stop(error instanceof Error ? error.message : String(error));
        });
      return output(
        { id, roles: held, ...record },
        `Added ${id} (${held.join(', ')})${issuer === undefined ? '' : ` through ${issuer}`}`
        + `${memberships.length === 0 ? '' : `, of ${memberships.join(' ')}`}`
        + `. Give them a credential: ahpd user token ${id}\n`);
    },
  });

  const rm = registry.action({
    id: 'user.rm',
    summary: 'Take a person out of the file',
    surfaces: { cli: { pattern: ['user', 'rm', ':id'] }, http: { method: 'POST', path: '/user/rm/{id}' } },
    input: { ...at, id: { type: 'string', description: 'The identifier to take out.' } },
    scopes: ['user:write'],
    run: async (context) => {
      const { directory } = people(context, served);
      const id = idOf(context, 'user rm');
      const target = await directory.grantsOfPerson(id);
      if (target !== undefined) bounded(context, target);
      const gone = await directory.remove(id);
      if (!gone) conflict(`No user called ${id}.`);
      return output({ id }, `Removed ${id}. Their socket stays open; their next connection is refused.\n`);
    },
  });

  const token = registry.action({
    id: 'user.token',
    summary: 'Mint a credential, shown once',
    description: 'The bare secret by default, so it can be piped; --url prints the whole ws:// URL a client can be given.',
    surfaces: { cli: { pattern: ['user', 'token', ':id'] }, http: { method: 'POST', path: '/user/token/{id}' } },
    input: { ...showing, id: { type: 'string', description: 'Whose credential to mint.' } },
    scopes: ['user:write'],
    run: async (context) => {
      const { where, directory } = people(context, served);
      const id = idOf(context, 'user token');
      const target = await directory.grantsOfPerson(id);
      if (target !== undefined) bounded(context, target);
      const secret = await directory.mint(id);
      /*
       * The bare secret by default, so it can be piped, and the whole URL when
       * asked for: a client that can only carry a connection token is given
       * one thing to paste rather than two to assemble. The warning goes to
       * stderr either way, so stdout stays the credential alone.
       */
      const asUrl = context.flag('url');
      const shown = asUrl ? personalUrl(secret, where.host, where.port, hostname()) : secret;
      context.error(asUrl
        ? 'Shown once. Only its hash is stored, and minting again replaces it. Paste the URL where a client asks for a host.'
        : 'Shown once. Only its hash is stored, and minting again replaces it.');
      return output(shown, `${shown}\n`);
    },
  });

  const member = registry.action({
    id: 'user.member',
    summary: 'What their work may be charged to',
    description: 'Replaces the whole list. Each entry is team, team:* or team:project, and the teams and projects have to be named already: ahpd team add, ahpd project add. --unset takes the whole list away.',
    surfaces: { cli: { pattern: ['user', 'member', ':id', ':entries...'] }, http: { method: 'POST', path: '/user/member/{id}' } },
    input: {
      ...at,
      unset: { ...unsetField, description: 'Take every membership away, rather than naming one.' },
      id: { type: 'string', description: 'Whose memberships to replace.' },
      entries: { type: 'array', items: { type: 'string' }, description: 'A team, team:* or team:project. One or more.' },
    },
    scopes: ['user:write'],
    run: async (context) => {
      const { directory } = people(context, served);
      const id = idOf(context, 'user member');
      const entries = context.list<string>('entries');
      const away = context.flag('unset');
      if (away && entries.length > 0) stop('--unset and a membership cannot both be given.');
      const one = await recordOf(directory, id);
      /*
       * The empty list is a request rather than a missing argument: over
       * `/api` the entries are the body, and a body that names none is how a
       * person is taken off every team. On a line the entries are positional,
       * so the same request is spelled --unset.
       */
      const wanted = away || entries.length === 0 ? [] : entries;
      // A membership naming a team or a project this file does not hold is
      // refused by the directory, said here so it reads as the verb's own.
      await directory.add(id, one.roles, { memberships: wanted })
        .catch((error: unknown) => {
          stop(error instanceof Error ? error.message : String(error));
        });
      /*
       * A primary the new list does not cover is taken away, and said.
       *
       * Refusing here would refuse the only way out: a person cannot leave a
       * team whose primary they are on before they can name another. The line
       * says so, because their work lands somewhere else afterwards.
       */
      const lost = one.primary !== undefined && !covers(wanted, one.primary) ? one.primary : undefined;
      if (wanted.length === 0) {
        return output({ id, memberships: [] },
          `${id} may charge their work to nothing`
          + `${lost === undefined ? '.' : `; their primary ${lost} was taken away with it.`}\n`);
      }
      return output({ id, memberships: wanted, ...(lost === undefined ? {} : { dropped: lost }) },
        `${id} may charge their work to ${wanted.join(', ')}`
        + `${lost === undefined ? '' : `; their primary ${lost} is not one of these, so it was taken away`}.\n`);
    },
  });

  const primary = registry.action({
    id: 'user.primary',
    summary: 'Where their work that names no team and project is charged',
    description: 'One of their own memberships, or --unset to take the one they have away. A person may set their own; changing another\'s needs user:write.',
    surfaces: { cli: { pattern: ['user', 'primary', ':id', ':entry?'] }, http: { method: 'POST', path: '/user/primary/{id}' } },
    input: {
      ...unsetting,
      id: { type: 'string', description: 'Whose primary to set or take away.' },
      entry: { type: 'string', description: 'One of their memberships, written team or team:project.' },
    },
    /*
     * No grant of its own: the body decides, because the one question is
     * whether the record being written is the caller's own, and a declaration
     * cannot say that.
     */
    scopes: [],
    run: async (context) => {
      const { directory } = people(context, served);
      const id = idOf(context, 'user primary');
      const entry = context.optional<string>('entry');
      const away = context.flag('unset');
      if (entry === undefined && !away) {
        stop('user primary takes a membership to charge to, or --unset to take theirs away: ahpd user primary <id> <team[:project]>, ahpd user primary <id> --unset');
      }
      if (entry !== undefined && away) stop('--unset and a membership cannot both be given.');
      const actor = context.request?.actor as Principal | undefined;
      // One's own primary is a person's own business - decision
      // `a-request-naming-no-scope-uses-the-persons-primary` - and it grants
      // nothing, so holding `user:write` is asked only for somebody else's.
      if (actor?.id !== id) bounded(context, ['user:write']);
      const one = await recordOf(directory, id);
      // `null` is how a primary is taken away, which is not the same as not
      // naming one: the second leaves whatever they had.
      const wanted = away ? { primary: null } : entry === undefined ? {} : { primary: entry };
      await directory.add(id, one.roles, wanted)
        .catch((error: unknown) => {
          stop(error instanceof Error ? error.message : String(error));
        });
      if (away) return output({ id, primary: null }, `${id} has no primary, so work naming no team and project has nowhere to land.\n`);
      return output({ id, primary: entry }, `${id} charges work that names no team and project to ${entry}.\n`);
    },
  });

  return [list, add, rm, token, member, primary];
};
