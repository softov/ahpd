/*
 * A real host and more than one client, run against each other with nothing
 * in between.
 *
 * The suites here mostly connect one client and assert on what it was told.
 * That is enough for the answer to a request and not enough for the thing a
 * host is actually for: several clients on one session, told the same story
 * in the same order, with one of them arriving late or leaving in the middle.
 * A defect in that is invisible to a single-client test, because a single
 * client is always consistent with itself.
 *
 * So a scenario here has clients rather than a client. Each holds every action
 * it was sent, and `agrees` replays them onto the snapshot it opened with and
 * compares the result against what a fresh subscribe answers - which is the
 * whole property: a client that agrees has neither missed an action nor
 * applied one twice.
 *
 * The backend is `echo`, deliberately. It is a real `Agent` and `Session` with
 * no model and no subprocess, so a turn is deterministic and finishes in a
 * tick, and what is under test is the host rather than a harness.
 *
 * Not a test file. `vitest` collects `*.test.ts`, and this is imported by the
 * suites that are.
 */

import * as ahp from '@microsoft/agent-host-protocol';
import { createHost } from '../packages/sdk/src/host.js';
import { fileResources } from '../packages/sdk/src/resources.js';
import { echo } from '../examples/echo/agent.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

export const ROOT = 'ahp-root://';

/** One action as it reaches a client, with the sequence the host stamped on it. */
export interface Delivered {
  channel: string;
  action: Record<string, unknown>;
  serverSeq: number;
  origin?: { clientId: string; clientSeq: number };
  rejectionReason?: string;
}

/** A connected client, and everything this host has said to it. */
export interface Client {
  readonly id: string;
  /** Send one request and get the host's answer, as a real client would. */
  handle(request: { method: string; params: Record<string, unknown> }): Promise<unknown>;
  /** Every action delivered to this client, in the order it arrived. */
  delivered(channel?: string): Delivered[];
  /** The snapshot this client opened a channel with, kept for replay. */
  opened(channel: string): Record<string, unknown> | undefined;
  /** Subscribe, remembering the snapshot so `agrees` has a baseline. */
  subscribe(channel: string): Promise<Record<string, unknown>>;
  /** Hang up, the way a socket going does. */
  close(): void;
}

/** A scenario: one host, and the clients connected to it. */
export interface Scenario {
  /** Connect another client. `initial` is its `initialSubscriptions`. */
  join(id: string, initial?: string[]): Promise<Client>;
  /** Let the host's own work - a backend answering a turn - run out. */
  settle(times?: number): Promise<void>;
  /** What a fresh subscribe would answer for a channel, which is host truth. */
  truth(channel: string): Promise<Record<string, unknown>>;
  /**
   * Whether a client's view matches the host's.
   *
   * Its opening snapshot with every action it was since sent applied to it,
   * against what the host answers now. Turn counts rather than deep equality:
   * a snapshot carries fields a reducer never writes, and the conversation is
   * what a disagreement would show up in.
   */
  agrees(client: Client, channel: string): Promise<boolean>;
}

/** How much conversation a chat state holds, counting a running turn. */
export function conversation(state: Record<string, unknown> | undefined): number {
  const turns = (state?.turns as unknown[] | undefined) ?? [];
  return turns.length + (state?.activeTurn === undefined ? 0 : 1);
}

function recorder(id: string): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    name: id,
    send: () => {},
    notify: (method: string, params: unknown) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  } as Peer & { notes: { method: string; params: unknown }[] };
}

/** A host serving `path` with the echo backend, and no clients yet. */
export function scenario(path = '/tmp/ahpd-scenario'): Scenario {
  const host = createHost({
    path,
    agents: [echo({ path, pace: 0 })],
    resources: fileResources(),
  });

  const settle = async (times = 12): Promise<void> => {
    for (let i = 0; i < times; i += 1) await new Promise((resolve) => { setTimeout(resolve, 0); });
  };

  const truth = async (channel: string): Promise<Record<string, unknown>> => {
    /*
     * Asked as a client nobody else is watching.
     *
     * A subscribe on one of the scenario's own clients would be an action in
     * the story it is telling - the host counts subscribers - so host truth is
     * read through a connection that joins, asks and goes.
     */
    const asking = host.accept(recorder('truth'));
    await asking.handle({ method: 'initialize', params: { clientId: 'truth', protocolVersions: ['0.9.0'] } });
    const answer = await asking.handle({ method: 'subscribe', params: { channel } }) as {
      snapshot: { state: Record<string, unknown> };
    };
    await asking.handle({ method: 'unsubscribe', params: { channel } });
    asking.close();
    return answer.snapshot.state;
  };

  const join = async (id: string, initial: string[] = [ROOT]): Promise<Client> => {
    const peer = recorder(id);
    const held = host.accept(peer);
    const snapshots = new Map<string, Record<string, unknown>>();
    await held.handle({
      method: 'initialize',
      params: { clientId: id, protocolVersions: ['0.9.0'], initialSubscriptions: initial },
    });
    const client: Client = {
      id,
      handle: (request) => held.handle(request),
      delivered: (channel) => peer.notes
        .filter((note) => note.method === 'action')
        .map((note) => note.params as Delivered)
        .filter((one) => channel === undefined || one.channel === channel),
      opened: (channel) => snapshots.get(channel),
      subscribe: async (channel) => {
        const answer = await held.handle({ method: 'subscribe', params: { channel } }) as {
          snapshot: { state: Record<string, unknown> };
        };
        snapshots.set(channel, answer.snapshot.state);
        return answer.snapshot.state;
      },
      close: () => { held.close(); },
    };
    return client;
  };

  const agrees = async (client: Client, channel: string): Promise<boolean> => {
    const from = client.opened(channel);
    if (from === undefined) return false;
    const reduce = channel.startsWith('ahp-chat:') ? ahp.chatReducer : ahp.sessionReducer;
    let state = from;
    for (const one of client.delivered(channel)) {
      // A refused action is one the host did *not* apply, so a client that
      // applied it would be the one out of step.
      if (one.rejectionReason !== undefined) continue;
      state = reduce(state as never, one.action as never) as unknown as Record<string, unknown>;
    }
    return conversation(state) === conversation(await truth(channel));
  };

  return { join, settle, truth, agrees };
}
