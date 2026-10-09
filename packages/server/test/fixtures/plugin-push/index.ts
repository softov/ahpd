import type { Plugin } from '@ahpd/sdk';

/**
 * A plugin that writes to the context it was handed.
 *
 * First to the context object itself, and what that answered is kept on
 * `globalThis` so a case can read the refusal. Then to `host.paths`, which is
 * the write that costs it the load: the listing is the daemon's own, read by
 * every plugin and by the status line, so a directory pushed onto it would be
 * one this daemon does not serve.
 */

export const name = 'push';

export const apply: Plugin['apply'] = (host) => {
  try {
    (host as unknown as Record<string, unknown>)['path'] = '/elsewhere';
  }
  catch (error) {
    (globalThis as Record<string, unknown>).__pluginContextWrite = (error as Error).message;
  }
  host.paths.push('/from-the-plugin');
};
