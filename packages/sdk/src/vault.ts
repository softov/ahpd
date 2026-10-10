/**
 * Reading a secret for a piece of work, and saying which work may read it.
 *
 * The scope rule decision `a-secret-is-named-in-a-host-team-or-user-scope`
 * settled, in one place so the loader and `PluginHost.secret` cannot hold two:
 * a store answers a name it holds and knows nothing of who is asking, so
 * whether a name may be read is decided here, beside the work that is being
 * done.
 */

import type { PluginHost } from './types/plugin.js';
import type { SecretRef, SecretWork, Vault } from './types/vault.js';
import { bag, reason } from './values.js';

/** What a name says about who may read it. */
export type SecretScope =
  | { readonly scope: 'host' }
  | { readonly scope: 'team'; readonly team: string }
  | { readonly scope: 'user'; readonly user: string };

/**
 * A character no part of a name may hold: whitespace, a C0 or C1 control, a NUL.
 *
 * A name is one identifier written in a file, on a command line and in a URL,
 * and whitespace or a control character in one is invisible where it is read:
 * `host:x` with a newline after it looks like `host:x` in a log and beside it.
 */
const UNWRITABLE = /[\s\p{Cc}]/u;

/**
 * What a secret name says, or why it is not one.
 *
 * The three forms are `host:<name>`, `team:<team>/<name>` and
 * `user:<id>/<name>`. An empty part is not one of them either: `host:` names
 * nothing and `team:/key` names a team that is not there, and a secret whose
 * scope cannot be read is one nothing may be told about.
 */
export const scopeOf = (name: string): SecretScope => {
  const at = name.indexOf(':');
  const scope = at === -1 ? '' : name.slice(0, at);
  const rest = at === -1 ? '' : name.slice(at + 1);
  const refused = `${name} is not a secret name: use host:<name>, team:<team>/<name> or user:<id>/<name>`;
  if (UNWRITABLE.test(name)) throw new Error(refused);

  if (scope === 'host') {
    if (rest === '') throw new Error(refused);
    return { scope: 'host' };
  }
  const slash = rest.indexOf('/');
  if (scope !== 'team' && scope !== 'user') throw new Error(refused);
  const who = slash === -1 ? '' : rest.slice(0, slash);
  const secret = slash === -1 ? '' : rest.slice(slash + 1);
  if (who === '' || secret === '') throw new Error(refused);
  return scope === 'team' ? { scope: 'team', team: who } : { scope: 'user', user: who };
};

/**
 * The name this value refers to, or `undefined` when it refers to nothing.
 *
 * A reference is an object whose only key is `$secret` and whose value is a
 * string: an object with anything else beside it is a value of its own, and one
 * whose `$secret` is not a string is a mistyped option rather than a reference.
 */
export const secretRef = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== '$secret') return undefined;
  const named = (value as SecretRef).$secret;
  return typeof named === 'string' ? named : undefined;
};

/**
 * The variable this value reads from the daemon's environment, or `undefined`
 * when it reads none.
 *
 * `secretRef`'s sibling and its rule: an object whose only key is `fromEnv` and
 * whose value is a non-empty string. An object with anything beside `fromEnv`
 * is a value of its own rather than a reference, the way one with anything
 * beside `$secret` is, and an empty name reads a variable that is not there.
 */
export const fromEnvRef = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'fromEnv') return undefined;
  const named = (value as { fromEnv?: unknown }).fromEnv;
  return typeof named === 'string' && named !== '' ? named : undefined;
};

/**
 * One preset's `env`, with every `{ "$secret": "<name>" }` read through the host.
 *
 * Read here and not by the loader because a preset's credential is the daemon's,
 * not a person's: the name is in `host:` scope or it belongs to work this load
 * is not doing, and a vault this daemon does not have is a host that cannot
 * answer. Whichever of those it is, the caller is told which preset it was for
 * and the other presets carry on.
 *
 * Everything that is not a reference is passed through whole, as it was
 * written: whether such a value may be what the option takes is the caller's
 * check, and this one would only repeat it on the way past.
 */
export const readSecrets = async (host: PluginHost, env: unknown, by: string): Promise<Record<string, unknown>> => {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(bag(env))) {
    const referenced = secretRef(value);
    if (referenced === undefined) {
      out[name] = value;
      continue;
    }
    try {
      out[name] = await host.secret(referenced);
    }
    catch (error) {
      throw new Error(`${by}.${name} names ${referenced}: ${reason(error)}`);
    }
  }
  return out;
};

/**
 * The value of one secret, for the work that may read it.
 *
 * The scope is checked before the vault is asked, so a name out of scope is
 * refused without the store ever being told it was wanted. A name in scope that
 * the vault does not hold is refused too: a reference left in a configuration
 * file may name a secret nobody has set yet, and `set` answers that by filling
 * it rather than by pretending it is there.
 */
export const readSecret = async (vault: Vault, name: string, work: SecretWork = {}): Promise<string> => {
  const scope = scopeOf(name);
  const may = scope.scope === 'host'
    || (scope.scope === 'team' && work.team === scope.team)
    || (scope.scope === 'user' && work.owner === `user:${scope.user}`);
  if (!may) throw new Error(`${name} is not a secret this work may read`);

  const value = await vault.get(name);
  if (value === undefined) throw new Error(`the vault holds no ${name}`);
  return value;
};