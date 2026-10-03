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
 */
export const revealed = async (
  values: Record<string, string | SecretRef> | undefined,
  agents: readonly string[],
  needsOf: NeedsOf | undefined,
  work: SecretWork,
  secret: PluginHost['secret'],
): Promise<Record<string, string> | undefined> => {
  if (values === undefined) return undefined;
  const wanted = declared(agents, needsOf);
  const read: Record<string, string> = {};
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
      throw new Error(`machine need ${need} names ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return read;
};
