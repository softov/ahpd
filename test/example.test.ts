import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../examples/echo/agent.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * The example, driven as a client drives it.
 *
 * No SDK is mocked here and nothing is spawned: `echo` is a backend written
 * from nothing, so what this checks is that `Agent` is sufficient - that a
 * host given one it has never heard of serves a whole conversation without
 * any part of it reaching for Claude.
 *
 * It is also what keeps the example honest. An example that stopped compiling
 * against the contract it documents would be worse than none.
 */

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    close: () => {},
  };
}

const settle = async (times = 6): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** A connected client with one echo session, watching both its channels. */
async function talking() {
  const host = createHost({ path: '/tmp/echo', agents: [echo({ path: '/tmp/echo', pace: 0 })] });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/one';
  const chatUri = 'ahp-chat:/one';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return { host, client, peer: p, uri, chatUri };
}

const actions = (p: ReturnType<typeof peer>, channel: string) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; action: Record<string, unknown> })
  .filter((e) => e.channel === channel);

it('advertises the backend it was given, and no other', async () => {
  const host = createHost({ path: '/tmp/echo', agents: [echo({ path: '/tmp/echo' })] });
  const client = host.accept(peer());
  const result = await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
  }) as { snapshots: { state: { agents: { provider: string }[] } }[] };
  expect(result.snapshots[0]?.state.agents.map((a) => a.provider)).toEqual(['echo']);
});

it('refuses a provider nobody registered', async () => {
  const host = createHost({ path: '/tmp/echo', agents: [echo({ path: '/tmp/echo' })] });
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'p', protocolVersions: ['0.8.0'] } });
  await expect(client.handle({
    method: 'createSession',
    params: { channel: 'ahp-session:/x', provider: 'claude' },
  })).rejects.toMatchObject({ code: -32002 });
});

it('offers the backend\'s own settings, and not another\'s', async () => {
  const host = createHost({ path: '/tmp/echo', agents: [echo({ path: '/tmp/echo' })] });
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'p', protocolVersions: ['0.8.0'] } });
  const config = await client.handle({
    method: 'resolveSessionConfig',
    params: { channel: 'ahp-root://', provider: 'echo' },
  }) as { schema: { properties: Record<string, unknown> }; values: Record<string, string> };
  // Claude's permission mode and effort are Claude's. A host that offered
  // them here would be offering controls this backend has never heard of.
  expect(Object.keys(config.schema.properties)).toEqual(['voice']);
  expect(config.values).toEqual({ voice: 'plain' });
});

it('carries a turn from the client to the backend and back', async () => {
  const { client, peer: p, chatUri } = await talking();
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello there' } } },
  });
  await settle(12);

  const said = actions(p, chatUri).map((e) => e.action.type);
  // The order every backend has to keep: the turn is said back, a part is
  // opened, and only then does text stream into it. Their order relative to
  // each other, not their position - a backend may say other things in
  // between, and this one says what it is doing.
  const ordering = said.filter((type) => type === 'chat/turnStarted'
    || type === 'chat/responsePart'
    || type === 'chat/delta');
  expect(ordering.slice(0, 3)).toEqual(['chat/turnStarted', 'chat/responsePart', 'chat/delta']);
  expect(said).toContain('chat/turnComplete');

  const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { responseParts: { content: string }[] }[] } };
  };
  expect(opened.snapshot.state.turns[0]?.responseParts[0]?.content).toBe('hello there');
});

it('says it back in the voice the session was created with', async () => {
  const host = createHost({ path: '/tmp/echo', agents: [echo({ path: '/tmp/echo', pace: 0 })] });
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'p', protocolVersions: ['0.8.0'] } });
  await client.handle({
    method: 'createSession',
    params: { channel: 'ahp-session:/two', provider: 'echo', config: { voice: 'shouty' } },
  });
  client.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-chat:/two', action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello' } } },
  });
  await settle(12);
  const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/two' } }) as {
    snapshot: { state: { turns: { responseParts: { content: string }[] }[] } };
  };
  expect(opened.snapshot.state.turns[0]?.responseParts[0]?.content).toBe('HELLO');
});

it('leaves a finished session in the catalogue, and opens it again from its transcript', async () => {
  const { client, uri } = await talking();
  client.handle({
    method: 'dispatchAction',
    params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'remember me' } } },
  });
  await settle(12);
  await client.handle({ method: 'disposeSession', params: { channel: uri } });

  const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: { resource: string; provider: string; title: string }[];
  };
  expect(listed.items).toHaveLength(1);
  expect(listed.items[0]).toMatchObject({ provider: 'echo', title: 'remember me' });

  // Opened from its transcript, with nothing started: this is what makes a
  // catalogue row a row somebody can read.
  const again = await client.handle({
    method: 'subscribe',
    params: { channel: `ahp-chat:/${listed.items[0]?.resource.replace('ahp-session:/', '') ?? ''}` },
  }) as { snapshot: { state: { turns: unknown[] } } };
  expect(again.snapshot.state.turns).toHaveLength(1);
});

it('will not take two backends that call themselves the same thing', () => {
  expect(() => createHost({
    path: '/tmp/echo',
    agents: [echo({ path: '/tmp/echo' }), echo({ path: '/tmp/other' })],
  })).toThrow(/echo/);
});
