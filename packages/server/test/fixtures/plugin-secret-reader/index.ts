import type { Plugin } from '@ahpd/sdk';

/**
 * A plugin that reads one secret at use time.
 *
 * The name it reads is `host:probe`, which is the one both stores the daemon
 * builds and the one a plugin takes over hold, so a line saying which value came
 * back is a line saying which vault was read.
 *
 * The read is at use time rather than in an option because that is what
 * `host.secret` is for: a plugin that took a reference is told where the value
 * is and asks for it when it needs it.
 */

export const name = 'secret-reader';

export const apply: Plugin['apply'] = async (host) => {
  host.log(`secret probe ${await host.secret('host:probe')}`);
};