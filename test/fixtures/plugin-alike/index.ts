import type { Agent, PluginHost } from '@ahpd/sdk';

/**
 * A second good plugin, contributing a backend under the name `hello`.
 *
 * Two plugins that call themselves the same provider is a daemon that answers
 * the wrong one, so the fold has to report it and name both; a fixture that
 * was not a working plugin would leave that ambiguous.
 */

export const name = 'alike';

const backend: Agent = {
  provider: 'hello',
  displayName: 'Hello again',
  schema: () => ({ type: 'object', properties: {} }),
  defaults: () => ({}),
  create: () => { throw new Error('the alike fixture starts no session'); },
};

export function apply(host: PluginHost): void {
  host.registerAgent(backend);
}
