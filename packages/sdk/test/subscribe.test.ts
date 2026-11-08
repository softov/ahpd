import { expect, it } from 'vitest';
import { chatReducer } from '@microsoft/agent-host-protocol';
import { createHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * Subscribing while something is happening.
 *
 * `subscribe` takes a snapshot and then adds the channel to the connection's
 * watch list, and taking the snapshot is asynchronous - so between the two
 * this connection is a client the host does not know is listening. Anything
 * dispatched in that window went to nobody and is in no snapshot taken before
 * it happened.
 *
 * It is a narrow window and it is wide enough. Opening a session from a
 * composer subscribes and sends in the same breath, so the turn the client's
 * own message starts is the turn it misses the beginning of - and a client
 * that missed `chat/turnStarted` drops every delta that follows, because each
 * one names a turn its reducer was never told about. The session draws an
 * empty transcript until it is closed and opened again, and nothing anywhere
 * reports an error.
 */

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return { notes, send: () => {}, notify: (method, params) => notes.push({ method, params }), request: async () => ({}), answered: () => {}, close: () => {} };
}

const settle = async (times = 12): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

const actions = (p: ReturnType<typeof peer>, channel: string) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; action: Record<string, unknown>; serverSeq: number })
  .filter((e) => e.channel === channel);

/** A chat's snapshot, as a subscribe answers it. */
type Snapshot = { state: Record<string, unknown>; fromSeq: number };

/** Wait for the chat's turn to be said ended, the echo answering a word at a time. */
const ended = async (p: ReturnType<typeof peer>, channel: string): Promise<void> => {
  for (let tries = 0; tries < 400; tries++) {
    if (actions(p, channel).some((e) => e.action.type === 'chat/turnComplete')) return;
    await new Promise((r) => { setTimeout(r, 5); });
  }
  throw new Error(`${channel} said no turn's end`);
};

/**
 * What the client holds of a chat: the snapshot it was answered with, and every
 * action after it that it was told of, through the protocol's own reducer.
 * Whether the snapshot was taken before the turn, during it or after it, this
 * is the turn whole and once.
 */
const held = (p: ReturnType<typeof peer>, channel: string, snapshot: Snapshot) => actions(p, channel)
  .filter((e) => e.serverSeq > snapshot.fromSeq)
  .reduce((state, e) => chatReducer(state as never, e.action as never) as unknown as Record<string, unknown>, snapshot.state);

/** The text of each turn a chat holds, by its id. */
const textOf = (state: Record<string, unknown>) => ((state.turns ?? []) as { id: string; responseParts: { kind: string; content?: string }[] }[])
  .map((turn) => [turn.id, turn.responseParts.filter((part) => part.kind === 'markdown').map((part) => part.content ?? '').join('')]);

/** A connected client with one echo session, subscribed to nothing yet. */
async function ready(uri: string) {
  const host = createHost({ path: '/tmp/echo', agents: [echo({ path: '/tmp/echo', pace: 20 })] });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'] },
  });
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  // The chat the host minted for the session, read off its state.
  const chatUri = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
  return { client, peer: p, chatUri };
}

it('misses nothing dispatched while its snapshot was being taken', async () => {
  const { client, peer: p, chatUri } = await ready('ahp-session:/race');

  // The window itself: the subscribe is in flight - its snapshot taken, its
  // watch not yet joined - when the turn starts. This is the composer's own
  // order, which subscribes and sends without waiting in between.
  const subscribing = client.handle({ method: 'subscribe', params: { channel: chatUri } }) as Promise<{ snapshot: Snapshot }>;
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello there' } } },
  });
  const { snapshot } = await subscribing;
  await ended(p, chatUri);

  // The one that matters: the turn the client's own message started, run to
  // its end, in what the client holds. Without its start the reducer has no
  // active turn, and every delta after it is dropped rather than drawn.
  const view = held(p, chatUri, snapshot);
  expect(textOf(view)).toEqual([['t1', 'hello there']]);
  expect(view.activeTurn ?? undefined).toBeUndefined();
});

it('says each of them once', async () => {
  const { client, peer: p, chatUri } = await ready('ahp-session:/once');

  const subscribing = client.handle({ method: 'subscribe', params: { channel: chatUri } }) as Promise<{ snapshot: Snapshot }>;
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello there' } } },
  });
  const { snapshot } = await subscribing;
  await ended(p, chatUri);

  // Replayed *and* broadcast would be the same turn twice, which is the other
  // way to get this wrong and is worse than the first: a transcript that
  // draws everything twice looks like the agent said it twice. The start is
  // in the snapshot or said after it, and not in both.
  const inSnapshot = ((snapshot.state.turns ?? []) as { id: string }[]).some((turn) => turn.id === 't1')
    || (snapshot.state.activeTurn as { id?: string } | undefined)?.id === 't1';
  const started = actions(p, chatUri).filter((e) => e.serverSeq > snapshot.fromSeq && e.action.type === 'chat/turnStarted');
  expect(started.length + (inSnapshot ? 1 : 0)).toBe(1);
  expect(textOf(held(p, chatUri, snapshot))).toEqual([['t1', 'hello there']]);
});

it('replays a response part as it was, not as it became', async () => {
  const { client, peer: p, chatUri } = await ready('ahp-session:/value');

  const subscribing = client.handle({ method: 'subscribe', params: { channel: chatUri } });
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello there' } } },
  });
  const { snapshot } = await subscribing as { snapshot: Snapshot };
  await ended(p, chatUri);

  /*
   * A part is announced empty and filled by the deltas after it.
   *
   * Held by reference, an envelope kept for replay is serialised long after
   * it was made: the part arrives already carrying the text of every delta
   * that followed it, and the client applies those deltas as well. The word
   * ends up written twice, and the same corruption reaches any client that
   * reconnects and asks for what it missed. A part said after the snapshot is
   * said as it was made.
   */
  const part = actions(p, chatUri).find((e) => e.serverSeq > snapshot.fromSeq && e.action.type === 'chat/responsePart');
  if (part !== undefined) expect((part.action.part as { content?: string } | undefined)?.content ?? '').toBe('');

  // The part plus everything appended to it is what the client ends up
  // holding, and it is the sentence once.
  expect(textOf(held(p, chatUri, snapshot))).toEqual([['t1', 'hello there']]);
});

it('hands back a snapshot that does not move under the client', async () => {
  const { client, chatUri } = await ready('ahp-session:/still');
  const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: unknown[]; activeTurn?: unknown } };
  };
  expect(opened.snapshot.state.turns).toEqual([]);

  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello there' } } },
  });
  await settle();

  // The snapshot is a value taken at its own `fromSeq`, which is the number
  // the client decides what it has already seen by. One that keeps up with
  // the session describes a moment that never existed.
  expect(opened.snapshot.state.turns).toEqual([]);
  expect(opened.snapshot.state.activeTurn).toBeUndefined();
});
