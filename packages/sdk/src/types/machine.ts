/**
 * What an agent needs from the host for a machine to run it.
 *
 * A machine is made before any session exists, so a need cannot name anything
 * about one. The agent declares the named things it needs - Claude's
 * configuration directory, `.claude.json` and the CLI binary - and whatever
 * makes the machine supplies them, so the knowledge lives with the agent that
 * has it rather than with the plugin that makes machines.
 *
 * A need is delivered one of five ways, and the field that names the way is
 * the one that carries its value: a `directory` or a `file` is made visible in
 * the machine, a `name` is an environment variable, a `source` is copied in
 * rather than mounted, so a runtime that cannot bind-mount still has a way, and
 * a `part` is a CLI the host builds and mounts at `/opt/ahpd/<part>`.
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
}

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

/** One thing an agent needs, by the delivery it names. */
export type MachineNeed = DirectoryNeed | FileNeed | EnvNeed | CopyNeed | PartNeed;

/** How a resolved need reaches the machine. */
export type NeedKind = 'directory' | 'file' | 'env' | 'copy' | 'part';

/** One need with its value settled, as a runtime is handed it. */
export interface ResolvedNeed {
  /** The name the agent gave it, for a refusal that names what went wrong. */
  name: string;
  /** How it reaches the machine. */
  kind: NeedKind;
  /**
   * The host path for a mount or a copy-in, the value for an environment
   * variable, or the part's id.
   */
  source: string;
  /** The mount point, the copied-to path, the variable's name, or `/opt/ahpd/<part>`. */
  target: string;
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
