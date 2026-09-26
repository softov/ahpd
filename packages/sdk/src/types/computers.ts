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

import type { MachineNeed } from './machine.js';

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

/**
 * What a nested host is started with.
 *
 * The one command the port runs that is not a backend's own: a whole `ahpd`
 * inside the machine, in stdio mode, so a session the outer host owns can run
 * there through it - decision
 * `a-cofold-session-in-a-computer-runs-in-a-nested-host`.
 */
export interface NestedStart {
  /**
   * The plugins the host inside loads, one `--plugin` each.
   *
   * Named by the backend that runs nested rather than by the machine: what
   * the inner host must have to serve this session is the session's provider.
   */
  plugins: string[];
  /** Where inside the machine it starts, when the caller names one. */
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
 * A setting that names what to make, rather than a machine that exists.
 *
 * A session's `computer` setting is normally a `computer://<id>` naming a
 * machine somebody already made. A setting that names anything else is a
 * *source*: a plugin that owns machines knows how to make one from it, and the
 * machine is made when the session starts rather than ahead of time. The
 * shape is what the host hands over - the source, the session, the harness it
 * must run and the folder it works in - so the plugin never has to look an
 * agent up - decision
 * `the-host-hands-an-agents-machine-needs-to-the-machine-maker`.
 */
export interface MachineSource {
  /**
   * The value the session's setting named, such as `disposable:<profile>` or
   * `devcontainer://<folder>`.
   */
  source: string;
  /** The session channel URI, so a plugin can count the sessions of a machine. */
  session: string;
  /** The agent `provider` the session runs, whose needs the machine is made with. */
  provider: string;
  /** The folder the session works in on this host, mounted at the same path. */
  folder?: string;
  /** What the session's agent says a machine needs, as its `machine()` answered. */
  needs?: Record<string, MachineNeed>;
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
  /**
   * The agents a machine was prepared for, or nothing when it cannot say.
   *
   * The machine's own label, read back: an agent that made the machine records
   * itself here, so the host can refuse a session whose agent is not on the
   * list, and the picker can offer only machines prepared for the asking one.
   * Empty for a machine made before labels existed, which is offered to every
   * agent; absent for a runtime that keeps no such record, which is a check
   * the host cannot make rather than a machine prepared for nobody.
   */
  agents?(id: string): Promise<string[] | undefined>;
  /**
   * Start a whole host inside a machine, in stdio mode.
   *
   * What a backend that cannot move its own process into a machine needs: the
   * machine's profile says how the host is started (`host`, default `ahpd`),
   * and this runs it with `--stdio` and one `--plugin` per named plugin, the
   * way the dev container launcher starts its own. The answer is a descriptor
   * like `how`'s: the caller owns the spawn and its stdio.
   *
   * `undefined` is "there is no such machine", the same answer `how` gives.
   * Absent on a port whose runtime has no way to start one.
   */
  nested?(id: string, asked: NestedStart): Promise<Spawn | undefined>;
  /**
   * Make a machine from a source a session named, and answer its id.
   *
   * The host calls this once, before the session's backend is started, when
   * the session's `computer` setting is not a `computer://<id>`: the answer is
   * what the host rewrites the setting to, so the session runs in the machine
   * as if it had named it - decision
   * `the-host-hands-an-agents-machine-needs-to-the-machine-maker`.
   *
   * `undefined` is "this is not a source I serve", which is a different answer
   * from a refusal: a plugin that owns one kind of source says nothing about
   * another's. A failure is thrown and reaches the session as the runtime's
   * own sentence, so a create that could not happen is not a session that
   * quietly ran on the host.
   */
  create?(asked: MachineSource): Promise<string | undefined>;
  /**
   * A session has started in this machine.
   *
   * The one moment a machine's session count goes up. Called once per session
   * that starts, whether or not this plugin made the machine: a session that
   * picked an existing one counts the same as the session that made it. Not
   * called when a session is started again before its first turn, which is the
   * same session with a different setting and not a second user.
   */
  enter?(id: string, session: string): void;
  /**
   * A session that was running in this machine is gone.
   *
   * The one moment the count goes down. A machine whose last session has left
   * is a machine nothing is using, which is what a disposable one waits out
   * its delay for.
   */
  leave?(id: string, session: string): void;
}
