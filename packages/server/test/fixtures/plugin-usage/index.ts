import type { Plugin, Usage } from '@ahpd/sdk';

/**
 * A usage store, contributed the way a store that is not this machine's file
 * would be.
 *
 * In memory, so it holds nothing on disk and takes over whatever the daemon
 * built. Whether it asks to take it over is an option, because the two are the
 * same plugin seen from the fold's rule: one is refused a port the daemon
 * already set, the other takes it.
 *
 * The totals are a fixed one call rather than a real sum, because nothing
 * records to this store yet and a test that made it sum would be testing the
 * store this fixture is standing in for.
 */

export const name = 'usage-store';

export const apply: Plugin['apply'] = (host, options) => {
  const usage: Usage = {
    record: async () => {},
    total: async () => ({ calls: 1 }),
    pools: async () => ['the fixture'],
    records: async () => [],
    groups: async () => [],
  };
  host.registerUsage(usage, options['replace'] === true ? 'replace' : undefined);
};
