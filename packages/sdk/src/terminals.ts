import { spawn } from 'node:child_process';
import type { Pty, SpawnPty, Terminal, TerminalOptions } from './types/terminals.js';
import type { TerminalStore } from './types/host.js';

/**
 * A shell on the host machine, as a terminal channel.
 *
 * Pipes, not a pseudoterminal: a PTY needs a native binding this daemon does
 * not depend on, and the protocol has `isPty: false` for exactly this - "output
 * is plain text and clients do not need to parse VT sequences". So a command
 * runs and its output arrives, and anything that draws itself with cursor
 * movement will not look right. Said in the state rather than discovered.
 *
 * `node:child_process` is used because all three supported runtimes provide it.
 */

/** What runs, when nothing else was asked for. */
const shellOf = (asked?: string): string => asked ?? process.env.SHELL ?? '/bin/sh';

/**
 * What a shell says about itself, in the escape sequences it says it with.
 *
 * OSC 133 is the command-boundary convention every shell integration script
 * writes - `A` before the prompt, `B` where the command starts, `C` where its
 * output does, `D;<code>` when it finished - and OSC 7 is the directory. They
 * arrive mixed into the output, so this reads them out and leaves the rest
 * alone: the bytes still go to the client, which is drawing a terminal and
 * needs them.
 *
 * Only under a pseudoterminal, because only then is there a shell running its
 * own prompt to emit them.
 */
const MARKS = /\u001b\](133|7);([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;

export function createTerminal(options: TerminalOptions, pty?: SpawnPty): Terminal {
  const { uri, cwd, emit } = options;
  const shell = shellOf(options.shell);
  let title = options.name ?? shell.slice(shell.lastIndexOf('/') + 1);
  let claim = options.claim;
  let cols = options.cols ?? 80;
  let rows = options.rows ?? 24;
  let exitCode: number | undefined;
  /**
   * Everything written so far, so a client that subscribes late sees it.
   *
   * Capped: a terminal left running `tail -f` for a day is a host holding a
   * day of output for a client that may never come back.
   */
  let buffered = '';
  const KEEP = 200_000;

  const said = (data: string): void => {
    buffered = (buffered + data).slice(-KEEP);
    emit('terminal', { type: 'terminal/data', data });
  };

  /*
   * `-c` when there is a command, and nothing when there is not.
   *
   * A shell given `-c` runs the one thing and exits. Under pipes that is the
   * only completion signal there is; under a pseudoterminal the shell says so
   * itself, in OSC 133.
   */
  const args = options.command === undefined ? [] : ['-c', options.command];
  const environment = {
    ...process.env,
    // A real terminal under a pty, and an honest `dumb` without one.
    TERM: pty ? (process.env.TERM ?? 'xterm-256color') : 'dumb',
    COLUMNS: String(cols),
    LINES: String(rows),
  };

  /** Where the shell says it is, once it has said. */
  let where = cwd;
  /** The command being run, from `C` until `D`. */
  let command: { id: string; line: string; at: number } | undefined;
  /** What has been typed since the prompt, so the command line can be read back. */
  let typed = '';

  /**
   * Read the shell's own marks out of a chunk, and say what they meant.
   *
   * The chunk still reaches the client whole: this is a reader, not a filter,
   * and a client drawing a terminal needs the bytes it was sent.
   */
  const marked = (data: string): void => {
    for (const found of data.matchAll(MARKS)) {
      const [, kind, body = ''] = found;
      if (kind === '7') {
        // `file://host/path`, per the convention. The host part is dropped:
        // the path is on this machine, and that is what a client opens.
        const path = body.replace(/^file:\/\/[^/]*/, '');
        if (path !== '' && path !== where) {
          where = path;
          emit('terminal', { type: 'terminal/cwdChanged', cwd: `file://${path}` });
        }
        continue;
      }
      const mark = body.split(';')[0];
      if (mark === 'A') { typed = ''; continue; }
      if (mark === 'C') {
        command = { id: `c${String(Date.now())}`, line: typed.trim(), at: Date.now() };
        emit('terminal', {
          type: 'terminal/commandExecuted',
          commandId: command.id,
          commandLine: command.line,
          timestamp: command.at,
        });
        continue;
      }
      if (mark !== 'D' || command === undefined) continue;
      const code = Number(body.split(';')[1]);
      emit('terminal', {
        type: 'terminal/commandFinished',
        commandId: command.id,
        ...(Number.isFinite(code) ? { exitCode: code } : {}),
        durationMs: Date.now() - command.at,
      });
      command = undefined;
    }
  };

  const terminal: Pty | undefined = pty?.(shell, args, {
    ...(cwd !== undefined ? { cwd } : {}),
    cols,
    rows,
    env: environment,
  });
  if (terminal !== undefined) {
    terminal.onData((data) => { marked(data); said(data); });
    terminal.onExit(({ exitCode: code }) => { exitCode = code; ended(); });
    // Said once, at the start. A client MUST check this before relying on
    // command boundaries, and the same fact is on the state.
    emit('terminal', { type: 'terminal/commandDetectionAvailable' });
  }

  const child = terminal !== undefined ? undefined : spawn(shell, args, {
    cwd,
    /*
     * Its own process group, so a signal reaches what it started.
     *
     * A shell reading from a pipe runs each command as its own child, and a
     * signal sent to the shell alone leaves the command running. The group is
     * what a terminal driver would have signalled, and this has no driver.
     */
    detached: true,
    // A shell reading commands from a pipe. Without a pseudoterminal there is
    // no point asking it to be interactive: it would print a prompt nobody
    // can answer the way it expects.
    stdio: ['pipe', 'pipe', 'pipe'],
    env: environment,
  });

  child?.stdout.on('data', (chunk: Buffer) => said(chunk.toString('utf8')));
  child?.stderr.on('data', (chunk: Buffer) => said(chunk.toString('utf8')));
  /**
   * Said once, whichever of the three got here first.
   *
   * `error` and `close` can both fire for one failed spawn, and a terminal
   * that announced its own exit twice would be one every client draws as
   * having died, come back, and died again.
   */
  let announced = false;
  const ended = (): void => {
    if (announced) return;
    announced = true;
    emit('terminal', { type: 'terminal/exited', exitCode });
  };
  child?.on('error', (error: Error) => {
    said(`${error.message}\n`);
    exitCode = 127;
    ended();
  });
  child?.on('exit', (code: number | null, signal: string | null) => {
    // A signal is not an exit code, and 128+n is the shell's own convention
    // for one - better than reporting nothing, which reads as still running.
    exitCode = code ?? (signal ? 128 : 0);
  });
  /*
   * Announced on `close` rather than on `exit`, which is a race this lost.
   *
   * `exit` fires when the process goes; `close` fires once its pipes are
   * drained. Between the two there is output already written and not yet
   * read, so a host that reported the exit on `exit` reported a command's
   * result before the result had arrived - which is exactly what a `!`
   * command in the composer reads back.
   */
  child?.on('close', () => {
    // A process that closed without an exit event was killed outright.
    exitCode ??= 0;
    ended();
  });

  return {
    uri,
    title: () => title,
    claim: () => claim,
    exitCode: () => exitCode,
    lifecycle: () => (exitCode === undefined
      ? { status: 'running' }
      : { status: 'exited', exitCode }),

    state: () => ({
      title,
      cwd: `file://${cwd}`,
      cols,
      rows,
      // One part, because without command detection there are no boundaries
      // to divide the output at. The protocol's shape, not a flat string.
      content: buffered === '' ? [] : [{ type: 'unclassified', value: buffered }],
      claim,
      // Both true only under a pseudoterminal: without one there is no shell
      // running its own prompt, so there are no boundaries to report and no
      // VT sequences for a client to parse.
      supportsCommandDetection: terminal !== undefined,
      isPty: terminal !== undefined,
      /*
       * Both spellings, because this host speaks five versions.
       *
       * `lifecycle` is what 0.9.0 requires and is not optional there - a
       * client reading `lifecycle.status` on a 0.8.0-shaped terminal gets
       * `undefined`, which reads as a process that never exits. The flat
       * `exitCode` is what every version before it reads, and this daemon
       * negotiates down to 0.5.1.
       */
      lifecycle: exitCode === undefined
        ? { status: 'running' }
        : { status: 'exited', exitCode },
      ...(exitCode !== undefined ? { exitCode } : {}),
    }),

    write: (data) => {
      if (exitCode !== undefined)
        return;
      /*
       * `^C` is a signal, and there is nothing here to turn it into one.
       *
       * A pseudoterminal has a line discipline that sees the byte and sends
       * SIGINT to the foreground group. Pipes have none, so the byte arrives
       * as input and the command runs on - which is a terminal a runaway
       * command cannot be stopped in. Sending the signal is what the driver
       * would have done.
       */
      /*
       * Under a pseudoterminal the byte is the signal.
       *
       * A pty has a line discipline: `^C` reaches it as input and it sends
       * SIGINT to the foreground group itself, which is the whole point of
       * having one. So this writes it through and does nothing clever.
       */
      if (terminal !== undefined) {
        terminal.write(data);
        // Kept so a command line can be read back at the next `C` mark; the
        // shell echoes what was typed, but the echo arrives as output and
        // this is the only place the input itself is seen.
        typed += data;
        return;
      }
      const at = data.indexOf('\u0003');
      if (at !== -1) {
        const rest = data.slice(0, at) + data.slice(at + 1);
        if (rest !== '' && child?.stdin.writable) child.stdin.write(rest);
        /*
         * The group, named by the child's own pid, and only when there is one.
         *
         * A spawn that failed leaves no pid, and `0` is not a safe stand-in:
         * to `kill` it means every process in *this* process group, so a
         * terminal whose shell never started would signal the host and
         * whatever started the host.
         */
        const group = child?.pid;
        if (group !== undefined) {
          try { process.kill(-group, 'SIGINT'); }
          // The group is gone, which is the outcome asked for.
          catch { /* nothing left to interrupt */ }
        }
        return;
      }
      if (child?.stdin.writable) child.stdin.write(data);
    },

    // Told, when there is something to tell: a pseudoterminal gets the new
    // size and sends SIGWINCH itself. Without one these are kept because the
    // state reports them and a client draws to them.
    resize: (nextCols, nextRows) => {
      terminal?.resize(nextCols, nextRows);
      cols = nextCols;
      rows = nextRows;
      emit('terminal', { type: 'terminal/resized', cols, rows });
    },

    // The scrollback and nothing else. `cols`, `rows`, `title` and `claim` are
    // untouched, which is what the reference suite checks for.
    clear: () => {
      buffered = '';
      emit('terminal', { type: 'terminal/cleared' });
    },

    setTitle: (next) => {
      if (next === title) return;
      title = next;
      emit('terminal', { type: 'terminal/titleChanged', title });
    },

    setClaim: (next) => {
      claim = next;
      emit('terminal', { type: 'terminal/claimed', claim });
    },

    close: () => {
      if (terminal !== undefined) {
        terminal.kill();
        return;
      }
      child?.stdin.end();
      // The group, not the shell: detached, its children outlive it otherwise.
      // Only when there is a pid to name it - see the interrupt above.
      const group = child?.pid;
      if (group === undefined) {
        child?.kill();
        return;
      }
      try { process.kill(-group, 'SIGKILL'); }
      catch { child?.kill(); }
    },
  };
}

/**
 * A shell on this machine, as a host's `TerminalStore`.
 *
 * Kept out of `createHost` for the reason above: spawning is the runtime's
 * business, and a host that opens no terminal should not have to have one.
 *
 * ```ts
 * createHost({ path, agents, terminals: shellTerminals() });
 * ```
 *
 * Given a `pty` it runs shells under a pseudoterminal instead, which is what
 * makes shell integration possible: the shell prints its own OSC 133 marks, so
 * command boundaries and the working directory become facts rather than
 * guesses. The binding is handed in because it is native code - `node-pty` is
 * the daemon's dependency and never this library's, and a host on another
 * runtime passes whatever it has.
 *
 * ```ts
 * import { spawn } from 'node-pty';
 * createHost({ path, agents, terminals: shellTerminals({ pty: spawn }) });
 * ```
 */
export const shellTerminals = (options: { pty?: SpawnPty } = {}): TerminalStore => ({
  create: (asked) => createTerminal(asked, options.pty),
});
