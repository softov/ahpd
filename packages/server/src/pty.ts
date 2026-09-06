/** The optional pseudoterminal binding, and how to find out whether it works. */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { SpawnPty } from '@ahpd/sdk';

/**
 * By name at runtime, so the type checker is not asked for a module that may
 * not be installed - which is the whole point of it being optional.
 */
const MODULE = 'node-pty' as string;

/** This file, as the child is told to run it. */
const SELF = fileURLToPath(import.meta.url);

/**
 * Whether this runtime can load it, asked of a process that is allowed to die.
 *
 * `node-pty` is native code, and native code that does not match its runtime
 * does not throw: `dlopen` aborts the process, or the module panics on a
 * function the runtime does not implement, and neither is something a
 * `try/catch` around the import can hold. Bun's install of `node-pty` does
 * exactly this, which takes the whole daemon down over a feature that is
 * marked optional.
 *
 * So the import is tried in a child of the same runtime first, and only
 * repeated here once the child has survived it. A crash is then an exit code.
 */
const loadable = (): boolean => {
  const probe = spawnSync(process.execPath, [SELF, '--probe'], { stdio: 'ignore' });
  return probe.status === 0;
};

/**
 * The binding, if this machine has one that runs.
 *
 * With it, shells run under a real terminal and the shell's own OSC 133 marks
 * turn into command boundaries. Without it they run on pipes and the state
 * says `isPty: false`, which is what the protocol has that flag for.
 */
export const pty = async (): Promise<{ pty?: SpawnPty }> => {
  if (!loadable()) return {};
  try {
    const found = await import(/* @vite-ignore */ MODULE) as { spawn?: unknown };
    return typeof found.spawn === 'function' ? { pty: found.spawn as SpawnPty } : {};
  }
  catch {
    return {};
  }
};

// The child `loadable` spawns. Nothing else in this file has run yet, and
// nothing else is imported, so what it exits with is about `node-pty` alone.
if (process.argv[1] === SELF && process.argv[2] === '--probe') {
  try {
    const found = await import(/* @vite-ignore */ MODULE) as { spawn?: unknown };
    process.exit(typeof found.spawn === 'function' ? 0 : 1);
  }
  catch {
    process.exit(1);
  }
}
