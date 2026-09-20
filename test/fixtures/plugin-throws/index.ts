import type { PluginHost } from '@ahpd/sdk';

/**
 * A fixture whose `apply` throws.
 *
 * A plugin is code in the daemon's process, so a throw out of `apply` is the
 * ordinary way one misbehaves; the loader has to report the message and keep
 * going rather than reject.
 */

export const name = 'throws';

export function apply(_host: PluginHost): void {
  throw new Error('the throws fixture threw on purpose');
}
