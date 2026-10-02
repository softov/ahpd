import type { Agent, PluginHost } from '@ahpd/sdk';

/**
 * A fixture whose backend is named by its own `provider` option.
 *
 * The same module loaded twice is two backends on one host, which only works
 * when each entry says which provider it is - decision
 * `a-repeated-plugin-is-keyed-by-its-provider`. `hello` cannot do that: its
 * provider is written into the agent, not read from the options.
 */

export const name = 'provider-plugin';

export const optionsSchema = {
  type: 'object',
  properties: { provider: { type: 'string', description: 'The provider this entry registers under.' } },
};

export function apply(host: PluginHost, options: Record<string, unknown>): void {
  const said = options['provider'];
  const provider = typeof said === 'string' && said !== '' ? said : 'unset';
  const backend: Agent = {
    provider,
    displayName: provider,
    schema: () => ({ type: 'object', properties: {} }),
    defaults: () => ({}),
    create: () => { throw new Error('the provider fixture starts no session'); },
  };
  host.registerAgent(backend);
}