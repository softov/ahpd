import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

/**
 * What the Claude SDK's `spawnClaudeCodeProcess` hands back.
 *
 * Declared here rather than imported so this file does not depend on the SDK's
 * type surface for four fields: a `ChildProcess` satisfies it as it is, which
 * is what makes the host case a plain `spawn`.
 */
export interface Spawned {
  stdin: Writable;
  stdout: Readable;
  readonly killed: boolean;
  readonly exitCode: number | null;
  kill(signal: NodeJS.Signals): boolean;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  once(event: 'error', listener: (error: Error) => void): void;
  off(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  off(event: 'error', listener: (error: Error) => void): void;
}

/** What to run, as the SDK asked it. */
export interface Asked {
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
}

/**
 * A process that is not there yet, standing in for one that will be.
 *
 * The SDK's spawn hook is synchronous and the host's `computers` port is not:
 * asking a machine how to reach it is a `docker inspect`, so the descriptor
 * arrives a tick or two after the hook must have returned something. This is
 * that something - the streams exist at once and carry nothing until the real
 * child is there, at which point they are joined to it.
 *
 * Writes that arrive early are held by the `PassThrough` rather than dropped,
 * so the SDK's first frame is not lost to the inspect. A failure to resolve or
 * to spawn is delivered as `error`, which is the same event a failed
 * `spawn` raises, so the SDK's own handling covers both.
 */
class Deferred implements Spawned {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  #child: ChildProcess | undefined;
  #killed = false;
  #signal: NodeJS.Signals | undefined;
  #exit: ((code: number | null, signal: NodeJS.Signals | null) => void)[] = [];
  #fail: ((error: Error) => void)[] = [];
  #settled = false;

  get killed(): boolean {
    return this.#child?.killed ?? this.#killed;
  }

  get exitCode(): number | null {
    return this.#child?.exitCode ?? null;
  }

  /**
   * Take the real child, or the reason there is none.
   *
   * A kill that arrived before the child did is applied here, so a session
   * abandoned during the inspect does not leave a container running a turn
   * nobody is listening to.
   */
  settle(child: ChildProcess | Error): void {
    if (this.#settled) return;
    this.#settled = true;
    if (child instanceof Error) {
      for (const listener of this.#fail) listener(child);
      this.stdout.end();
      return;
    }
    this.#child = child;
    /*
     * A child that has already gone is an ended stream, not a failure.
     *
     * The CLI exiting while the SDK is still writing is ordinary - a refused
     * flag, a machine without the executable - and the write that loses the
     * race raises `EPIPE` on a stream nobody is listening to, which would
     * reach the process as an uncaught error and take the daemon with it. The
     * exit is what says what happened, and it is already forwarded below.
     */
    const quiet = (stream: { on(event: 'error', listener: (error: Error) => void): unknown }): void => {
      stream.on('error', () => {});
    };
    quiet(this.stdin);
    quiet(this.stdout);
    if (child.stdin !== null) quiet(child.stdin);
    if (child.stdout !== null) quiet(child.stdout);
    this.stdin.pipe(child.stdin as Writable);
    (child.stdout as Readable).pipe(this.stdout);
    child.on('exit', (code, signal) => { for (const listener of this.#exit) listener(code, signal); });
    child.on('error', (error) => { for (const listener of this.#fail) listener(error); });
    if (this.#killed) child.kill(this.#signal ?? 'SIGTERM');
  }

  kill(signal: NodeJS.Signals): boolean {
    this.#killed = true;
    this.#signal = signal;
    return this.#child === undefined ? true : this.#child.kill(signal);
  }

  on(event: 'exit' | 'error', listener: never): void {
    if (event === 'exit') this.#exit.push(listener);
    else this.#fail.push(listener);
  }

  once(event: 'exit' | 'error', listener: never): void {
    // The SDK removes what it registered, and a one-shot that forgets itself
    // would leak a closure per turn on a long session.
    const wrap = ((...args: unknown[]) => {
      this.off(event, wrap as never);
      (listener as (...given: unknown[]) => void)(...args);
    }) as never;
    this.on(event, wrap);
  }

  off(event: 'exit' | 'error', listener: never): void {
    const held = event === 'exit' ? this.#exit : this.#fail;
    const at = held.indexOf(listener);
    if (at !== -1) held.splice(at, 1);
  }
}

/**
 * Start the CLI inside a machine, through a descriptor the host resolves.
 *
 * `how` is the host's `computers` port, already bound to one machine: it is
 * given what to run and answers the whole command that runs it in there, which
 * for docker is `exec -i -w <dir> -e K=V <id> <command> <args>`. Nothing here
 * knows that, which is the point - a second runtime answers the same question
 * differently and this is unchanged.
 */
export const spawnInside = (
  asked: Asked,
  how: (asked: Asked) => Promise<{ command: string; args?: string[]; env?: Record<string, string> } | undefined>,
  where: string,
): Spawned => {
  const held = new Deferred();
  void how(asked).then(
    (moved) => {
      if (moved === undefined) {
        held.settle(new Error(`There is no computer called ${where}`));
        return;
      }
      held.settle(spawn(moved.command, moved.args ?? [], {
        // The docker program's own environment, not the machine's: what the
        // session is to see travelled in the descriptor as `-e` flags.
        ...(moved.env === undefined ? {} : { env: { ...process.env, ...moved.env } }),
        stdio: ['pipe', 'pipe', 'inherit'],
      }));
    },
    (error: unknown) => held.settle(error instanceof Error ? error : new Error(String(error))),
  );
  return held;
};
