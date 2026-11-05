/**
 * A session's turns as the turns a client reads.
 *
 * Two records give them, sealed the same way: the one kept as this process
 * watched each turn run, the same parts array the live turn streamed into,
 * and the one `replay.ts` rebuilds from pi's own file for a session this
 * process did not watch, through the same `mapEvent`.
 */

import type { Agent } from '@ahpd/sdk';
import { INTERRUPTED } from './types.js';
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

/**
 * One session's watched or rebuilt turns, in the order they ran.
 *
 * A turn with no ending is one still running when the record is read, and it
 * reads back interrupted, as pi's own file reads such a turn back: in error,
 * after its parts, VS Code's resumable `executionInterrupted`.
 */
export function turnsOf(session: Pick<WatchedSession, 'turns'>): TranscriptTurn[] {
  return session.turns.map((turn) => ({
    id: turn.turnId,
    startedAt: turn.startedAt,
    /*
     * The message as the turn had it, its attachments and model included. A
     * turn this bridge began is the person's unless somebody said otherwise,
     * and the transcript states that: the protocol requires an origin, and a
     * typed read cannot carry a `Bag` that has none.
     */
    message: {
      ...turn.message,
      text: String(turn.message.text ?? ''),
      origin: turn.message.origin ?? { kind: 'user' },
    },
    responseParts: turn.state === undefined
      ? [...turn.parts, { kind: 'error', error: { ...INTERRUPTED }, resumable: true }]
      : turn.parts,
    usage: turn.usage,
    state: turn.state ?? 'error',
    ...(turn.duration === undefined ? {} : { duration: turn.duration }),
  })) as TranscriptTurn[];
}
