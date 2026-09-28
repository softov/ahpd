/**
 * A session's turns as the turns a client reads.
 *
 * Two records give them, sealed the same way: the one kept as this process
 * watched each turn run, the same parts array the live turn streamed into,
 * and the one `replay.ts` rebuilds from pi's own file for a session this
 * process did not watch, through the same `mapEvent`.
 */

import type { Agent } from '@ahpd/sdk';
import type { WatchedSession } from './types.js';

/**
 * The turns `Agent.transcript` answers with.
 *
 * Named by query rather than imported from the protocol package: a backend
 * states its protocol shapes through `@ahpd/sdk`, and a second dependency to
 * repeat the same type would be a boundary this package does not declare.
 */
type Transcript = NonNullable<Awaited<ReturnType<NonNullable<Agent['transcript']>>>>;
export type TranscriptTurn = Transcript[number];

/** One session's watched or rebuilt turns, in the order they ran. */
export function turnsOf(session: Pick<WatchedSession, 'turns'>): TranscriptTurn[] {
  return session.turns.map((watched) => ({
    id: watched.turnId,
    startedAt: watched.startedAt,
    /*
     * A turn this bridge began is the person's unless somebody said otherwise,
     * and the transcript states that rather than leaving the origin off: the
     * protocol requires one, and the live snapshot's omission is a `Bag` that
     * a typed read cannot carry.
     */
    message: {
      text: String(watched.message.text ?? ''),
      origin: watched.message.origin ?? { kind: 'user' },
    },
    responseParts: watched.parts,
    usage: watched.usage,
    state: watched.state,
    ...(watched.duration === undefined ? {} : { duration: watched.duration }),
  })) as TranscriptTurn[];
}
