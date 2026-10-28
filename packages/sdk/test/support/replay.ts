/*
 * The chat a client builds, and the calls in it.
 *
 * A client that watched a chat holds the snapshot it subscribed with and every
 * chat action sent after it, applied through the protocol's own reducer. A
 * client that subscribes later reads the host's snapshot instead. The two have
 * to say the same thing, and the calls are where a backend's own record and
 * the actions it sent can part.
 *
 * Not a test file. `vitest` collects `*.test.ts`, and this is imported by the
 * suites that are.
 */

import { chatReducer } from '@microsoft/agent-host-protocol';

type Bag = Record<string, unknown>;

/** What a subscribe answers, as far as a replay needs it. */
export interface Opened {
  state: Bag;
  fromSeq: number;
}

/** The snapshot in a subscribe's answer. */
export const openedFrom = (answer: unknown): Opened => {
  const snapshot = (answer as { snapshot: { state: Bag; fromSeq: number } }).snapshot;
  return { state: snapshot.state, fromSeq: snapshot.fromSeq };
};

/**
 * The chat a client that subscribed with `opened` builds from the notes it was
 * sent: every action on the channel after the snapshot's sequence number, a
 * refused one aside.
 */
export const replayed = (opened: Opened, notes: { method: string; params: unknown }[], channel: string): Bag =>
  notes
    .filter((note) => note.method === 'action')
    .map((note) => note.params as { channel: string; action: Bag; serverSeq: number; rejectionReason?: string })
    .filter((one) => one.channel === channel && one.serverSeq > opened.fromSeq && one.rejectionReason === undefined)
    .reduce<Bag>((state, one) => chatReducer(state as never, one.action as never) as unknown as Bag, opened.state);

/** Every call in a chat's turns, the running one included, in order. */
export const callsIn = (state: Bag): Bag[] => [
  ...((state.turns ?? []) as Bag[]),
  ...(state.activeTurn === undefined ? [] : [state.activeTurn as Bag]),
]
  .flatMap((turn) => (turn.responseParts ?? []) as Bag[])
  .filter((part) => part.kind === 'toolCall')
  .map((part) => part.toolCall as Bag);
