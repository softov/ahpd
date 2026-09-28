import type { Plugin } from '@ahpd/sdk';
import { echo } from '../../../../../examples/echo/agent.ts';

/**
 * A plugin that writes the paths it was handed to the daemon's log.
 *
 * It registers the example backend so the daemon starts, and logs `host.paths`
 * as one JSON line a test reads back from stderr.
 */

export const name = 'paths-plugin';

export const apply: Plugin['apply'] = (host) => {
  host.log(`plugin paths ${JSON.stringify(host.paths)}`);
  host.registerAgent(echo({ path: host.path, pace: 0 }));
};
