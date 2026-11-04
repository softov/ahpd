/**
 * The shells an agent runs commands in, one set per chat.
 *
 * The reference host's `ShellManager`
 * (https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/copilot/copilotShellTools.ts#L55-L302),
 * carried onto this host's terminal store: a shell is a terminal on the root
 * list, claimed by the session, so the person in the session watches the
 * command run and can type into it or stop it. An idle shell is reused, a busy
 * one is skipped, an exited one is dropped, and a call that finds none is
 * given a new one.
 *
 * The terminal a shell runs as is opened through the host's one open block,
 * `heldShell`, which `commanded` and `heldTerminals` use too. The command
 * execution lives in `shellcommand.ts`; this file keeps the shells and the
 * holds that say which one a command may use.
 */

import { shellOf } from '../machines/terminals.js';
import { computerId } from '../machines/computers.js';
import { localPath } from '../resources/fileuri.js';
import { ROOT, retainedTerminalUri } from './channels.js';
import { executeShellCommand, parseSentinel, shellText, shellTypeForExecutable } from './shellcommand.js';
import type { Bag } from '../types/common.js';
import type { Claim, Terminal } from '../types/terminals.js';
import type { HeldShell, ManagedShell, ShellClaim, ShellCommandResult, ShellType, Shells } from '../types/shells.js';
import type { HeldShellOptions } from './terminals.js';
import type { HostContext } from './context.js';

/**
 * How long a new shell is given to say something before its first command: the
 * reference's `WAIT_FOR_PROMPT_TIMEOUT`, which its terminal manager waits on
 * before it hands a new terminal back
 * (https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L506).
 */
const WAIT_FOR_PROMPT_TIMEOUT = 10_000;

/**
 * The actions a terminal sends because its shell said something, which a
 * new shell is waited on for. The rest follow what a client or the host did.
 */
const SPOKEN = new Set([
  'terminal/data',
  'terminal/commandDetectionAvailable',
  'terminal/commandExecuted',
  'terminal/commandFinished',
  'terminal/cwdChanged',
  'terminal/exited',
]);

/**
 * The name a shell's terminal goes by.
 *
 * The reference's `shellDisplayName`, which titles the terminal it makes
 * (copilotShellTools.ts#L204).
 */
const shellDisplayName = (shellType: ShellType): string => (shellType === 'bash' ? 'Bash' : 'PowerShell');

/** What a session keeps of one shell before its entry exists. */
interface Heard {
  /** Everything watching for this shell's actions. */
  listeners: Set<(action: Bag) => void>;
  /** Whether the shell has said anything yet, which a new shell is given time to do. */
  spoke: boolean;
}

/** One shell as a session holds it. */
interface Entry extends Heard {
  shell: ManagedShell;
  terminal: Terminal;
  /**
   * How a command still running in the shell will say it ended, when one is.
   *
   * A command that went to the background or the alternate screen outlived
   * the call that ran it, so the shell stays busy until the mark or the
   * sentinel says its command is over.
   */
  command?: { commandId?: string; sentinel?: string };
}

/**
 * Every chat's shells, made the first time a chat's agent asks for one.
 *
 * One set a chat, as the reference makes one `ShellManager` for each chat it
 * runs: a chat's agent works in its own directory, so a shell another chat
 * opened, and moved about in, is never handed to it.
 */
export interface HostShells {
  /** One chat's shells, or nothing where this host has no terminal store. */
  of(session: string, chat: string): Shells | undefined;
  /** Forget a session's shells. Its terminals are closed with the session. */
  forgetSession(uri: string): void;
}

/**
 * Fold one action of a shell's terminal into what is kept of it, then tell
 * whoever is waiting. The screen is the store's own, fed before the action
 * reaches here, so nothing in this file reads a buffer.
 */
const observe = (kept: Heard, action: Bag): void => {
  if (SPOKEN.has(String(action.type))) kept.spoke = true;
  for (const listen of [...kept.listeners]) listen(action);
};

export function createShells(ctx: HostContext): HostShells {
  const { options, terminals, dispatch, log } = ctx;
  /** Each session's chats, and each chat's shells. */
  const sessions = new Map<string, Map<string, Shells>>();

  /**
   * The directory a new shell starts in: the chat's first working directory,
   * or the session's lead chat's while the chat is not yet held, or the
   * host's own.
   */
  const whereOf = (session: string, chat: string): string => {
    const held = ctx.sessions.get(session);
    const first = (held?.chats.get(chat) ?? held?.chats.get(held.defaultChat))?.workingDirectories()[0];
    return first === undefined ? options.path : localPath(first);
  };

  /** The machine a session was told to run in, as its id, or nothing. */
  const machineOf = (session: string): string | undefined => computerId(ctx.sessions.get(session)?.config.computer);

  const chatShells = (session: string, chat: string): Shells => {
    const entries = new Map<string, Entry>();
    /** The shells running a command, which no other command may use. */
    const busy = new Set<string>();
    /** The shells kept busy after their call, until the command in them ends. */
    const held = new Map<string, () => void>();
    // `shellOf` with nothing asked is the program the store runs when a
    // terminal names no shell, which `heldShell` does not.
    const executable = shellOf();
    const shellType = shellTypeForExecutable(executable);

    const entryOf = (shell: ManagedShell): Entry | undefined => entries.get(shell.id);
    const alive = (entry: Entry): boolean => terminals.get(entry.shell.terminalUri) === entry.terminal;

    /** The terminal's scrollback, or nothing once its terminal is gone. */
    const content = (shell: ManagedShell): string => {
      const entry = entryOf(shell);
      if (entry === undefined || !alive(entry)) return '';
      return entry.terminal.state().content
        .map((part) => (part.type === 'command' ? part.output : part.value))
        .join('');
    };

    const listen = (entry: Heard, listener: (action: Bag) => void): () => void => {
      entry.listeners.add(listener);
      return () => { entry.listeners.delete(listener); };
    };

    /**
     * Tie a call to the shell it was given, and let the call show it.
     *
     * The reference's `_trackToolCall`, which runs whether the shell is taken
     * again or made. The backend that ran the tool puts the terminal on the
     * call, as it does for a `!` command, so this hands it the terminal and
     * nothing more: how a call's content travels is the backend's business.
     */
    const associate = (claim: ShellClaim, entry: Entry): void => {
      claim.opened?.({ uri: entry.shell.terminalUri, isPty: entry.terminal.state().isPty === true });
    };

    /**
     * Wait for a new shell to say something, for at most
     * `WAIT_FOR_PROMPT_TIMEOUT`.
     *
     * A shell this host opens is handed back at once, so its first command
     * waits here instead. A shell on pipes says nothing until it is given a
     * command, and is not waited on.
     */
    const spoken = (entry: Entry): Promise<void> => new Promise((resolve) => {
      if (entry.spoke || entry.terminal.state().isPty !== true) {
        resolve();
        return;
      }
      const done = (): void => {
        clearTimeout(timer);
        stop();
        resolve();
      };
      const timer = setTimeout(done, WAIT_FOR_PROMPT_TIMEOUT);
      const stop = listen(entry, () => { if (entry.spoke) done(); });
    });

    /** A hold on one shell, released once, as the reference's `IReference` is. */
    const reference = (shell: ManagedShell): HeldShell => {
      let released = false;
      return {
        shell,
        release: () => {
          if (released) return;
          released = true;
          busy.delete(shell.id);
        },
      };
    };

    /**
     * An idle shell, or a new one claimed by the call that asked.
     *
     * The reference's `getOrCreateShell`. A shell taken again keeps the claim
     * it was opened with, as the reference's does, and is shown on the call
     * that took it, as a new one is.
     */
    const acquire = async (claim: ShellClaim): Promise<HeldShell> => {
      for (const entry of entries.values()) {
        if (!alive(entry)) continue;
        if (entry.terminal.lifecycle().status === 'exited') {
          entries.delete(entry.shell.id);
          continue;
        }
        // A command is already running there, and sharing it would interleave both.
        if (busy.has(entry.shell.id)) continue;
        busy.add(entry.shell.id);
        associate(claim, entry);
        return reference(entry.shell);
      }
      const store = options.terminals;
      if (store === undefined) throw new Error('There is no shell here to run it in');
      const id = crypto.randomUUID();
      const key = crypto.randomUUID();
      const wanted: Claim = {
        kind: 'session',
        session,
        chat: claim.chat,
        ...(claim.turnId !== undefined ? { turnId: claim.turnId } : {}),
        ...(claim.toolCallId !== undefined ? { toolCallId: claim.toolCallId } : {}),
      };
      /*
       * A session in a machine runs its shell there: the port is asked how to
       * reach the machine with this program, and the host's terminal runs that
       * descriptor. The terminal is still the host's to list and watch, and
       * only the process moves. The machine is named on the terminal too, so
       * the store puts no integration into a shell whose scripts are not there.
       */
      const machine = machineOf(session);
      let asked: HeldShellOptions = {
        uri: retainedTerminalUri(claim.chat, key),
        cwd: whereOf(session, chat),
        claim: wanted,
        name: shellDisplayName(shellType),
        nonInteractive: true,
        preventShellHistory: true,
        kept: { chat: claim.chat, key, session },
        ...(machine === undefined ? {} : { machine }),
      };
      if (machine !== undefined) {
        const computers = options.computers;
        if (computers === undefined) {
          throw new Error(`This session asked to run in ${machine}, and this host has no computer plugin to run it in`);
        }
        const how = await computers.how(machine, { command: executable });
        if (how === undefined) throw new Error(`There is no computer called ${machine}`);
        /*
         * The descriptor's program starts on the host, and the machine's own
         * directory is carried in its argv, as it is for a terminal a
         * backend opens in a machine. The session's directory is the
         * machine's spelling and would name nothing here.
         */
        asked = {
          ...asked,
          cwd: how.cwd ?? options.path,
          command: how.command,
          ...(how.args === undefined ? {} : { args: how.args }),
          ...(how.env === undefined ? {} : { env: how.env }),
        };
      }
      const heard: Heard = { listeners: new Set(), spoke: false };
      const terminal = ctx.heldShell(store, {
        ...asked,
        onAction: (action) => { observe(heard, action); },
      });
      const shell: ManagedShell = { id, terminalUri: terminal.uri, shellType, executable };
      const entry: Entry = Object.assign(heard, { shell, terminal });
      entries.set(id, entry);
      busy.add(id);
      /*
       * The root's list carries the shell from the moment it opens.
       *
       * Nothing else says it: the claim is the one the terminal was created
       * with, so the store sends no `terminal/claimed`, and the host's refresh
       * on a claim or a title never runs for it.
       */
      dispatch(ROOT, { type: 'root/terminalsChanged', terminals: ctx.terminalInfo() });
      log(`made the ${shellType} shell ${id} for ${session} (${terminal.uri}, ${executable})`);
      associate(claim, entry);
      return reference(shell);
    };

    /**
     * Run one command, and answer how it ended.
     *
     * The execution is `shellcommand.ts`; what is here is the shell it runs
     * in: a new shell is given time to say something, and a command that
     * outlives its call says how it ends so the shell stays busy until then.
     */
    const run = async (shell: ManagedShell, command: string, timeoutMs: number): Promise<ShellCommandResult> => {
      const entry = entryOf(shell);
      if (entry === undefined) throw new Error(`There is no shell ${shell.id}`);
      await spoken(entry);
      return await executeShellCommand({
        terminal: entry.terminal,
        shellType: shell.shellType,
        command,
        timeoutMs,
        listen: (onAction) => listen(entry, onAction),
        log,
        stillRunning: (how) => { entry.command = how; },
      });
    };

    /**
     * Start one command, and answer once it has really ended.
     *
     * The call that started it is answered at once and keeps its hold on the
     * shell, which is what keeps the next command off it until this settles.
     * Nothing else ends the command: not the alternate screen, not a client
     * narrowing the claim, and not a timeout, because no call waits for an
     * answer any more.
     */
    const start = async (shell: ManagedShell, command: string): Promise<ShellCommandResult> => {
      const entry = entryOf(shell);
      if (entry === undefined) throw new Error(`There is no shell ${shell.id}`);
      await spoken(entry);
      return await executeShellCommand({
        terminal: entry.terminal,
        shellType: shell.shellType,
        command,
        untilItEnds: true,
        listen: (onAction) => listen(entry, onAction),
        log,
      });
    };

    /**
     * Keep a shell held until the command in it ends.
     *
     * The reference waits for the shell's own end-of-command mark, or its exit.
     * A command that ran without marks ends at its sentinel, which is already
     * written after it and which the shell echoes once the command returns.
     */
    const hold = (shell: ManagedShell): void => {
      const entry = entryOf(shell);
      if (entry === undefined || held.has(shell.id)) return;
      const command = entry.command;
      const free = (): void => {
        stop();
        held.delete(shell.id);
        busy.delete(shell.id);
        delete entry.command;
      };
      const ended = (): boolean => command?.sentinel !== undefined
        && parseSentinel(content(shell), command.sentinel).found;
      const stop = listen(entry, (action) => {
        if (action.type === 'terminal/exited') free();
        else if (command?.commandId !== undefined) {
          if (action.type === 'terminal/commandFinished' && String(action.commandId) === command.commandId) free();
        }
        else if (command?.sentinel !== undefined) {
          if (action.type === 'terminal/data' && ended()) free();
        }
        else if (action.type === 'terminal/commandFinished') free();
      });
      held.set(shell.id, free);
      // Already over, between the call's answer and this.
      if (entry.terminal.exitCode() !== undefined || ended()) free();
    };

    const shutdown = (id: string): boolean => {
      const entry = entries.get(id);
      if (entry === undefined) return false;
      held.get(id)?.();
      held.delete(id);
      entries.delete(id);
      busy.delete(id);
      // The reference's `disposeTerminal`: the process ends and the row goes.
      if (entry.terminal.exitCode() === undefined) entry.terminal.close();
      if (terminals.get(entry.shell.terminalUri) === entry.terminal) {
        terminals.delete(entry.shell.terminalUri);
        dispatch(ROOT, { type: 'root/terminalsChanged', terminals: ctx.terminalInfo() });
      }
      log(`shut down the shell ${id}`);
      return true;
    };

    return {
      executable: () => executable,
      shellType: () => shellType,
      acquire,
      run,
      start,
      hold,
      get: (id) => entries.get(id)?.shell,
      list: () => [...entries.values()].filter(alive).map((entry) => entry.shell),
      content,
      lifecycle: (shell) => {
        const entry = entryOf(shell);
        const state = entry?.terminal.lifecycle();
        if (state === undefined || state.status === 'running') return { status: 'running' };
        return { status: 'exited', ...('exitCode' in state && typeof state.exitCode === 'number' ? { exitCode: state.exitCode } : {}) };
      },
      send: (shell, text) => {
        const entry = entryOf(shell);
        if (entry !== undefined) entry.terminal.write(shellText(entry.terminal, text, false, false));
      },
      shutdown,
    };
  };

  return {
    of: (session, chat) => {
      if (options.terminals === undefined) return undefined;
      let chats = sessions.get(session);
      if (chats === undefined) {
        chats = new Map();
        sessions.set(session, chats);
      }
      let found = chats.get(chat);
      if (found === undefined) {
        found = chatShells(session, chat);
        chats.set(chat, found);
      }
      return found;
    },
    forgetSession: (uri) => {
      sessions.delete(uri);
    },
  };
}
