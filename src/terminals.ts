import { spawn } from 'node:child_process';
import type { Terminal, TerminalOptions } from './types/terminals.js';

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
const shellOf = (): string => process.env.SHELL ?? '/bin/sh';

export function createTerminal(options: TerminalOptions): Terminal {
  const { uri, cwd, emit } = options;
  let title = options.name ?? shellOf().slice(shellOf().lastIndexOf('/') + 1);
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

  const child = spawn(shellOf(), [], {
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
    env: { ...process.env, TERM: 'dumb', COLUMNS: String(cols), LINES: String(rows) },
  });

  child.stdout.on('data', (chunk: Buffer) => said(chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => said(chunk.toString('utf8')));
  child.on('error', (error: Error) => {
    said(`${error.message}\n`);
    exitCode = 127;
    emit('terminal', { type: 'terminal/exited', exitCode });
  });
  child.on('exit', (code: number | null, signal: string | null) => {
    // A signal is not an exit code, and 128+n is the shell's own convention
    // for one - better than reporting nothing, which reads as still running.
    exitCode = code ?? (signal ? 128 : 0);
    emit('terminal', { type: 'terminal/exited', exitCode });
  });

  return {
    uri,
    title: () => title,
    claim: () => claim,
    exitCode: () => exitCode,

    state: () => ({
      title,
      cwd: `file://${cwd}`,
      cols,
      rows,
      // One part, because without command detection there are no boundaries
      // to divide the output at. The protocol's shape, not a flat string.
      content: buffered === '' ? [] : [{ type: 'unclassified', value: buffered }],
      claim,
      supportsCommandDetection: false,
      isPty: false,
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
      const at = data.indexOf('\u0003');
      if (at !== -1) {
        const rest = data.slice(0, at) + data.slice(at + 1);
        if (rest !== '' && child.stdin.writable) child.stdin.write(rest);
        try { process.kill(-(child.pid ?? 0), 'SIGINT'); }
        // The group is gone, which is the outcome asked for.
        catch { /* nothing left to interrupt */ }
        return;
      }
      if (child.stdin.writable) child.stdin.write(data);
    },

    // Kept because the state reports them and a client draws to them. Nothing
    // is told: there is no pseudoterminal to send SIGWINCH to.
    resize: (nextCols, nextRows) => {
      cols = nextCols;
      rows = nextRows;
      emit('terminal', { type: 'terminal/resized', cols, rows });
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
      child.stdin.end();
      // The group, not the shell: detached, its children outlive it otherwise.
      try { process.kill(-(child.pid ?? 0), 'SIGKILL'); }
      catch { child.kill(); }
    },
  };
}
