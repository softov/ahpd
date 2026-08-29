/** A shell on the host machine, as a terminal channel. */

import type { Bag } from './common.js';
import type { Emit } from './session.js';

/** Who currently holds a terminal: a connected client, or a session. */
export type Claim = Bag;

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
  /** The channel's state, for a subscription snapshot. */
  state(): Bag;

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
