import type { Plugin } from '@ahpd/sdk';

/**
 * A plugin whose options may name secrets.
 *
 * `apiKey` is `writeOnly` and declared `type: string`, which is the case a
 * reference has to satisfy: the value that arrives is a string, and the object
 * it was written as is gone. `token` is declared with a pattern, which is the
 * case where the check has to run against the value rather than the name it was
 * written as. `later` is `secretAtUse`, and `every` is one holding a list, so
 * what arrives there is the reference and the references as they were written
 * and the plugin is left to read them.
 *
 * What each arrived as is written to the log rather than kept, because a plugin
 * has nowhere else to put it and a test reads the daemon's log anyway.
 */

export const name = 'secret-ref';

export const optionsSchema = {
  type: 'object',
  properties: {
    apiKey: { type: 'string', writeOnly: true },
    token: { type: 'string', pattern: '^ghp_' },
    later: { type: 'string', secretAtUse: true },
    every: { type: 'array', secretAtUse: true, items: { type: 'string' } },
  },
};

export const apply: Plugin['apply'] = (host, options) => {
  host.log(`arrived apiKey ${JSON.stringify(options['apiKey'])} token ${JSON.stringify(options['token'])}`
    + ` later ${JSON.stringify(options['later'])} every ${JSON.stringify(options['every'])}`);
};