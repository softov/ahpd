import type { PluginHost } from '@ahpd/sdk';

/**
 * A fixture whose `apply` throws an error of two lines.
 *
 * A stack, a `console.error` and several `throw`s in one place all produce a
 * message with a newline in it, and the line a start announces a problem as has
 * to stay one line or the reader takes the first and drops the rest.
 */

export const name = 'multiline';

export function apply(_host: PluginHost): void {
  throw new Error('the multiline fixture threw:\n  and this is the second line');
}
