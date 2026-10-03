/**
 * Where the host keeps the secrets its work needs.
 *
 * A name carries its scope - `host:`, `team:` or `user:` - and the store behind
 * the port knows nothing about that: it answers a name it holds and refuses one
 * it does not. Decision
 * `the-local-vault-is-a-plain-file-until-it-is-encrypted` and
 * `a-secret-is-named-in-a-host-team-or-user-scope` are what the port and the
 * rule over it are.
 */

import type { Owner } from './usage.js';

/**
 * One store of secrets, by name.
 *
 * A port like `usage` and `policies`: the daemon ships one over a local file and
 * a plugin takes it over with `registerVault(vault, 'replace')` when the secrets
 * belong somewhere else - a secret manager, a database several daemons share.
 */
export interface Vault {
  /** The value held for `name`, or `undefined` when the vault holds none. */
  get(name: string): Promise<string | undefined>;
  /** Keep `value` under `name`, replacing whatever was there. */
  set(name: string, value: string): Promise<void>;
  /** Whether the name was held, after it no longer is. */
  delete(name: string): Promise<boolean>;
  /** Every name held, sorted, and never a value. */
  list(): Promise<string[]>;
}

/**
 * An option written as the name of a secret rather than as its value.
 *
 * The one form that travels in a configuration file: it names where the value
 * comes from and carries none of it, so a file may be copied, committed or put
 * in a backup without taking a credential with it.
 */
export interface SecretRef {
  $secret: string;
}

/**
 * What a secret is being read for, and what decides whether it may be.
 *
 * `host:` is read for anything. A `team:` secret is read only for work charged
 * to that team and a `user:` one only for that person's own work, so a
 * provider key or a repository token is not resolvable by every session on the
 * host. Absent both, the work is the host's own, which is what a plugin option
 * resolved while the plugin loads is.
 */
export interface SecretWork {
  /** Who the work belongs to, `user:<id>` naming one person. */
  owner?: Owner;
  /** The team it is charged under. */
  team?: string;
}