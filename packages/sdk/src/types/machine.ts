/**
 * What an agent needs from the host for a machine to run it.
 *
 * A machine is made before any session exists, so a need cannot name anything
 * about one. The agent declares the named things it needs - Claude's
 * configuration directory, `.claude.json` and the CLI binary - and whatever
 * makes the machine supplies them, so the knowledge lives with the agent that
 * has it rather than with the plugin that makes machines.
 *
 * A need is delivered one of six ways, and the field that names the way is
 * the one that carries its value: a `directory` or a `file` is made visible in
 * the machine, a `name` is an environment variable, a `source` is copied in
 * rather than mounted, so a runtime that cannot bind-mount still has a way, a
 * `part` is a CLI the host builds and mounts at `/opt/ahpd/<part>`, and a
 * `state` is a directory kept in a volume and seeded from this host.
 * Which fields a delivery takes is `MachineNeed`; what a runtime is handed once
 * the value is settled is `ResolvedNeed`.
 */

import type { SecretRef } from './vault.js';

/**
 * The fields every need carries, whatever its delivery.
 *
 * `D` is what its `default` may be: a path for a mount or a copy-in, and for an
 * environment variable its value or the name of a secret that is.
 */
interface Need<D = string> {
  /**
   * What the agent itself would use, under the profile and the plugin option.
   *
   * A host path for a mount or a copy-in, and the value itself for an
   * environment variable. `~` at the start is the host user's home, expanded
   * when the machine is made; this type only permits it.
   */
  default?: D;
  /**
   * Whether a machine is refused when no value is available at all.
   *
   * Off, a need with no value is left out of the machine, which is a real
   * answer for something the image may already carry. On, the refusal says
   * which need had nothing.
   */
  required?: boolean;
  /** One line about what it is, for a listing and for a refusal. */
  description?: string;
  /**
   * The one mode this need belongs to, or both when absent.
   *
   * `volume` is a machine whose agent state lives in a state volume; `host` is
   * one that mounts this host's own configuration, sign-in included. A profile
   * picks the mode, and a need of the other mode is left out of the machine.
   */
  when?: StateMode;
}

/**
 * Where an agent's state lives for a machine: in a state volume of its own, or
 * mounted from this host's home.
 */
export type StateMode = 'host' | 'volume';

/** A host directory made visible in the machine. */
export interface DirectoryNeed extends Need {
  /** The host directory. `~` at the start is the host user's home. */
  directory: string;
  /** Where it is mounted inside the machine. */
  target: string;
  /** Mounted read-only, so nothing in the machine writes to the host's copy. */
  readOnly?: boolean;
}

/** A host file made visible in the machine. */
export interface FileNeed extends Need {
  /** The host file. `~` at the start is the host user's home. */
  file: string;
  /** Where it is mounted inside the machine. */
  target: string;
  /** Mounted read-only, so nothing in the machine writes to the host's copy. */
  readOnly?: boolean;
}

/**
 * An environment variable set inside the machine.
 *
 * Its `default` may be written `{ "$secret": "<name>" }`, which whatever makes
 * the machine reads for the machine's owner when it makes it, as it reads a
 * profile's or an option's value written that way; the agent never holds the
 * value.
 */
export interface EnvNeed extends Need<string | SecretRef> {
  /** The variable's name. Its value is the profile's, the option's or the default. */
  name: string;
}

/** A host path copied into the machine rather than made visible in it. */
export interface CopyNeed extends Need {
  /** The host path to copy. `~` at the start is the host user's home. */
  source: string;
  /** Where it lands inside the machine. */
  target: string;
}

/**
 * A part the machine carries: one agent CLI, or ahpd itself, built by the host
 * at the version its versions file pins.
 *
 * A part is an image of its own, mounted read-only at `/opt/ahpd/<part>` with
 * the parts it requires beside it, so it has no host path and its target is
 * never the agent's to choose. A profile's or an option's value names another
 * part id, which is how a profile pins another build.
 */
export interface PartNeed extends Need {
  /** The part's id in the host's versions file, such as `codex`. */
  part: string;
}

/**
 * One host file or directory a state directory is seeded from.
 *
 * Written into the state volume the first time and again only when it changed
 * on this host; what the agent wrote beside it is kept.
 */
export interface Seed {
  /** The host path. `~` at the start is the host user's home. */
  source: string;
  /** Where it lands, relative to the state directory. The source's base name when absent. */
  target?: string;
  /** For a JSON file: the top-level keys kept, every other one left out. */
  keep?: string[];
  /** For a JSON file: dotted paths removed, such as `security.auth`. */
  drop?: string[];
}

/**
 * A directory inside the machine that holds the agent's own state, kept in a
 * named volume rather than taken from this host.
 *
 * Whatever makes the machine names the volume - by profile, owner and the
 * agent that declared it - and seeds it from `seed` before the machine starts,
 * so nothing of this host's home is mounted. A login file is never a seed: a
 * credential reaches the machine as an env need instead.
 */
export interface StateNeed extends Need {
  /** The state directory inside the machine. A profile's or an option's value names another. */
  state: string;
  /** The host files and directories it is seeded from. */
  seed?: Seed[];
}

/** One thing an agent needs, by the delivery it names. */
export type MachineNeed = DirectoryNeed | FileNeed | EnvNeed | CopyNeed | PartNeed | StateNeed;

/** How a resolved need reaches the machine. */
export type NeedKind = 'directory' | 'file' | 'env' | 'copy' | 'part' | 'state';

/** A seed with its host path settled and its target set. */
export interface ResolvedSeed {
  /** The absolute host path. */
  source: string;
  /** Where it lands, relative to the state directory. */
  target: string;
  /** For a JSON file: the top-level keys kept. */
  keep?: string[];
  /** For a JSON file: dotted paths removed. */
  drop?: string[];
}

/** One need with its value settled, as a runtime is handed it. */
export interface ResolvedNeed {
  /** The name the agent gave it, for a refusal that names what went wrong. */
  name: string;
  /** How it reaches the machine. */
  kind: NeedKind;
  /**
   * The host path for a mount or a copy-in, the value for an environment
   * variable, the part's id, or the state directory.
   */
  source: string;
  /**
   * The mount point, the copied-to path, the variable's name,
   * `/opt/ahpd/<part>`, or the state directory.
   */
  target: string;
  /** What a state directory is seeded from. */
  seed?: ResolvedSeed[];
  /**
   * The provider id of the agent that declared it, on a state need, which is
   * what its volume is named by.
   */
  provider?: string;
  /** A mount delivered read-only. */
  readOnly?: boolean;
  /**
   * An environment variable whose value was read from the vault.
   *
   * Such a value is never given when the machine is made, where a runtime
   * would keep it in the machine's own record; it is held with the machine and
   * passed on each command run in it.
   */
  named?: boolean;
  /** One line from the need. */
  description?: string;
}
