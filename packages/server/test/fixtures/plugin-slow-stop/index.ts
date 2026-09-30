import { existsSync } from 'node:fs';
import type { Plugin } from '@ahpd/sdk';

/**
 * A plugin whose `stopping` handler holds the daemon until the file
 * `AHPD_RELEASE` names exists, or thirty seconds have passed.
 *
 * A test asks for a restart, waits for the receipt, runs `ahpd stop`, and only
 * then writes the file, so the stop always lands while the restart is stopping.
 */

export const name = 'slow-stop';

export const apply: Plugin['apply'] = (host) => {
  host.on('stopping', () => new Promise<void>((done) => {
    const release = process.env.AHPD_RELEASE;
    const until = Date.now() + 30_000;
    const look = (): void => {
      if (release === undefined || existsSync(release) || Date.now() > until) { done(); return; }
      setTimeout(look, 25);
    };
    look();
  }));
};
