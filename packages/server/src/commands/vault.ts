/**
 * `ahpd vault`: the secrets this host's work needs, by name and never printed.
 *
 * Three actions declared once each and told which they are, the way `usage` is:
 * served, the vault is the daemon's own and a plugin may have replaced it; at a
 * terminal it is the file beside the configuration. A value is never taken from
 * argv, because argv is in `ps` and in the shell's history, so the terminal
 * reads it from piped standard input and refuses a terminal there, where there
 * is no way to ask for one without echoing it back.
 *
 * What these answer is a name and whether it is set. A name is not a secret, so
 * the listing can say everything about where a value comes from and nothing
 * about what it is.
 */

import { output } from '@cofold/commands';
import type { Command, CommandContext, Registry } from '@cofold/commands';
import { HttpError } from '@cofold/remote';
import { membership, scopeOf, secretRef } from '@ahpd/sdk';
import type { Principal, Vault } from '@ahpd/sdk';
import { loadConfig, vaultPath } from '../config.js';
import { fileVault } from '../vault.js';
import { isRoot } from './authorize.js';
import { conflict, stop, vaultAt } from './options.js';
import type { ServedFacts } from './served.js';
import { bounded } from './user.js';

/**
 * The store this run reads and writes.
 *
 * Served, the daemon's own, which a plugin may have replaced. On a line it is
 * the file beside the configuration, the way `usage` reads its folder: a verb
 * that let a flag name a vault would answer about a store nothing else reads.
 */
const vaultOf = (served?: ServedFacts): Vault => {
  if (served !== undefined) {
    if (served.vault === undefined) stop('This daemon has no vault, so it has no secrets to manage.');
    return served.vault();
  }
  return fileVault({ file: vaultPath() });
};

/**
 * Whether this caller may write this name.
 *
 * `host:` is the daemon's own configuration and takes `config:write`, `team:`
 * takes `team:write` and a membership in that team, and `user:` is the person's
 * own and takes nothing but being them. No grant of its own: these are the
 * grants the scopes already named, asked again where a secret's scope is the
 * question, as decision `a-secret-is-named-in-a-host-team-or-user-scope` says.
 */
const mayWrite = (context: Pick<CommandContext, 'request' | 'surface'>, name: string): void => {
  const actor = context.request?.actor as Principal | undefined;
  if (actor === undefined || isRoot(actor)) return;
  const scope = scopeOf(name);
  if (scope.scope === 'team') {
    bounded(context, ['team:write']);
    if (!(actor.memberships ?? []).some((one) => membership(one)?.team === scope.team)) {
      throw new HttpError(403, `${actor.id} is not on ${scope.team}, so ${name} is not theirs to write`);
    }
    return;
  }
  if (scope.scope === 'user') {
    if (actor.id !== scope.user) throw new HttpError(403, `${name} is ${scope.user}'s own secret`);
    return;
  }
  bounded(context, ['config:write']);
};

/**
 * Whether this caller may see this name, which is the same scopes written the
 * way `list` reads them: `config:read` for `host:` and the writer's own rule for
 * a team's and a person's, since a name nobody may write is a name nobody may
 * be told about either.
 */
const mayList = (context: Pick<CommandContext, 'request' | 'surface'>, name: string): void => {
  if (scopeOf(name).scope === 'host') {
    const actor = context.request?.actor as Principal | undefined;
    if (actor === undefined || isRoot(actor)) return;
    bounded(context, ['config:read']);
    return;
  }
  mayWrite(context, name);
};

/** The caller's refusal for one name, caught rather than thrown by the listing below. */
const refused = (context: Pick<CommandContext, 'request' | 'surface'>, name: string): boolean => {
  try {
    mayList(context, name);
    return false;
  }
  catch {
    return true;
  }
};

/**
 * Every `$secret` name the configuration names, and where it named it.
 *
 * A name may be written down before anybody has set it, which is what a plugin
 * somebody is preparing looks like, and a listing that answered only about the
 * names the vault holds would not show that the plugin is waiting for one.
 */
const referencedIn = (value: unknown, at: string): Map<string, string> => {
  const named = new Map<string, string>();
  const ref = secretRef(value);
  if (ref !== undefined) {
    named.set(ref, at);
    return named;
  }
  if (Array.isArray(value)) {
    for (const [index, one] of value.entries()) {
      for (const [name, where] of referencedIn(one, `${at}[${String(index)}]`)) {
        if (!named.has(name)) named.set(name, where);
      }
    }
    return named;
  }
  if (typeof value !== 'object' || value === null) return named;
  for (const [key, one] of Object.entries(value)) {
    for (const [name, where] of referencedIn(one, at === '' ? key : `${at}.${key}`)) {
      if (!named.has(name)) named.set(name, where);
    }
  }
  return named;
};

/** One name as the listing answers it, and never a value. */
export interface SecretRow {
  /** The name, as `host:`, `team:` or `user:` spells it. */
  name: string;
  /** Whether the vault holds a value for it. */
  set: boolean;
  /** Where the configuration names it, for one the vault does not hold. */
  referenced?: string;
}

export const declareVault = (registry: Registry<object>, served?: ServedFacts): Command[] => {
  /*
   * Where the vault is, and no other daemon flag; served, the daemon's own, so
   * no field could name another.
   *
   * It is `vault list`'s alone among the three. A listing reads a configuration
   * to say where a name is referenced before it is set, and the two that write
   * reach `vaultPath()` - the vault beside the configuration this run reads - so
   * a flag naming another file would keep a secret in a store nothing else
   * opens, and one that took the flag and read it by nothing is worse still.
   */
  const fields = served === undefined ? vaultAt : {};
  const writing = {};

  const set = registry.action({
    id: 'vault.set',
    summary: 'Keep a value under a name',
    description: 'At a terminal the value is standard input, pipe the value on standard input, and never the command line. Over /api it is the body\'s "value".',
    surfaces: { cli: { pattern: ['vault', 'set', ':name'] }, http: { method: 'POST', path: '/vault/set/{name}' } },
    input: {
      ...writing,
      name: { type: 'string', description: 'The name to keep it under, as host:<name>, team:<team>/<name> or user:<id>/<name>.' },
      ...(served === undefined ? {} : { value: { type: 'string', description: 'The value to keep. No verb here ever answers it.' } }),
    },
    /*
     * No grant of its own, because the grant depends on the name and a
     * declaration is written before the name is read. The body asks again, per
     * the scope the name is in, the way `usage.list` holds its caller.
     */
    scopes: [],
    run: async (context) => {
      bounded(context, []);
      const vault = vaultOf(served);
      const name = context.value<string>('name');
      mayWrite(context, name);
      let value: string;
      if (served !== undefined) {
        value = context.required<string>('value');
      }
      else {
        // Read to its end, and one trailing newline dropped, so `ahpd vault set
        // host:x < secret.txt` keeps the file's last line and nothing else.
        const piped = await context.stdin();
        if (piped === '') stop('vault set takes no value on the line: pipe the value on standard input, where nothing echoes it.');
        value = piped.replace(/\n$/u, '');
      }
      await vault.set(name, value);
      return output({ name, set: true }, `Kept ${name}.\n`);
    },
  });

  const remove = registry.action({
    id: 'vault.delete',
    summary: 'Take a name out',
    description: 'A name the vault does not hold is a conflict, so a script can tell an absent name from a taken one.',
    surfaces: { cli: { pattern: ['vault', 'delete', ':name'] }, http: { method: 'POST', path: '/vault/delete/{name}' } },
    input: { ...writing, name: { type: 'string', description: 'The name to take out.' } },
    scopes: [],
    run: async (context) => {
      bounded(context, []);
      const vault = vaultOf(served);
      const name = context.value<string>('name');
      mayWrite(context, name);
      if (!await vault.delete(name)) conflict(`The vault holds no ${name}.`);
      return output({ name, set: false }, `Took ${name} out.\n`);
    },
  });

  const list = registry.action({
    id: 'vault.list',
    summary: 'Every name this host keeps a secret under',
    description: 'Each name and whether it is set, plus where the configuration names one the vault does not hold. No value is ever answered.',
    surfaces: { cli: { pattern: ['vault', 'list'] }, http: { method: 'GET', path: '/vault/list' } },
    input: fields,
    scopes: [],
    run: async (context) => {
      bounded(context, []);
      const vault = vaultOf(served);
      const held = await vault.list();
      // The configuration this process reads, wherever it reads it: a reference
      // is written there before the secret behind it exists.
      const input = context.input as Readonly<Record<string, unknown>>;
      const values = loadConfig(served === undefined
        ? (typeof input['configFile'] === 'string' ? input['configFile'] : undefined)
        : served.configFile).values;
      const rows: SecretRow[] = [...held]
        .filter((name) => !refused(context, name))
        .map((name) => ({ name, set: true }));
      for (const [name, where] of referencedIn(values, '')) {
        if (held.includes(name) || refused(context, name)) continue;
        rows.push({ name, set: false, referenced: where });
      }
      rows.sort((one, other) => one.name.localeCompare(other.name));
      return output(rows, rows.length === 0
        ? 'no secrets\n'
        : `${rows.map((one) => `${one.name}  ${one.set ? 'set' : `not set, named at ${one.referenced}`}\n`).join('')}`);
    },
  });

  return [set, remove, list];
};