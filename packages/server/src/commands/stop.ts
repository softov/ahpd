/**
 * `ahpd stop`: stop the one in the background.
 *
 * The record is the whole of what this knows; there is no host to build and
 * nothing to parse beyond the flags a run would have taken, which are accepted
 * and ignored the way they always were.
 */

import { output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import { stop as stopDaemon } from '../daemon.js';
import { serverFields } from './options.js';

export const declareStop = (registry: Registry<object>): Command => registry.action({
  id: 'daemon.stop',
  summary: 'Stop the one running in the background',
  description: 'Sends SIGTERM to the process the record names, and forgets where it was.',
  surfaces: { cli: { pattern: ['stop'] } },
  input: serverFields,
  run: (context) => {
    const stopped = stopDaemon();
    if (stopped === undefined) {
      // As with `status`, a script that asked for JSON gets JSON even when the
      // answer is that there was nothing to stop.
      context.write(context.globals['json'] === true ? '{"stopped":false}\n' : 'None running.\n');
      process.exit(1);
    }
    return output(
      { url: stopped.url, pid: stopped.pid },
      `Stopped ${stopped.url} (pid ${String(stopped.pid)}).\n`,
    );
  },
});
