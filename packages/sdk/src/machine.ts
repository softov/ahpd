/**
 * Filling an agent's machine needs from what a host knows.
 *
 * An agent declares what it needs with `machine()`; a profile and a plugin
 * option may name their own value for any of them. This is where the three are
 * put in order - the profile first, then the plugin option, then the agent's
 * own default - and where a value that cannot work is refused before a machine
 * is made from it: a required need with nothing to fill it, or a path that is
 * not there. Both were silent before this existed: a missing mount source
 * became an empty directory and the session in it exited 127.
 *
 * Nothing here touches a runtime. It answers `ResolvedNeed`s, which is what a
 * machine maker turns into its own flags, so a second runtime takes the same
 * answer the way Docker does.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MachineNeed, ResolvedNeed } from './types/machine.js';

/** What a profile and a plugin option name, by need name. */
export interface NeedSources {
  /** Values the machine's profile names, which win over everything else. */
  profile?: Record<string, string>;
  /** Values the plugin option names, which win over the agent's own default. */
  option?: Record<string, string>;
}

/**
 * `~` and `~/x` as the host user's home, and everything else unchanged.
 *
 * Only a leading `~` is read: `~user` needs a passwd lookup this has no
 * business doing, and a `~` in the middle of a path is a legal file name.
 */
export const expandHome = (value: string, home: string = homedir()): string =>
  (value === '~' ? home : value.startsWith('~/') ? join(home, value.slice(2)) : value);

/** The path a need carries itself, or nothing for an environment variable. */
const carriedBy = (need: MachineNeed): string | undefined => {
  if ('directory' in need) return need.directory;
  if ('file' in need) return need.file;
  if ('source' in need) return need.source;
  return undefined;
};

/** Where a value came from, in the words a refusal uses. */
const from = (source: 'profile' | 'option' | 'default'): string =>
  (source === 'default' ? "the agent's default" : `the ${source}`);

/**
 * One agent's needs, with every value settled.
 *
 * The order is the profile's value, then the plugin option's, then the need's
 * own default, then the path the need itself carries - so a profile may point
 * Claude's configuration at another directory without the agent being changed.
 * A mount or a copy whose host path is not there is refused whatever named it,
 * naming the need, the path and where the value came from; a required need with
 * no value at all is refused the same way. An optional need with no value is
 * left out, which is how an image that already carries something is used.
 */
export function resolveNeeds(
  needs: Record<string, MachineNeed>,
  sources: NeedSources = {},
  home: string = homedir(),
): ResolvedNeed[] {
  const resolved: ResolvedNeed[] = [];
  for (const [name, need] of Object.entries(needs)) {
    const profile = sources.profile?.[name];
    const option = sources.option?.[name];
    const said = profile ?? option ?? need.default ?? carriedBy(need);
    const where: 'profile' | 'option' | 'default' =
      (profile !== undefined ? 'profile' : option !== undefined ? 'option' : 'default');
    if (said === undefined || said.trim() === '') {
      if (need.required === true) {
        throw new Error(`machine need ${name} is required, and neither the profile, the plugin option nor ${from('default')} names one`);
      }
      continue;
    }
    const value = expandHome(said, home);
    const about = need.description === undefined ? {} : { description: need.description };
    if ('name' in need) {
      resolved.push({ name, kind: 'env', target: need.name, source: value, ...about });
      continue;
    }
    if ('source' in need) {
      if (!existsSync(value)) {
        throw new Error(`machine need ${name} points at ${value} (from ${from(where)}), and that path is not there`);
      }
      resolved.push({ name, kind: 'copy', source: value, target: need.target, ...about });
      continue;
    }
    if (!existsSync(value)) {
      throw new Error(`machine need ${name} points at ${value} (from ${from(where)}), and that path is not there`);
    }
    resolved.push({
      name,
      kind: 'directory' in need ? 'directory' : 'file',
      source: value,
      target: need.target,
      ...(need.readOnly === true ? { readOnly: true } : {}),
      ...about,
    });
  }
  return resolved;
}
