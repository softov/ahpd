/**
 * How a backend runs its own process inside a machine.
 *
 * A backend that spawns a harness - the ACP bridge spawns one command and
 * speaks a protocol over its stdio - cannot reach a machine by itself, and it
 * may not import the plugin that owns the runtime. So the host carries this
 * port from that plugin to the backend, the way it carries every other port -
 * decision `a-backend-reaches-a-computer-through-a-port`.
 *
 * The answer is a descriptor and not a running process: the caller owns the
 * spawn and the stdio, and a value is something a test can assert without a
 * container.
 */

/** A command to spawn, and where. */
export interface Spawn {
  /** The program to run on this host, such as `docker`. */
  command: string;
  /** Its arguments, which carry the machine and the command inside it. */
  args: string[];
  /** Environment for the spawned program, not for the machine. */
  env?: Record<string, string>;
  /** Where the spawned program starts on this host. */
  cwd?: string;
}

/** The command a backend wants to run in a machine. */
export interface SpawnOptions {
  /** The program to run inside the machine. */
  command: string;
  /** Its arguments. */
  args?: string[];
  /** Where inside the machine it starts, when the machine has no default. */
  cwd?: string;
  /** Variables to set inside the machine, as `-e` flags in the descriptor. */
  env?: Record<string, string>;
}

/**
 * One machine, reached as a process.
 *
 * `how` answers the descriptor, or nothing when there is no machine with that
 * id. A port that cannot reach its runtime at all throws, because "there is no
 * such machine" and "the runtime is not answering" are different answers and a
 * caller needs to tell them apart.
 */
export interface ComputerPort {
  how(id: string, options: SpawnOptions): Promise<Spawn | undefined>;
}
