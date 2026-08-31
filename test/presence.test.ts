import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../examples/echo/agent.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * Who else is in this session.
 *
 * The case this daemon exists for and the one it could not answer: several
 * clients drive the same session and none of them could see the others.
 * Membership is the host's to keep - a client announces itself and the host
 * takes it out again - so what is checked here is the taking out, which is
 * where the protocol names three separate ways it happens.
 */

const DIR = '/tmp/presence';

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return { notes, send: () => {}, notify: (method, params) => notes.push({ method, params }), close: () => {} };
}

const host = () => createHost({ path: DIR, agents: [echo({ path: DIR, pace: 0 })] });

/** A connected client, named, watching nothing yet. */
async function joins(held: ReturnType<typeof host>, clientId: string) {
  const p = peer();
  const client = held.accept(p);
  await client.handle({ method: 'initialize', params: { clientId, protocolVersions: ['0.9.0'] } });
  return { client, peer: p };
}

const actions = (p: ReturnType<typeof peer>, channel: string) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; action: Record<string, unknown> })
  .filter((n) => n.channel === channel)
  .map((n) => n.action);

const clientsIn = async (client: { handle(r: { method: string; params: Record<string, unknown> }): Promise<unknown> }, uri: string) => {
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { activeClients: { clientId: string }[] } };
  };
  return opened.snapshot.state.activeClients.map((one) => one.clientId).sort();
};

const URI = 'ahp-session:/shared';

it('is an empty list before anybody says otherwise, because the field is required', async () => {
  const held = host();
  const { client } = await joins(held, 'one');
  await client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  // Not absent. `activeClients` is required in `SessionState`, and a session
  // nobody has opened having nobody in it is a real answer.
  expect(await clientsIn(client, URI)).toEqual([]);
});

it('shows one client to another, which is the whole reason a host keeps it', async () => {
  const held = host();
  const a = await joins(held, 'one');
  const b = await joins(held, 'two');
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await a.client.handle({ method: 'subscribe', params: { channel: URI } });
  await b.client.handle({ method: 'subscribe', params: { channel: URI } });

  b.client.handle({
    method: 'dispatchAction',
    params: {
      channel: URI,
      action: {
        type: 'session/activeClientSet',
        activeClient: { clientId: 'two', displayName: 'VS Code', tools: [{ name: 'openFile' }] },
      },
    },
  });

  // The other client hears about it, which is not something the two of them
  // could have told each other.
  const said = actions(a.peer, URI).filter((one) => one.type === 'session/activeClientSet');
  expect(said).toHaveLength(1);
  expect(said[0]?.activeClient).toMatchObject({ clientId: 'two', displayName: 'VS Code' });
  expect(await clientsIn(a.client, URI)).toEqual(['two']);
});

it('takes the client id from the connection, not from the action', async () => {
  const held = host();
  const a = await joins(held, 'honest');
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await a.client.handle({ method: 'subscribe', params: { channel: URI } });
  a.client.handle({
    method: 'dispatchAction',
    params: {
      channel: URI,
      // A client naming somebody else is a client announcing a presence that
      // is not theirs.
      action: { type: 'session/activeClientSet', activeClient: { clientId: 'somebody-else', tools: [] } },
    },
  });
  expect(await clientsIn(a.client, URI)).toEqual(['honest']);
});

it('replaces what a client contributes rather than merging it', async () => {
  const held = host();
  const a = await joins(held, 'one');
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await a.client.handle({ method: 'subscribe', params: { channel: URI } });
  const announce = (tools: { name: string }[]) => a.client.handle({
    method: 'dispatchAction',
    params: { channel: URI, action: { type: 'session/activeClientSet', activeClient: { clientId: 'one', tools } } },
  });
  await announce([{ name: 'a' }, { name: 'b' }]);
  await announce([{ name: 'a' }]);
  const opened = await a.client.handle({ method: 'subscribe', params: { channel: URI } }) as {
    snapshot: { state: { activeClients: { tools: unknown[] }[] } };
  };
  // Re-announcing is how a client refreshes what it offers, so a tool taken
  // away has to be able to go.
  expect(opened.snapshot.state.activeClients[0]?.tools).toEqual([{ name: 'a' }]);
});

it('takes a client out on unsubscribe, on disconnect, and on a reconnect that drops it', async () => {
  const held = host();
  const a = await joins(held, 'watcher');
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await a.client.handle({ method: 'subscribe', params: { channel: URI } });

  const enter = async (client: { handle(r: { method: string; params: Record<string, unknown> }): Promise<unknown> }, id: string) => {
    await client.handle({ method: 'subscribe', params: { channel: URI } });
    await client.handle({
      method: 'dispatchAction',
      params: { channel: URI, action: { type: 'session/activeClientSet', activeClient: { clientId: id, tools: [] } } },
    });
  };

  // One: unsubscribing.
  const b = await joins(held, 'leaver');
  await enter(b.client, 'leaver');
  expect(await clientsIn(a.client, URI)).toEqual(['leaver']);
  b.client.handle({ method: 'unsubscribe', params: { channel: URI } });
  expect(await clientsIn(a.client, URI)).toEqual([]);
  expect(actions(a.peer, URI).filter((one) => one.type === 'session/activeClientRemoved'))
    .toMatchObject([{ clientId: 'leaver' }]);

  // Two: going away without saying anything.
  const c = await joins(held, 'dropper');
  await enter(c.client, 'dropper');
  expect(await clientsIn(a.client, URI)).toEqual(['dropper']);
  c.client.close();
  expect(await clientsIn(a.client, URI)).toEqual([]);

  // Three: coming back and not asking for it again.
  const d = await joins(held, 'forgetful');
  await enter(d.client, 'forgetful');
  expect(await clientsIn(a.client, URI)).toEqual(['forgetful']);
  await d.client.handle({
    method: 'reconnect',
    params: { clientId: 'forgetful', subscriptions: [], lastSeenServerSeq: 0 },
  });
  expect(await clientsIn(a.client, URI)).toEqual([]);
});

it('keeps a client in while another window of theirs is still watching', async () => {
  const held = host();
  const a = await joins(held, 'watcher');
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await a.client.handle({ method: 'subscribe', params: { channel: URI } });

  // One person, two windows, one client id. Closing the first must not take
  // them out of the session the second is still in.
  const first = await joins(held, 'twice');
  const second = await joins(held, 'twice');
  await first.client.handle({ method: 'subscribe', params: { channel: URI } });
  await second.client.handle({ method: 'subscribe', params: { channel: URI } });
  first.client.handle({
    method: 'dispatchAction',
    params: { channel: URI, action: { type: 'session/activeClientSet', activeClient: { clientId: 'twice', tools: [] } } },
  });
  expect(await clientsIn(a.client, URI)).toEqual(['twice']);

  first.client.close();
  expect(await clientsIn(a.client, URI)).toEqual(['twice']);
  second.client.close();
  expect(await clientsIn(a.client, URI)).toEqual([]);
});

it('says how many sessions it is running when that changes', async () => {
  const held = host();
  const a = await joins(held, 'one');
  await a.client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } });
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await a.client.handle({ method: 'disposeSession', params: { channel: URI } });
  expect(actions(a.peer, 'ahp-root://')
    .filter((one) => one.type === 'root/activeSessionsChanged')
    .map((one) => one.activeSessions)).toEqual([1, 0]);
});
