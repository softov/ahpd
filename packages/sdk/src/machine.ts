/**
 * Filling an agent's machine needs from what a host knows.
 *
 * An agent declares what it needs with `machine()`; a profile and a plugin
 * option may name their own value for any of them. This is where the three are
 * put in order - the profile first, then the plugin option, then the agent's
 * own default - and where a value that cannot work is refused before a machine
 * is made from it: a required need with nothing to fill it, or a path that is
 * not absolute or is not there.
 *
 * Nothing here touches a runtime. It answers `ResolvedNeed`s, which is what a
 * machine maker turns into its own flags, so a second runtime takes the same
 * answer the way Docker does.
 */

import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { MachineNeed, ResolvedNeed, ResolvedSeed, Seed, StateMode } from './types/machine.js';
import { secretRef } from './vault.js';

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

/**
 * The value a need carries itself: its path, its part id, its state directory,
 * or nothing for an environment variable.
 */
const carriedBy = (need: MachineNeed): string | undefined => {
  if ('directory' in need) return need.directory;
  if ('file' in need) return need.file;
  if ('source' in need) return need.source;
  if ('part' in need) return need.part;
  if ('state' in need) return need.state;
  return undefined;
};

/** The keys that reach an object's prototype, which `keep` and `drop` never name. */
const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * A state need's seeds, each with its host path expanded and its target set.
 *
 * A source is an absolute host path once `~` is read, and a target stays inside
 * the state directory. `keep` and `drop` filter a JSON file, so a source that is
 * a directory is refused with them, and so is a key of theirs that reaches an
 * object's prototype; a source that is not there is left for the
 * machine maker, which skips that seed alone.
 */
const seedsOf = (name: string, seeds: Seed[], home: string): ResolvedSeed[] => seeds.map((seed) => {
  const source = expandHome(seed.source, home);
  if (!source.startsWith('/')) {
    throw new Error(`machine need ${name} seeds ${seed.source}, and a seed is an absolute host path`);
  }
  const target = seed.target ?? basename(source);
  const parts = target.split('/');
  if (target === '' || target.startsWith('/') || parts.some((one) => one === '..' || one === '')) {
    throw new Error(`machine need ${name} seeds ${source} at ${target}, and a seed lands inside the state directory`);
  }
  const walked = [...(seed.keep ?? []), ...(seed.drop ?? []).flatMap((path) => path.split('.'))]
    .find((key) => PROTOTYPE_KEYS.has(key));
  if (walked !== undefined) {
    throw new Error(`machine need ${name} seeds ${source} with ${walked}, and keep and drop name a file's own keys`);
  }
  const filtered = seed.keep !== undefined || seed.drop !== undefined;
  if (filtered && existsSync(source) && statSync(source).isDirectory()) {
    throw new Error(`machine need ${name} seeds ${source}, a directory, and keep and drop are only for a JSON file`);
  }
  return {
    source,
    target,
    ...(seed.keep === undefined ? {} : { keep: [...seed.keep] }),
    ...(seed.drop === undefined ? {} : { drop: [...seed.drop] }),
  };
});

/** Where every part is mounted inside a machine, one directory each. */
export const PART_ROOT = '/opt/ahpd';

/** A part id: a plain name, so the directory it is mounted at is one level under `PART_ROOT`. */
const PART_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Where one part is mounted inside a machine. */
export const partTarget = (id: string): string => `${PART_ROOT}/${id}`;

/** Where a value came from, in the words a refusal uses. */
const from = (source: 'profile' | 'option' | 'default'): string =>
  (source === 'default' ? "the agent's default" : `the ${source}`);

/**
 * One agent's needs, with every value settled.
 *
 * The order is the profile's value, then the plugin option's, then the need's
 * own default, then the path the need itself carries - so a profile may point
 * Claude's configuration at another directory without the agent being changed.
 * A mount or a copy whose value is not an absolute path, or whose host path is
 * not there, is refused whatever named it, naming the need, the path and where
 * the value came from; a required need with no value at all is refused the same
 * way. An optional need with no value is left out, which is how an image that
 * already carries something is used.
 *
 * `mode` is where the machine keeps its agents' state, as its profile says: a
 * need whose `when` names the other mode is left out, one without `when`
 * belongs to both, and a state need belongs to `volume` alone.
 */
export function resolveNeeds(
  needs: Record<string, MachineNeed>,
  sources: NeedSources = {},
  home: string = homedir(),
  mode: StateMode = 'volume',
): ResolvedNeed[] {
  const resolved: ResolvedNeed[] = [];
  for (const [name, need] of Object.entries(needs)) {
    // A state need is a state volume, which is the `volume` mode itself.
    const when = 'state' in need ? 'volume' : need.when;
    if (when !== undefined && when !== mode) continue;
    const profile = sources.profile?.[name];
    const option = sources.option?.[name];
    // A default naming a secret is read by whatever makes the machine and
    // handed over as a value; one that arrives here unread has no value to give.
    const unread = profile === undefined && option === undefined ? secretRef(need.default) : undefined;
    if (unread !== undefined) throw new Error(`machine need ${name} names ${unread}, and nothing read it for this machine`);
    const said = profile ?? option ?? (need.default as string | undefined) ?? carriedBy(need);
    const where: 'profile' | 'option' | 'default' =
      (profile !== undefined ? 'profile' : option !== undefined ? 'option' : 'default');
    if (said === undefined || said.trim() === '') {
      if (need.required === true) {
        throw new Error(`machine need ${name} is required, and neither the profile, the plugin option nor ${from('default')} names one`);
      }
      continue;
    }
    const about = need.description === undefined ? {} : { description: need.description };
    // A part is an id rather than a host path, so it is neither expanded nor
    // looked for here; whatever makes the machine builds it.
    if ('part' in need) {
      if (!PART_ID.test(said)) {
        throw new Error(`machine need ${name} names the part ${said} (from ${from(where)}), and a part is named by its id in the versions file`);
      }
      resolved.push({ name, kind: 'part', source: said, target: partTarget(said), ...about });
      continue;
    }
    // A state directory is a place inside the machine, so it is never looked
    // for here; its seeds are this host's paths.
    if ('state' in need) {
      if (!said.startsWith('/')) {
        throw new Error(`machine need ${name} is ${said} (from ${from(where)}), and a state directory is an absolute path inside the machine`);
      }
      const seed = seedsOf(name, need.seed ?? [], home);
      resolved.push({ name, kind: 'state', source: said, target: said, ...(seed.length === 0 ? {} : { seed }), ...about });
      continue;
    }
    const value = expandHome(said, home);
    if ('name' in need) {
      resolved.push({ name, kind: 'env', target: need.name, source: value, ...about });
      continue;
    }
    /*
     * A path this machine is made with, before it is looked for.
     *
     * A relative one is checked against the daemon's working directory, which
     * is not what the person who wrote it meant, and a runtime given
     * `cache:/cache` reads the source as a named volume rather than as a path
     * on this host - so a machine made that way is a machine nobody wrote. An
     * environment variable's value is not a path and is not checked here.
     */
    if (!value.startsWith('/')) {
      throw new Error(`machine need ${name} is ${value} (from ${from(where)}), and a path a machine is made with is absolute`);
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
