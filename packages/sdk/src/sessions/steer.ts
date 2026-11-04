import type { Bag } from '../types/common.js';

/** The `_meta` key that names the steering message a steer part shows. */
const STEER = 'ahpd.steer';

/**
 * A message steered into a turn, as that turn shows it once the turn took it
 * in: a harness notice with the message text, because the protocol has no
 * part for a person's words inside a turn.
 *
 * A `systemNotification` part has no id, so `_meta` names the steering
 * message, and a turn read back finds the part the live turn held.
 */
export const steerPart = (id: string, text: string): Bag => ({
  kind: 'systemNotification',
  content: text,
  _meta: { [STEER]: id },
});

/** The steering message a part shows, or `undefined` for any other part. */
export const steerOf = (part: Bag): string | undefined => {
  const meta = part['_meta'];
  if (part['kind'] !== 'systemNotification' || typeof meta !== 'object' || meta === null) return undefined;
  const id = (meta as Bag)[STEER];
  return typeof id === 'string' ? id : undefined;
};
