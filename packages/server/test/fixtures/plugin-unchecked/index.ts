import type { PluginHost } from '@ahpd/sdk';

/*
 * A plugin that declares no schema for its options, so whatever the
 * configuration says reaches `apply` as it was written.
 */

export const name = 'unchecked';

export function apply(_host: PluginHost, options: Record<string, unknown>): void {
  (globalThis as Record<string, unknown>).__pluginUncheckedApplied = options;
}
