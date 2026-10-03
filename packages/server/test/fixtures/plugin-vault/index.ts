import type { Plugin, Vault } from '@ahpd/sdk';

/**
 * A vault, contributed the way a secret manager would be.
 *
 * In memory, so it holds nothing on disk and takes over whatever the daemon
 * built. Whether it asks to take it over is an option, because the two are the
 * same plugin seen from the fold's rule: one is refused a port the daemon
 * already set, the other takes it.
 *
 * The name it holds is `host:probe` and the value is fixed, because what a test
 * checks is which store a read was answered from and a real secret manager is
 * not what this stands in for. `key` is declared and never read, so a case can
 * put a reference in this plugin's own options and be refused for it.
 */

export const name = 'vault-store';

export const optionsSchema = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    replace: { type: 'boolean' },
  },
};

export const apply: Plugin['apply'] = (host, options) => {
  const vault: Vault = {
    get: async (wanted) => (wanted === 'host:probe' ? 'from the plugin' : undefined),
    set: async () => {},
    delete: async () => false,
    list: async () => ['host:probe'],
  };
  host.registerVault(vault, options['replace'] === true ? 'replace' : undefined);
};