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
  /** Rename it. */
  setTitle(title: string): void;
  /** Hand it to somebody else. */
  setClaim(claim: Claim): void;
  /** Kill the process and let go. */
  close(): void;
}
