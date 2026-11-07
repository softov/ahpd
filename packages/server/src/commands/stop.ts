/**
 * `ahpd stop`: stop the one in the background.
 *
 * The record is the whole of what this knows; there is no host to build and
 * nothing to parse beyond the flags a run would have taken, which are accepted
 * and ignored.
 */

import { output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import { STOP_WAIT_MS, configuredMs, stop as stopDaemon } from '../daemon.js';
import { conflict, flagFields } from './options.js';

export const declareStop = (registry: Registry<object>): Command => registry.action({
  id: 'daemon.stop',
  summary: 'Stop the one running in the background',
  description: 'Asks the process the record names to stop, waits for it, and forgets where it was.',
  surfaces: { cli: { pattern: ['stop'] } },
  input: flagFields,
  run: async (context) => {
    const stopped = await stopDaemon();
    if (stopped === undefined) {
      // As with `status`, a script that asked for JSON gets JSON even when the
      // answer is that there was nothing to stop. The result stays on stdout;
      // the failure that follows goes to stderr, as every failure does.
      if (context.globals['json'] === true) context.write('{"stopped":false}\n');
      conflict('None running.');
    }
    const { url, pid } = stopped.record;
    return output(
      { url, pid, killed: stopped.killed },
      // `Stopped` is the line for a process that is gone, so the one that had
      // to be killed says which it was rather than reading as a clean stop.
      stopped.killed
        ? `Killed ${url} (pid ${String(pid)}): it did not stop within ${String(configuredMs('stopWaitMs', STOP_WAIT_MS) / 1000)} seconds.\n`
        : `Stopped ${url} (pid ${String(pid)}).\n`,
    );
  },
});
