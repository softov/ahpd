/**
 * `ahpd status`: say whether one is running, and where.
 *
 * What is read is the record the detached daemon wrote - never the secret in
 * it. The JSON is the token-free record the status line is built from, so
 * `--json` cannot become the one surface that prints a credential.
 */

import { output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import { running, statusLine } from '../daemon.js';
import { checkingUpdates, updateLine } from '../update.js';
import { manifest } from '../version.js';
import { optionsFrom, serverFields } from './options.js';

export const declareStatus = (registry: Registry<object>): Command => registry.action({
  id: 'daemon.status',
  summary: 'Say whether one is running, and where',
  description: 'Reads the record a detached daemon keeps of itself; the token it holds is never printed.',
  surfaces: { cli: { pattern: ['status'] }, http: { method: 'GET', path: '/status' } },
  input: serverFields,
  run: (context) => {
    const found = running();
    if (found === undefined) {
      /*
       * A remote caller must not take the process down with them.
       *
       * `process.exit` here is the terminal's, and the process answering an
       * HTTP request is the daemon: exiting would close every other client's
       * socket. A record that is not there is answered rather than exited.
       */
      if (context.surface === 'remote') {
        throw new Error('No daemon record is written; this daemon was not started by `ahpd start`');
      }
      // `--json` is answered even when there is nothing to report, because a
      // script that asked for JSON should not have to parse prose.
      context.write(context.globals['json'] === true ? '{"running":false}\n' : 'None running.\n');
      process.exit(1);
    }
    let text = `${statusLine(found)}\n`;
    if (found.paths.length > 0) text += `sessions in ${found.paths.join(', ')}\n`;
    // Absent from a record written by an older daemon, which is the one case
    // where saying nothing is better than guessing which store it was given.
    if (found.automations !== undefined) text += `automations ${found.automations}\n`;
    const options = optionsFrom(context.input as Readonly<Record<string, unknown>>);
    if (checkingUpdates(options.updateCheck)) text += updateLine(manifest()) ?? '';
    return output({
      pid: found.pid,
      url: found.url,
      paths: found.paths,
      startedAt: found.startedAt,
      ...(found.automations === undefined ? {} : { automations: found.automations }),
    }, text);
  },
});
