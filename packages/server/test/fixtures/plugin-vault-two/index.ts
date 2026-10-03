import type { Plugin, Vault } from '@ahpd/sdk';

/**
 * A second vault, registered the way a plugin with nothing to say about the port
 * registers one.
 *
 * It answers `host:probe` with a value of its own, so a case can tell which of
 * two plugins a read was answered from: a host that seeded no vault lets the
 * first one through and refuses this one, and what the reader gets is the first
 * plugin's value and not this one. That is the fold's owner rule, and it has to
 * hold for a port the loader tracks itself as well as for one the fold decides.
 */

export const name = 'vault-store-two';

export const optionsSchema = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    replace: { type: 'boolean' },
  },
};

export const apply: Plugin['apply'] = (host, options) => {
  const vault: Vault = {
    get: async (wanted) => (wanted === 'host:probe' ? 'from the second plugin' : undefined),
    set: async () => {},
    delete: async () => false,
    list: async () => ['host:probe'],
  };
  host.registerVault(vault, options['replace'] === true ? 'replace' : undefined);
};