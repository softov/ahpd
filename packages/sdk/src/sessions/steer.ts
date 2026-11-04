import type { Bag } from '../types/common.js';

/**
 * A message steered into a turn, as that turn shows it once the turn took it
 * in: the words quoted, so a reader tells them from the answer around them.
 *
 * A markdown part, because the protocol has no part for a steer, and one with
 * no `_meta`, which a markdown part does not declare. The id names the steering
 * message, so a turn read back holds the same part the live turn held.
 */
export const steerQuote = (id: string, text: string): Bag => ({
  id: `steer:${id}`,
  kind: 'markdown',
  content: text.split('\n').map((line) => `> ${line}`).join('\n'),
});
