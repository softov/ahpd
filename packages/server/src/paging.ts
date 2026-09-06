import type { Bag } from './types/common.js';
import type { Page } from './types/paging.js';

/**
 * A long list of turns, served a page at a time.
 *
 * Nothing here knows what a turn is beyond it being one of many, which is why
 * it is not in `transcript.ts`: reading a transcript is the backend's, because
 * only the thing that ran the session knows the shape its frames are in.
 * Paging is the host's, and it is the same paging whichever backend produced
 * them.
 */

/**
 * How many turns a snapshot carries.
 *
 * A session in this directory has eight hundred and fifty turns. Sending them
 * all works and will not keep working: a snapshot is what a client waits for
 * before it can draw anything, and the oldest turns are the ones nobody is
 * looking at.
 */
export const PAGE = 50;

/**
 * The newest page, and where the rest begins.
 *
 * The cursor is the index of the oldest turn served - opaque to a client, and
 * deliberately so, but it has to mean something here or `fetchTurns` cannot
 * answer twice in a row.
 */
export function tail(turns: Bag[], size = PAGE): Page {
  const start = Math.max(0, turns.length - size);
  return {
    turns: turns.slice(start),
    ...(start > 0 ? { turnsNextCursor: String(start) } : {}),
  };
}

/**
 * The page before a cursor, or nothing when the cursor is not one of ours.
 *
 * The protocol requires an unrecognised cursor to be rejected rather than
 * guessed at: a host that quietly returned its newest page for a cursor it
 * did not issue would answer a question about old turns with new ones, and
 * the client would page forever without noticing.
 */
export function older(turns: Bag[], cursor: string, size = PAGE): Page | undefined {
  if (!/^\d+$/.test(cursor)) return undefined;
  const at = Number(cursor);
  if (at <= 0 || at > turns.length) return undefined;
  const start = Math.max(0, at - size);
  return {
    turns: turns.slice(start, at),
    ...(start > 0 ? { turnsNextCursor: String(start) } : {}),
  };
}
