/**
 * What an agent needs from the host for a machine to run it.
 *
 * A machine is made before any session exists, so a need cannot name anything
 * about one. The agent declares the named things it needs - Claude's
 * configuration directory, `.claude.json` and the CLI binary - and whatever
 * makes the machine supplies them, so the knowledge lives with the agent that
 * has it rather than with the plugin that makes machines.
 *
 * A need is delivered one of four ways, and the field that names the way is
 * the one that carries its value: a `directory` or a `file` is made visible in
 * the machine, a `name` is an environment variable, and a `source` is copied
 * in rather than mounted, so a runtime that cannot bind-mount still has a way.
 * Which fields a delivery takes is `MachineNeed`; what a runtime is handed once
 * the value is settled is `ResolvedNeed`.
 */

/** The fields every need carries, whatever its delivery. */
interface Need {
  /**
   * What the agent itself would use, under the profile and the plugin option.
   *
   * A host path for a mount or a copy-in, and the value itself for an
   * environment variable. `~` at the start is the host user's home, expanded
   * when the machine is made; this type only permits it.
   */
  default?: string;
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

/** An environment variable set inside the machine. */
export interface EnvNeed extends Need {
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

/** One thing an agent needs, by the delivery it names. */
export type MachineNeed = DirectoryNeed | FileNeed | EnvNeed | CopyNeed;

/** How a resolved need reaches the machine. */
export type NeedKind = 'directory' | 'file' | 'env' | 'copy';

/** One need with its value settled, as a runtime is handed it. */
export interface ResolvedNeed {
  /** The name the agent gave it, for a refusal that names what went wrong. */
  name: string;
  /** How it reaches the machine. */
  kind: NeedKind;
  /** The host path for a mount or a copy-in, or the value for an environment variable. */
  source: string;
  /** The mount point, the copied-to path, or the variable's name. */
  target: string;
  /** A mount delivered read-only. */
  readOnly?: boolean;
  /** One line from the need. */
  description?: string;
}
