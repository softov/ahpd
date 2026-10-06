/**
 * Reading a machine need's value from the vault.
 *
 * A need is written `{ "$secret": "<name>" }` rather than as the value itself,
 * which is what keeps a credential out of a configuration file and out of a
 * git repository holding one. The name carries its scope, so it is read for the
 * machine's owner and its team and not for whoever happens to be asking -
 * decision `a-secret-is-named-in-a-host-team-or-user-scope`.
 *
 * The read is where the machine is made, not where the option was loaded:
 * nothing owns a load, so a `team:` or `user:` name is out of scope there by
 * the rule above and could not be read at all.
 */

import { secretRef } from '@ahpd/sdk';
import type { MachineNeed, PluginHost, SecretRef, SecretWork } from '@ahpd/sdk';
import type { MadeNeed } from './owners.js';

/** Read one agent's needs, as `ManifestDefaults.needsOf` does. */
type NeedsOf = (provider: string) => Record<string, MachineNeed> | undefined;

/**
 * The need names a machine made for these agents is resolved with.
 *
 * `manifestOf` walks the agents a profile names and resolves each need those
 * agents declare, so those names are the whole of what a value can land on. A
 * name nobody on this machine declares is not this machine's business: the
 * deployment's `needs` are one map for every machine this host makes, and a
 * value under a need only one harness declares must not make a machine for
 * another harness - or for anybody but that harness's owner - fail.
 */
const declared = (agents: readonly string[], needsOf: NeedsOf | undefined): Set<string> => {
  const names = new Set<string>();
  if (needsOf === undefined) return names;
  for (const agent of agents) {
    for (const need of Object.keys(needsOf(agent) ?? {})) names.add(need);
  }
  return names;
};

/**
 * The option's need values with each agent's own secret default laid under them.
 *
 * An agent may write an environment need's `default` as `{ "$secret": "<name>" }`
 * rather than hold the value, and it is read the way a reference in the plugin's
 * `needs` is: for the machine's owner, when the machine is made. So it joins the
 * option's values where the option names none, which keeps the order a value is
 * taken in - the profile's, then the option's, then the agent's - and lets
 * `revealed` read it and `vaultNamed` say it came from the vault.
 */
export const withDefaults = (
  values: Record<string, string | SecretRef> | undefined,
  agents: readonly string[],
  needsOf: NeedsOf | undefined,
): Record<string, string | SecretRef> | undefined => {
  const defaults: Record<string, SecretRef> = {};
  for (const agent of agents) {
    for (const [need, one] of Object.entries(needsOf?.(agent) ?? {})) {
      if (need in defaults || !('name' in one)) continue;
      const name = secretRef(one.default);
      if (name !== undefined) defaults[need] = { $secret: name };
    }
  }
  if (Object.keys(defaults).length === 0) return values;
  return { ...defaults, ...(values ?? {}) };
};

/** One need map with every reference read, and which of its needs were references. */
export interface Revealed {
  /** Every value, as the machine maker wants them, by need name. */
  values: Record<string, string>;
  /** The need names whose value was read from the vault, with the secret each named. */
  named: Map<string, string>;
}

/** The sentence a reference that could not be read is refused with. */
const unread = (need: string, name: string, error: unknown): string =>
  `machine need ${need} names ${name}: ${error instanceof Error ? error.message : String(error)}`;

/**
 * One need's values with every reference read, as the machine maker wants them.
 *
 * `agents` and `needsOf` are the machine's own, and they say which names are
 * read; a name outside them is left out, so a profile nobody picked and a need
 * no agent here declares both cost nothing.
 *
 * A copy, so the value never sits in the option the plugin loaded and is
 * shared by every machine it makes afterwards. A reference that cannot be read
 * throws naming the need and the name, because a machine made quietly without
 * a credential is the failure this exists to stop, and the need's own name is
 * what says which credential was missing.
 *
 * `named` says which values came from the vault, which is what keeps them off
 * the command that makes the machine.
 */
export const revealed = async (
  values: Record<string, string | SecretRef> | undefined,
  agents: readonly string[],
  needsOf: NeedsOf | undefined,
  work: SecretWork,
  secret: PluginHost['secret'],
): Promise<Revealed | undefined> => {
  if (values === undefined) return undefined;
  const wanted = declared(agents, needsOf);
  const read: Record<string, string> = {};
  const named = new Map<string, string>();
  for (const [need, one] of Object.entries(values)) {
    if (!wanted.has(need)) continue;
    const name = secretRef(one);
    if (name === undefined) {
      read[need] = one as string;
      continue;
    }
    try {
      read[need] = await secret(name, work);
    }
    catch (error) {
      throw new Error(unread(need, name, error));
    }
    named.set(need, name);
  }
  return { values: read, named };
};

/**
 * The need names whose winning value came from the vault, with the secret each
 * named.
 *
 * A profile's value wins over the plugin option's, so a need the profile gives
 * a value is the profile's to say, and the option's reference under the same
 * name is not what the machine is given.
 */
export const vaultNamed = (profile: Revealed | undefined, option: Revealed | undefined): Map<string, string> => new Map([
  ...[...(option?.named ?? [])].filter(([need]) => profile?.values[need] === undefined),
  ...(profile?.named ?? []),
]);

/** A vault-named variable that could not be read again, and why. */
export interface Unread {
  /** The need's name. */
  need: string;
  /** The secret it names. */
  name: string;
  /** The variable it sets in the machine. */
  variable: string;
  /** The sentence a refusal or a log line says it in. */
  said: string;
}

/**
 * A machine's vault-named variables, read again from the references it was
 * made with, for the owner and team it was made for.
 *
 * Each one is read on its own, so a reference that cannot be read is answered
 * beside the ones that were rather than in place of them.
 */
export const madeAgain = async (
  needs: readonly MadeNeed[],
  work: SecretWork,
  secret: PluginHost['secret'],
): Promise<{ env: Record<string, string>; unread: Unread[] }> => {
  const env: Record<string, string> = {};
  const failed: Unread[] = [];
  for (const { need, variable, secret: name } of needs) {
    try {
      env[variable] = await secret(name, work);
    }
    catch (error) {
      failed.push({ need, name, variable, said: unread(need, name, error) });
    }
  }
  return { env, unread: failed };
};

/**
 * A machine's vault-named variables, read again for the owner and team it was
 * made for, from the needs its agents declare now.
 *
 * What a daemon has to do for a machine with no needs recorded beside the
 * configuration, one made before they were: the values are never kept on disk,
 * so the reference is read again from the same place it was read at create.
 * Only an environment need is read,
 * and only where its winning value is a reference - the profile's value, else
 * the option's, else the agent's own default - which is the same rule the
 * create followed.
 *
 * Each one is read on its own, so a reference that cannot be read is answered
 * beside the ones that were rather than in place of them.
 */
export const namedAgain = async (
  profile: Record<string, string | SecretRef> | undefined,
  option: Record<string, string | SecretRef> | undefined,
  agents: readonly string[],
  needsOf: NeedsOf,
  work: SecretWork,
  secret: PluginHost['secret'],
): Promise<{ env: Record<string, string>; unread: Unread[] }> => {
  const env: Record<string, string> = {};
  const failed: Unread[] = [];
  const seen = new Set<string>();
  for (const agent of agents) {
    for (const [need, declaredNeed] of Object.entries(needsOf(agent) ?? {})) {
      if (seen.has(need) || !('name' in declaredNeed)) continue;
      seen.add(need);
      const winning = profile?.[need] ?? option?.[need] ?? declaredNeed.default;
      const name = winning === undefined ? undefined : secretRef(winning);
      if (name === undefined) continue;
      try {
        env[declaredNeed.name] = await secret(name, work);
      }
      catch (error) {
        failed.push({ need, name, variable: declaredNeed.name, said: unread(need, name, error) });
      }
    }
  }
  return { env, unread: failed };
};
