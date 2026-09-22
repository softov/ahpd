/** A shell on the host machine, as a terminal channel. */

import type { TerminalClaim, TerminalLifecycleState, TerminalState } from '@microsoft/agent-host-protocol';
import type { OnWire } from './wire.js';
import type { Bag } from './common.js';
import type { Emit } from './session.js';

/** Who currently holds a terminal: a connected client, or a session. */
/**
 * Who is holding a terminal, in the protocol's own type.
 *
 * A client, or a session and the chat inside it. Was `Bag`, which meant a
 * claim missing the fields its own kind requires compiled perfectly.
 */
export type Claim = OnWire<TerminalClaim>;

/** How to start one. */
export interface TerminalOptions {
  /** The terminal channel URI, chosen by the client that asked for it. */
  uri: string;
  /** The directory it starts in. Already checked against what the host serves. */
  cwd: string;
  /** Who is holding it. */
  claim: Claim;
  /** Display name. The shell's own if none is given. */
  name?: string;
  /**
   * The shell to run, absolute. The store's own choice if none is given.
   *
   * A connected client pushes this: VS Code sends `defaultShell` on the root
   * channel out of `terminal.integrated.agentHostProfile.<os>`, because the
   * shell somebody wants a host-managed terminal to open is a preference of
   * theirs rather than a fact about the machine.
   */
  shell?: string;
  /**
   * One command to run instead of a shell to sit in.
   *
   * The terminal runs it and exits, so `terminal/exited` is what says the
   * command finished and its code is what says how. Without this the shell
   * reads from a pipe and stays open, which is right for a terminal somebody
   * is typing into and wrong for one opened to answer a single question -
   * there is no shell integration here to tell where one command ends.
   */
  command?: string;
  /**
   * The command's arguments, when `command` names a program rather than a line.
   *
   * Present, `command` and these are one argv: each word is quoted and the
   * shell runs exactly that program. Absent, `command` is a shell line and
   * reaches the shell untouched, because a `!` command typed by a person is
   * already shell syntax and quoting it would look for a program named after
   * the whole line.
   */
  args?: string[];
  /**
   * Environment variables for the process, over the host's own.
   *
   * The terminal's `TERM`, `COLUMNS` and `LINES` are set after these, so a
   * caller cannot leave a terminal disagreeing with the size it reports.
   */
  env?: Record<string, string | undefined>;
  /** Width in columns, as the client draws it. */
  cols?: number;
  /** Height in rows. */
  rows?: number;
  /** Where state actions go. The host routes them to the terminal's channel. */
  emit: Emit;
}

/** A running terminal. */
export interface Terminal {
  /** Its channel URI. */
  readonly uri: string;
  /** Display title. */
  title(): string;
  /** Who is holding it. */
  claim(): Claim;
  /** The process's exit code, once it has one. Undefined while it runs. */
  exitCode(): number | undefined;
  /**
   * Running, or exited and with what.
   *
   * 0.9.0 moved the exit code in here and made this required, so a terminal
   * described without it is a terminal a client cannot ask about. `exitCode`
   * above stays for the versions this host still negotiates down to.
   */
  lifecycle(): OnWire<TerminalLifecycleState>;
  /** The channel's state, for a subscription snapshot. */
  /**
   * The terminal channel's snapshot, in the protocol's own type.
   *
   * Typed against the package rather than as a `Bag`, which is the point:
   * `Bag` is why 0.9.0 moved the exit code inside `lifecycle` and this host
   * went on sending the old shape with a clean compile. A field removed or
   * renamed upstream is a type error here now, at the one place the payload
   * is built.
   *
   * The intersection is the deliberate part. This host negotiates down to
   * 0.5.1 and every version before 0.9.0 reads a flat `exitCode`, so it sends
   * both - and saying so in the type is the difference between a divergence
   * somebody chose and one nobody noticed.
   */
  state(): OnWire<TerminalState> & { exitCode?: number };

  /** Send input. Ignored once the process has exited. */
  write(data: string): void;
  /** Record a new size. Nothing is signalled: there is no pseudoterminal. */
  resize(cols: number, rows: number): void;
  /**
   * Throw away the scrollback, keeping everything else.
   *
   * The size, the title and the claim survive: a client clears a terminal to
   * stop reading what is already there, not to give it up. Nothing reaches
   * the process - there is no pseudoterminal to send anything to, and a shell
   * has no notion of its own output having been discarded.
   */
  clear(): void;
  /** Rename it. */
  setTitle(title: string): void;
  /** Hand it to somebody else. */
  setClaim(claim: Claim): void;
  /** Kill the process and let go. */
  close(): void;
  /**
   * Resolves when the process has gone, or immediately when it already has.
   *
   * The exit code is the one `exitCode()` reports, and `signal` is set when
   * the runtime said the process was signalled rather than exiting by itself.
   */
  waitForExit(): Promise<{ exitCode?: number; signal?: string }>;
}

/**
 * A pseudoterminal, as this host needs one.
 *
 * Handed in rather than imported: a PTY is a native binding, and a library
 * that depended on one would not load under a runtime it was not built for.
 * The daemon passes `node-pty` when it has it; a host on another runtime
 * passes its own, and one that passes none keeps pipes and says `isPty: false`.
 */
export interface Pty {
  /** Everything the terminal writes, VT sequences included. */
  onData(listen: (data: string) => void): void;
  /** Called once, when the process goes. */
  onExit(listen: (exit: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

/** Start one. The shape `node-pty`'s own `spawn` already has. */
export type SpawnPty = (
  file: string,
  args: string[],
  options: { cwd?: string; cols: number; rows: number; env: Record<string, string | undefined> },
) => Pty;

/**
 * The shells this host can open.
 *
 * A port, because a terminal is a subprocess: which one, and how it is
 * spawned, is the runtime's business rather than the protocol's. A host given
 * none serves neither `createTerminal` nor `disposeTerminal`, and says so with
 * `-32601` rather than opening nothing and reporting success.
 *
 * It lives here rather than beside `HostOptions` because it describes shells
 * rather than hosts, and `types/agent.ts` importing it from `host.ts` was a
 * cycle for no reason. A backend is handed `StartTerminals` instead, the
 * factory the host wraps around this port so a terminal it opens is a channel
 * the host owns.
 */
export interface TerminalStore {
  /** Open one, in a directory the host has already checked. */
  create(options: TerminalOptions): Terminal;
}

/**
 * A terminal a backend asks the host to open.
 *
 * The backend says what to run and where, and nothing else: the host owns the
 * channel, the URI, the registration on the root list and the routing of
 * actions, none of which a backend can do for itself.
 */
export interface OpenTerminal {
  /** The directory to start in. */
  cwd: string;
  /** The program to run, or a shell line when `args` is absent. */
  command: string;
  /**
   * The program's arguments, making `command` an argv rather than a line.
   *
   * The two are not the same thing, for the reason on `TerminalOptions.args`.
   */
  args?: string[];
  /** Environment variables for the process, over the host's own. */
  env?: Record<string, string | undefined>;
  /** Display name. The process's own if none is given. */
  name?: string;
}

/**
 * A terminal a backend opened through the host.
 *
 * A handle rather than the channel: the backend reads its output, waits for
 * it, writes to it and gives it up, and the host answers for the channel a
 * client subscribes to.
 */
export interface OpenedTerminal {
  /** The channel URI the host allocated. */
  readonly uri: string;
  /**
   * Everything written so far, and the exit code once there is one.
   *
   * Reconstructed from the channel's own content, so a backend reads what a
   * client reads rather than a second copy the host kept.
   */
  output(): { output: string; exitCode?: number };
  /** Resolves when the process has gone, or immediately when it already has. */
  waitForExit(): Promise<{ exitCode?: number; signal?: string }>;
  /** Send input. Ignored once the process has exited. */
  write(data: string): void;
  /** Record a new size, and tell a pseudoterminal about it when there is one. */
  resize(cols: number, rows: number): void;
  /**
   * End the process and let go of it.
   *
   * The terminal stays on the root list, exited, the way a `!` command's does:
   * a transcript may still point at the channel. `release` is what takes it
   * off the list.
   */
  kill(): void;
  /**
   * Give the terminal back to the host.
   *
   * It comes off the root list, so a released terminal is not one every
   * client goes on drawing. The process is ended too when it has not already
   * gone, because a shell the host no longer lists and a backend no longer
   * holds is a process nothing can reach and nothing can stop. `kill` is for
   * ending one that should stay listed.
   */
  release(): void;
}

/**
 * The host's terminal factory, handed to a backend on `Start`.
 *
 * The host owns the channel, the URI, the registration and the emit, so a
 * backend opens one through this rather than reaching for a port. A backend
 * given the raw store minted a URI the root list had never heard of and sent
 * its actions to the session channel, because that is the channel `start.emit`
 * knows.
 */
export interface StartTerminals {
  /** Open one, on a channel of the host's own. */
  open(options: OpenTerminal): OpenedTerminal;
}
