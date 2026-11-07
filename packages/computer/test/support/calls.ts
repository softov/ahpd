import type { ToolCall } from '../../../sdk/src/types/host.js';

/**
 * A tool call the host's own turn makes: it may do anything and use every
 * machine, as a call on a host with no users directory may, with whatever
 * else a case gives it, such as the provider of the calling session.
 */
export const hostCall = (more: Record<string, unknown> = {}): ToolCall =>
  ({ person: () => 'host', may: () => true, refusal: (grant: string) => `this turn may not ${grant} here`, ...more }) as unknown as ToolCall;
