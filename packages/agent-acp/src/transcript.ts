/**
 * The updates this bridge watched, rebuilt as the turns a client reads.
 *
 * ACP has no stored transcript to read: `loadSession` replays notifications
 * rather than returning turns, so the only record of a session this process
 * saw is the one it kept as it went. What is kept is the raw `session/update`
 * stream per turn; what a client wants is `WireTurn`s. This file is the
 * translation between them, and it runs the same `mapUpdate` the live session
 * runs, so a rebuilt turn cannot drift from the one that was streamed.
 *
 * A session this process never watched has no record, and `Agent.transcript`
 * answers `undefined` for it rather than inventing a conversation.
 */

import type { Agent } from '@ahpd/sdk';
import { mapUpdate } from './mapping.js';
import type { AcpTurn, WatchedSession } from './types.js';

/**
 * The turns `Agent.transcript` answers with.
 *
 * Named by query rather than imported from the protocol package: an agent
 * backend states its protocol shapes through `@ahpd/sdk`, and taking a second
 * dependency to repeat the same type would be a boundary this package does not
 * declare.
 */
type Transcript = NonNullable<Awaited<ReturnType<NonNullable<Agent['transcript']>>>>;
export type TranscriptTurn = Transcript[number];

/**
 * One watched session's turns, in the order they ran.
 *
 * Each turn starts from the markdown part the session opens before a prompt,
 * exactly as the live mapping does, and every watched update is replayed into
 * it. The part list a replay builds is the same list the live turn held,
 * because it is the same function building it.
 */
export function turnsOf(session: WatchedSession): TranscriptTurn[] {
  return session.turns.map((watched) => {
    const replay: AcpTurn = {
      turnId: watched.turnId,
      textPartId: `${watched.turnId}:text`,
      parts: [{ id: `${watched.turnId}:text`, kind: 'markdown', content: '' }],
      calls: new Map(),
    };
    for (const update of watched.updates) mapUpdate(replay, update);
    return {
      id: watched.turnId,
      startedAt: watched.startedAt,
      /*
       * A turn this bridge began is the person's unless somebody said
       * otherwise, and the transcript states that rather than leaving the
       * origin off: the protocol requires one, and the live snapshot's
       * omission is a `Bag` that a typed read cannot carry.
       */
      message: {
        text: watched.message.text,
        origin: watched.message.origin ?? { kind: 'user' },
      },
      responseParts: replay.parts,
      usage: undefined,
      state: watched.state,
      ...(watched.duration === undefined ? {} : { duration: watched.duration }),
    };
  });
}
