import type { PluginHost } from '@ahpd/sdk';

/**
 * A fixture that declares no compatibility at all.
 *
 * Absent is not incompatible: a scratch plugin has no `package.json` to
 * declare one in and refusing it would break the form decision
 * `plugin-manifest-is-package-json` keeps as its fallback.
 */

export const name = 'no-peer';

export function apply(host: PluginHost): void {
  host.registerTool({
    definition: {
      name: 'no_peer_tool',
      description: 'From a plugin with no peer range.',
      inputSchema: { type: 'object', properties: {} },
    },
    run: () => 'no peer',
  });
}
