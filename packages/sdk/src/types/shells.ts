/**
 * The shells an agent runs its commands in, and what a command did.
 *
 * The reference host's `ShellManager` keeps a chat's shells and hands one
 * to a call for as long as the command runs, so a model's commands share a
 * directory and its variables the way a person's do. These are the shapes the
 * manager and the command execution speak, kept apart from the terminal store
 * so a tool can name a shell without loading a runtime.
 * https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/copilot/copilotShellTools.ts#L55-L302
 */

import type { CommandTerminal } from './terminals.js';

/** The kinds of shell the reference's tool set has a name for. */
export type ShellType = 'bash' | 'powershell';

/** One shell a chat keeps: its own id, the terminal it runs as, and what started it. */
export interface ManagedShell {
  /** The manager's name for it, which a tool call names when it picks one. */
  id: string;
  /** The terminal channel a client watches it through. */
  terminalUri: string;
  shellType: ShellType;
  /** The program the shell runs, as the store resolved it. */
  executable: string;
}

/** How a command ended. */
export type ShellCommandStatus = 'completed' | 'timeout' | 'background' | 'altBuffer' | 'shellExited';

/** What one command did, and the output the model reads. */
export interface ShellCommandResult {
  status: ShellCommandStatus;
  /** The command's own code, for `completed` and `shellExited`. */
  exitCode?: number;
  /** The output for the model, with no control sequences and cut to the cap. */
  output: string;
}

/**
 * A shell the manager gave to a call, and the hold on it.
 *
 * Releasing it makes the shell idle again, which is what lets the next command
 * of the session take it. A shell whose command went on in the background, or
 * into the alternate screen, is held until its command ends instead.
 */
export interface HeldShell {
  shell: ManagedShell;
  release(): void;
}

/** What a call asks the manager for when it needs a shell. */
export interface ShellClaim {
  /** The chat the call is in, which the shell's terminal is claimed and kept for. */
  chat: string;
  /** The turn the call belongs to, where the backend knows it. */
  turnId?: string;
  /** The call itself, where the backend named it. */
  toolCallId?: string;
  /** The call's own way of showing the terminal the shell runs as. */
  opened?: (terminal: CommandTerminal) => void;
}

/** A chat's shells, and what may be done with them. */
export interface Shells {
  /** The program a new shell runs. */
  executable(): string;
  /** The kind of shell `executable` is. */
  shellType(): ShellType;
  /** An idle shell, or a new one claimed by the call that asked. */
  acquire(claim: ShellClaim): Promise<HeldShell>;
  /** Write one command, and answer how it ended. */
  run(shell: ManagedShell, command: string, timeoutMs: number): Promise<ShellCommandResult>;
  /**
   * Start one command, and answer once it has really ended.
   *
   * No timeout and no early end: the command runs until its own mark, its
   * sentinel, or the shell exits. The caller answers its own call at once and
   * keeps its hold on the shell until this settles, so the next command opens
   * another shell rather than interleaving with this one.
   */
  start(shell: ManagedShell, command: string): Promise<ShellCommandResult>;
  /** Keep a shell busy until the command in it ends, after its call let go. */
  hold(shell: ManagedShell): void;
  /** One by the id a call names, or nothing. */
  get(id: string): ManagedShell | undefined;
  /** Every shell the session still has, the exited ones left out. */
  list(): ManagedShell[];
  /** Everything the shell's terminal holds, as a client reading it late would. */
  content(shell: ManagedShell): string;
  /** Whether the shell still runs, and what it exited with. */
  lifecycle(shell: ManagedShell): { status: 'running' } | { status: 'exited'; exitCode?: number };
  /** Write text to the shell without running it, as a person typing would. */
  send(shell: ManagedShell, text: string): void;
  /** End a shell and take its terminal off the list. */
  shutdown(id: string): boolean;
}
