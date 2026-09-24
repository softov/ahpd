/**
 * What this process watched of a session, as the turns a client reads.
 *
 * pi does keep a transcript of its own - an append-only tree of entries, on
 * disk, which is what makes a session resumable at all - but those entries are
 * pi's messages and not AHP turns, and rebuilding one from the other would be
 * a second mapping to keep in step with `mapping.ts`.
 *
 * So the record here is the one kept as the turn ran: the same parts array the
 * live turn streamed into, sealed when the turn ended. A session this process
 * never watched has no record, and `Agent.transcript` answers `undefined` for
 * it rather than inventing a conversation - which is the honest answer for a
 * row that came off disk and has never been opened.
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

/** One watched session's turns, in the order they ran. */
export function turnsOf(session: WatchedSession): TranscriptTurn[] {
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
    usage: undefined,
    state: watched.state,
    ...(watched.duration === undefined ? {} : { duration: watched.duration }),
  })) as TranscriptTurn[];
}
