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
import type { Owner } from './usage.js';

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

/** The command that starts a nested host, and where its session works. */
export interface NestedSpawn extends Spawn {
  /**
   * The path inside the machine the caller's `cwd` is mounted at, or the
   * machine's own working directory when no mount covers it.
   *
   * Absent when there is neither: the caller named no folder, or the machine
   * has no working directory of its own.
   */
  workingDirectory?: string;
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
  /**
   * The common git directory of the repository the folder is in.
   *
   * Outside the folder - a linked worktree's, or a subfolder's - it is mounted
   * beside the folder at its own path, so git works inside the machine; inside
   * it, it comes with the folder. Either way the machine maker decides what in
   * it stays read-only. For a `devcontainer://<folder>` source it is that
   * folder's.
   */
  gitDir?: string;
  /**
   * The root of the tree the folder is in, when the folder is below it.
   *
   * Mounted in place of the folder, so the rest of the tree is not missing to
   * git inside the machine.
   */
  repository?: string;
  /** What the session's agent says a machine needs, as its `machine()` answered. */
  needs?: Record<string, MachineNeed>;
  /**
   * Whose the machine is, and who pays for the time it is up.
   *
   * Whoever asked for it: the session's owner when a session named a source, and
   * the connection's when a person made the machine directly - decision
   * `a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time`.
   * Absent where this host has nobody to name, which is a machine with no
   * recorded owner rather than one somebody is.
   */
  owner?: Owner;
  /**
   * The team the asking session's work is charged under.
   *
   * Beside `project`, and only for a machine made for a session: the scope is
   * what the work inside the machine is charged to, and a machine made directly
   * has no session to charge.
   */
  team?: string;
  /** The project the asking session's work is charged under. */
  project?: string;
}

/** The session asking about a machine, and whoever is behind it. */
export interface KeptForAsked {
  /** The asking session's URI, as every other question about a session spells it. */
  session: string;
  /** Whoever owns the asking session, and nothing when nobody does. */
  owner?: Owner;
}

/** What a machine is kept for alone, read from its own labels. */
export interface KeptFor {
  /** The session the machine was made for, as its label spells it. */
  session: string;
  /** Whose the machine's work is charged to, and nothing when nobody owns it. */
  owner?: Owner;
  /**
   * Whether the daemon answering made this machine, as its own label says.
   *
   * `false` for a machine on the same runtime that another daemon made, which
   * is not this one's to hand out: it is that daemon's to remove and that
   * daemon's to charge for. Absent on a port that keeps no such record, which
   * is a machine this reader cannot place rather than one of somebody else's.
   */
  mine?: boolean;
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
   * The parts an agent needs that a machine was made without, or nothing when
   * the port cannot say.
   *
   * A part whose build failed is left out of the machine rather than refusing
   * it, so a session whose agent needs that part is refused by name and every
   * other session runs; a running machine never gains one. Empty where the
   * machine has every part the agent's needs name.
   */
  partsMissing?(id: string, provider: string): Promise<string[] | undefined>;
  /**
   * The session a machine is kept for alone, or nothing when any may run in it.
   *
   * The machine's own labels, read back the way `agents` is: a machine made
   * from a `disposableAlone` profile belongs to the session it was made for,
   * and a second session naming it is refused rather than sharing a machine
   * that was built for one - decision
   * `a-disposable-alone-machine-refuses-another-session`.
   *
   * The owner is the second half of the same refusal and is what a client
   * cannot choose: a session id comes from the client's own channel, so a new
   * session opened under a disposed one's id spells the same URI, while the
   * owner is what the machine was built for.
   *
   * Nothing for a machine any session may enter, nothing for one made before
   * the label existed, whose own session may still be resumed into it, and
   * nothing for a machine another daemon made. Absent on a port that keeps no
   * such record, which is a check the host cannot make rather than a machine
   * kept for nobody.
   */
  keptFor?(id: string, asked?: KeptForAsked): Promise<KeptFor | undefined>;
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
  nested?(id: string, asked: NestedStart): Promise<NestedSpawn | undefined>;
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
   * The one moment a machine's session count goes up, and the host says it from
   * the one place every road to a running backend goes through: a session
   * created, one resumed from the list after a daemon restart, a restart before
   * its first turn, a chat started again, a fork, a truncate. A session that
   * picked an existing machine counts the same as the session that made it.
   *
   * A set rather than a count, so one session that enters twice - the same one
   * after a restart, which is the same session with a different setting and not
   * a second user - is still one user.
   *
   * May be a promise, because a plugin that finds its machines by listing them
   * at startup cannot count a session into a machine it has not found yet, and
   * a session that starts before the listing is over is still a session in it.
   */
  enter?(id: string, session: string): void | Promise<void>;
  /**
   * A session that was running in this machine is gone.
   *
   * The one moment the count goes down: the session was disposed, it moved to
   * another machine, or the host forgot or pruned the stored session it was
   * running in. A machine whose last session has left is a machine nothing is
   * using, which is what a disposable one waits out its delay for.
   *
   * The machine left is the one the session was in, which on a move away is the
   * one before it. The machine the session moved to is entered by the start
   * that follows.
   *
   * May be a promise, for the reason `enter`'s is.
   */
  leave?(id: string, session: string): void | Promise<void>;
}
