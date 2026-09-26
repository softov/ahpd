/**
 * `ahpd start`: the same daemon, let go of.
 *
 * The background one is this program run again with the rest of the line, which
 * is why the child's words are forwarded as they were typed rather than
 * rebuilt from the parsed input: `start` cannot drift from what it starts.
 */

import { output } from '@cofold/commands';
import type { Command, Registry } from '@cofold/commands';
import { start } from '../daemon.js';
import { checkingUpdates, updateLine } from '../update.js';
import { manifest } from '../version.js';
import { optionsFrom, secret, serverFields, stop } from './options.js';

export const declareStart = (registry: Registry<object>): Command => registry.action({
  id: 'daemon.start',
  summary: 'Run it in the background and let go of it',
  description: 'Detached, with its output in the daemon log and a record of where it is listening.',
  surfaces: { cli: { pattern: ['start'] } },
  input: serverFields,
  run: async (context) => {
    const options = optionsFrom(context.input as Readonly<Record<string, unknown>>);
    // A detached process has no pipe to answer on, so it would read an
    // immediate end and exit having served nobody.
    if (options.stdio) stop('--stdio cannot be detached: it serves the process that started it.');
    // Derived here too, so the record the parent writes carries the ready URL
    // and the child is told nothing it did not already know.
    const { token } = secret(options);
    const rest = process.argv.slice(2).slice(1);
    try {
      const begun = await start(rest, process.argv[1] as string, token);
      let text = `ahpd on ${begun.url} (pid ${String(begun.pid)}), sessions in ${begun.paths.join(', ') || process.cwd()}\n`;
      if (begun.automations !== undefined) text += `automations ${begun.automations}\n`;
      if (checkingUpdates(options.updateCheck)) text += updateLine(manifest()) ?? '';
      return output({
        url: begun.url,
        pid: begun.pid,
        paths: begun.paths,
        ...(begun.automations === undefined ? {} : { automations: begun.automations }),
      }, text);
    }
    catch (error) {
      context.error(`Could not start it: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  },
});
