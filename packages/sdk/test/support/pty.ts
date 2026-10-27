/*
 * A pseudoterminal that says whatever a test tells it to.
 *
 * The binding is handed to the store, so a suite drives a fake one rather than
 * needing native code to have been built. It writes only what the test says,
 * and exits only when the test says, so a case can hold a command open and
 * read what a client reads while it runs.
 *
 * Not a test file. `vitest` collects `*.test.ts`, and this is imported by the
 * suites that are.
 */

import type { SpawnPty } from '../../src/types/terminals.js';

/** The fake, and the hands a test moves it with. */
export interface FakePty {
  /** The binding, as `shellTerminals({ pty })` takes it. */
  spawn: SpawnPty;
  /** Write to the terminal the binding started last. */
  say: (data: string) => void;
  /** End the process the binding started last. */
  exit: (exitCode?: number) => void;
  /** Everything a client typed, in order. */
  typed: string[];
  /** The shell and arguments of each start, in order. */
  started: { shell: string; args: string[] | string }[];
}

export function fakePty(): FakePty {
  let listen: ((data: string) => void) | undefined;
  let ended: ((exit: { exitCode: number }) => void) | undefined;
  const typed: string[] = [];
  const started: { shell: string; args: string[] | string }[] = [];
  const spawn: SpawnPty = (shell, args) => {
    started.push({ shell, args });
    return {
      onData: (to) => { listen = to; },
      onExit: (to) => { ended = to; },
      write: (data) => { typed.push(data); },
      resize: () => {},
      kill: () => {},
    };
  };
  return {
    spawn,
    say: (data) => listen?.(data),
    exit: (exitCode = 0) => ended?.({ exitCode }),
    typed,
    started,
  };
}
