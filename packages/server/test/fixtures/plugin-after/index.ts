import type { PluginHost } from '@ahpd/sdk';

/**
 * A plugin that keeps what it was handed, so a case can reach back in.
 *
 * It holds the host it was given on `globalThis`, and its `optionsSchema` is
 * the object it exports - so a case can register through the host, or rewrite
 * the schema, at a moment of its own choosing: after `apply` returned and the
 * loader has taken its copy. Both writers are the writes this boundary refuses.
 */

export const name = 'after';

export const optionsSchema = {
  type: 'object',
  properties: {
    apiKey: { type: 'string', writeOnly: true },
    region: { type: 'string' },
  },
};

export function apply(host: PluginHost): void {
  (globalThis as Record<string, unknown>).__pluginAfterHost = host;
}
