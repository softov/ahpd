import type { PluginHost } from '@ahpd/sdk';

/**
 * A fixture whose `apply` drops one of its own items and says so.
 *
 * `problem` is how a plugin says what it left out without leaving out anything
 * else: the line has to reach whoever ran `ahpd start`, before the line that
 * says the daemon is up, and nothing else this plugin contributes is lost.
 */

export const name = 'skips';

export function apply(host: PluginHost): void {
  host.problem('presets.router reads OPENROUTER_API_KEY, which the daemon\'s environment does not have');
}
