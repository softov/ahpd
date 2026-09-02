import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../examples/echo/agent.js';
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
  return { notes, send: () => {}, notify: (method, params) => notes.push({ method, params }), close: () => {} };
}

const settle = async (times = 12): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

const actions = (p: ReturnType<typeof peer>, channel: string) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; action: Record<string, unknown> })
  .filter((e) => e.channel === channel);

/** A connected client with one echo session, subscribed to nothing yet. */
async function ready(uri: string) {
  const host = createHost({ path: '/tmp/echo', agents: [echo({ path: '/tmp/echo', pace: 0 })] });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.8.0'] },
  });
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  return { client, peer: p, chatUri: uri.replace('ahp-session:/', 'ahp-chat:/') };
}

it('misses nothing dispatched while its snapshot was being taken', async () => {
  const { client, peer: p, chatUri } = await ready('ahp-session:/race');

  // The window itself: the subscribe is in flight - its snapshot taken, its
  // watch not yet joined - when the turn starts. This is the composer's own
  // order, which subscribes and sends without waiting in between.
  const subscribing = client.handle({ method: 'subscribe', params: { channel: chatUri } });
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello there' } } },
  });
  await subscribing;
  await settle();

  const said = actions(p, chatUri).map((e) => e.action.type);
  // The one that matters. Without it the reducer has no active turn, and
  // every delta below is dropped rather than drawn.
  expect(said).toContain('chat/turnStarted');
  expect(said).toContain('chat/delta');
  expect(said).toContain('chat/turnComplete');
});

it('says each of them once', async () => {
  const { client, peer: p, chatUri } = await ready('ahp-session:/once');

  const subscribing = client.handle({ method: 'subscribe', params: { channel: chatUri } });
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello there' } } },
  });
  await subscribing;
  await settle();

  // Replayed *and* broadcast would be the same turn twice, which is the other
  // way to get this wrong and is worse than the first: a transcript that
  // draws everything twice looks like the agent said it twice.
  const started = actions(p, chatUri).filter((e) => e.action.type === 'chat/turnStarted');
  expect(started).toHaveLength(1);
});

it('replays a response part as it was, not as it became', async () => {
  const { client, peer: p, chatUri } = await ready('ahp-session:/value');

  const subscribing = client.handle({ method: 'subscribe', params: { channel: chatUri } });
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello there' } } },
  });
  await subscribing;
  await settle();

  /*
   * A part is announced empty and filled by the deltas after it.
   *
   * Held by reference, an envelope kept for replay is serialised long after
   * it was made: the part arrives already carrying the text of every delta
   * that followed it, and the client applies those deltas as well. The word
   * ends up written twice, and the same corruption reaches any client that
   * reconnects and asks for what it missed.
   */
  const part = actions(p, chatUri).find((e) => e.action.type === 'chat/responsePart');
  const content = (part?.action.part as { content?: string } | undefined)?.content ?? '';
  expect(content).toBe('');

  // The part plus everything appended to it is what the client ends up
  // holding, and it is the sentence once.
  const deltas = actions(p, chatUri)
    .filter((e) => e.action.type === 'chat/delta')
    .map((e) => String(e.action.content ?? ''));
  expect(content + deltas.join('')).toBe('hello there');
});

it('hands back a snapshot that does not move under the client', async () => {
  const { client, chatUri } = await ready('ahp-session:/still');
  const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: unknown[]; activeTurn?: unknown } };
  };
  expect(opened.snapshot.state.turns).toEqual([]);

  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello there' } } },
  });
  await settle();

  // The snapshot is a value taken at its own `fromSeq`, which is the number
  // the client decides what it has already seen by. One that keeps up with
  // the session describes a moment that never existed.
  expect(opened.snapshot.state.turns).toEqual([]);
  expect(opened.snapshot.state.activeTurn).toBeUndefined();
});
