/**
 * `ahpd user`: the people who may use this host, managed without one running.
 *
 * The path comes from `--users` or the configuration key and from nowhere else:
 * a verb that invented a file because neither was set would write a directory
 * nobody asked for, and the next daemon to start would not be the one that
 * reads it. Every sub-command declares the same fields, because the flags were
 * read out of the whole line before this and refusing one on `list` that `add`
 * takes would be a smaller surface than the one people have.
 */

import { hostname } from 'node:os';
import { ArgumentError, output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import { fileUsers } from '@ahpd/sdk';
import { loadConfig, personalUrl } from '../config.js';
import { refuse, userFields } from './options.js';

/**
 * The directory, its path and the address a URL would name.
 *
 * `--host` and `--port` here are for the daemon that was started with those
 * flags rather than with a configuration file, so `user token --url` names
 * where it actually is. The configuration's issuer is passed too, so
 * `user list` says where a record that names none signs in; nothing here asks
 * a network.
 */
function people(context: { input: Readonly<Record<string, unknown>>; surface?: string }) {
  const input = context.input;
  const named = typeof input['users'] === 'string' ? input['users'] : undefined;
  const from = loadConfig(typeof input['configFile'] === 'string' ? input['configFile'] : undefined);
  const path = named ?? from.users;
  if (path === undefined) refuse(context.surface, 'No user file. Pass --users <file> or set "users" in the configuration.');
  const where = {
    host: typeof input['host'] === 'string' ? input['host'] : typeof from.host === 'string' ? from.host : '127.0.0.1',
    port: typeof input['port'] === 'number' ? input['port'] : typeof from.port === 'number' ? from.port : 9187,
  };
  const directory = fileUsers({
    path,
    ...(typeof from.issuer === 'string' ? { issuer: from.issuer } : {}),
    onProblem: (line) => process.stderr.write(`${line}\n`),
  });
  return { path, where, directory };
}

/** The id a sub-command was given, refused the way the loop refused a flag. */
const idOf = (context: { value<T = string>(name: string): T; surface?: string }, verb: string): string => {
  const id = context.value<string>('id');
  if (id.startsWith('-')) refuse(context.surface, `user ${verb} takes an id: ahpd user ${verb} <id>`);
  return id;
};

export const declareUser = (registry: Registry<object>): Command[] => {
  const list = registry.action({
    id: 'user.list',
    summary: 'Who is in the file',
    surfaces: { cli: { pattern: ['user', 'list'] }, http: { method: 'GET', path: '/user/list' } },
    input: userFields,
    scopes: ['admin'],
    run: async (context) => {
      const { path, directory } = people(context);
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
        ].join(' ')).join('\n')}\n`;
      return output(rows, text);
    },
  });

  const add = registry.action({
    id: 'user.add',
    summary: 'Add a person',
    description: 'With --role <name> once per role and --issuer <name> for a provider of their own.',
    surfaces: { cli: { pattern: ['user', 'add', ':id'] }, http: { method: 'POST', path: '/user/add/{id}' } },
    input: { ...userFields, id: { type: 'string', description: 'The identifier their credential answers with.' } },
    scopes: ['admin'],
    run: async (context) => {
      const { directory } = people(context);
      const id = idOf(context, 'add');
      const roles = context.list<string>('role');
      const held = roles.length > 0 ? roles : ['guest'];
      const issuer = context.optional<string>('issuer');
      // A role name or an issuer name that resolves to nothing is refused by
      // the directory; said here so it reads as the verb's own refusal rather
      // than a stack trace.
      await directory.add(id, held, issuer === undefined ? {} : { issuer })
        .catch((error: unknown) => {
          refuse(context.surface, error instanceof Error ? error.message : String(error));
        });
      return output({ id, roles: held, ...(issuer === undefined ? {} : { issuer }) },
        `Added ${id} (${held.join(', ')})${issuer === undefined ? '' : ` through ${issuer}`}. Give them a credential: ahpd user token ${id}\n`);
    },
  });

  const rm = registry.action({
    id: 'user.rm',
    summary: 'Take a person out of the file',
    surfaces: { cli: { pattern: ['user', 'rm', ':id'] }, http: { method: 'POST', path: '/user/rm/{id}' } },
    input: { ...userFields, id: { type: 'string', description: 'The identifier to take out.' } },
    scopes: ['admin'],
    run: async (context) => {
      const { directory } = people(context);
      const id = idOf(context, 'rm');
      const gone = await directory.remove(id);
      if (!gone) {
        // Thrown rather than exited over HTTP: the process is the daemon, and
        // ending it would take every other client with it.
        if (context.surface === 'remote') throw new ArgumentError(`No user called ${id}.`);
        context.write(`No user called ${id}.\n`);
        process.exit(1);
      }
      return output({ id }, `Removed ${id}. Their socket stays open; their next connection is refused.\n`);
    },
  });

  const token = registry.action({
    id: 'user.token',
    summary: 'Mint a credential, shown once',
    description: 'The bare secret by default, so it can be piped; --url prints the whole ws:// URL a client can be given.',
    surfaces: { cli: { pattern: ['user', 'token', ':id'] }, http: { method: 'POST', path: '/user/token/{id}' } },
    input: { ...userFields, id: { type: 'string', description: 'Whose credential to mint.' } },
    scopes: ['admin'],
    run: async (context) => {
      const { where, directory } = people(context);
      const id = idOf(context, 'token');
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

  return [list, add, rm, token];
};
