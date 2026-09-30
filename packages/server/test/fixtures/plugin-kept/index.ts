import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Listed, Plugin } from '@ahpd/sdk';
import { echo } from '../../../../../examples/echo/agent.ts';

/**
 * The example backend, with a catalogue that outlives its process.
 *
 * `echo` keeps its sessions in memory, so a restarted daemon lists none. This
 * one writes each new session to a file under the daemon's path and lists what
 * the file holds, the way a real backend reads what its harness wrote, so a
 * session made before a restart is one the daemon after it can list.
 */

export const name = 'kept';

export const apply: Plugin['apply'] = (host) => {
  const file = join(host.path, 'kept-sessions.jsonl');
  const base = echo({ path: host.path, pace: 0 });
  host.registerAgent({
    ...base,
    provider: 'kept',
    displayName: 'Kept',
    list: async (): Promise<Listed[]> => {
      let held = '';
      try { held = readFileSync(file, 'utf8'); }
      catch { return []; }
      return held.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as Listed);
    },
    create: (start) => {
      if (start.resume === undefined) {
        const at = new Date().toISOString();
        const row: Listed = {
          id: start.uri.replace(/^ahp-session:\//u, ''),
          title: 'Kept session',
          createdAt: at,
          modifiedAt: at,
          workingDirectories: [`file://${host.path}`],
        };
        appendFileSync(file, `${JSON.stringify(row)}\n`);
      }
      return base.create(start);
    },
  });
};
