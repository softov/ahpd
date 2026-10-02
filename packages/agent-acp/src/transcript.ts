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
 * What a server replays on `session/load` is watched the same way: the updates
 * are split at each user message into turns that sit ahead of the ones this
 * process watched, so a resumed session opens with the conversation it was
 * resumed for rather than with only what came after.
 *
 * A session this process never watched has no record, and `Agent.transcript`
 * answers `undefined` for it rather than inventing a conversation.
 */

import type { Agent } from '@ahpd/sdk';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { mapUpdate } from './mapping.js';
import type { AcpTurn, WatchedSession, WatchedTurn } from './types.js';

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
 * Each turn starts with no part, exactly as the live one does, and every
 * watched update is replayed into it. The part list a replay builds is the
 * same list the live turn held, because it is the same function building it.
 */
export function turnsOf(session: WatchedSession): TranscriptTurn[] {
  return session.turns.map((watched) => {
    const replay: AcpTurn = {
      turnId: watched.turnId,
      parts: [],
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

/**
 * The turns a `session/load` replayed, in the order the conversation had them.
 *
 * The spec replays a turn as the person's message followed by the updates the
 * agent made for it, so the split is at each message - which is not the same as
 * at each `user_message_chunk`, because a message of any length arrives as
 * several chunks: text, an image, a resource. Consecutive user chunks are one
 * message and one turn, and a chunk starts a new turn only once the open one
 * holds something the agent said.
 *
 * What comes before the first message is kept as a turn of its own with no user
 * text, because a server that replays without a question has still said
 * something and dropping it would lose the start of the conversation.
 *
 * The updates are kept raw and read back through `turnsOf` like any watched
 * turn, so a replayed turn and a live one are the same rendering. ACP carries
 * no turn ids and no times for a replay, so the id is this process's and the
 * time is when the replay was heard.
 */
export function replayedTurns(updates: SessionUpdate[], at: string): WatchedTurn[] {
  const turns: WatchedTurn[] = [];
  let open: WatchedTurn | undefined;
  /** Whether anything the agent said has gone into the turn being built. */
  let answered = false;
  for (const update of updates) {
    const asked = update.sessionUpdate === 'user_message_chunk';
    if (open === undefined || (asked && answered)) {
      open = {
        turnId: crypto.randomUUID(),
        startedAt: at,
        message: { text: '' },
        state: 'complete',
        updates: [],
      };
      turns.push(open);
      answered = false;
    }
    if (asked && update.content.type === 'text') {
      open.message.text = `${open.message.text}${update.content.text}`;
    }
    open.updates.push(update);
    answered = answered || !asked;
  }
  return turns;
}
