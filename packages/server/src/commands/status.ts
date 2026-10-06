/**
 * `ahpd status`: say whether one is running, and where.
 *
 * What is read is the record the detached daemon wrote - never the secret in
 * it. The JSON is the token-free record the status line is built from, so
 * `--json` cannot become the one surface that prints a credential. Served over
 * HTTP there is no record to read: the daemon answering is the one described.
 */

import { output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import { running, statusLine } from '../daemon.js';
import { checkingUpdates, updateLine } from '../update.js';
import { manifest } from '../version.js';
import { conflict, optionsFrom, flagFields } from './options.js';
import type { ServedFacts } from './served.js';

export const declareStatus = (registry: Registry<object>, served?: ServedFacts): Command => registry.action({
  id: 'daemon.status',
  summary: 'Say whether one is running, and where',
  description: 'Reads the record a detached daemon keeps of itself; the token it holds is never printed. A served request describes the process answering.',
  surfaces: { cli: { pattern: ['status'] }, http: { method: 'GET', path: '/status' } },
  // Reading whether one runs is done to no one thing, so it names no resource.
  effect: 'read',
  scopes: ['config:read'],
  // Served, every fact is the process answering, so no field could name another.
  ...(served === undefined ? { input: flagFields } : {}),
  run: (context) => {
    const found = served === undefined ? running() : served.running();
    if (found === undefined) {
      // `--json` is answered even when there is nothing to report, because a
      // script that asked for JSON should not have to parse prose.
      if (context.globals['json'] === true) context.write('{"running":false}\n');
      conflict('None running.');
    }
    let text = `${statusLine(found)}\n`;
    if (found.paths.length > 0) text += `sessions in ${found.paths.join(', ')}\n`;
    // Absent from a record written by an older daemon, which is the one case
    // where saying nothing is better than guessing which store it was given.
    if (found.automations !== undefined) text += `automations ${found.automations}\n`;
    if (served === undefined) {
      const options = optionsFrom(context.input as Readonly<Record<string, unknown>>);
      if (checkingUpdates(options.updateCheck)) text += updateLine(manifest()) ?? '';
    }
    return output({
      pid: found.pid,
      url: found.url,
      paths: found.paths,
      startedAt: found.startedAt,
      ...(found.automations === undefined ? {} : { automations: found.automations }),
    }, text);
  },
});
