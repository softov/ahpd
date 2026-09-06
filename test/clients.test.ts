import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { fileResources } from '../src/resources.js';
import { echo } from '../examples/echo/agent.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * The ten `resource*` methods, run the other way round.
 *
 * The protocol is symmetrical about them: `CommandMap` and `ServerCommandMap`
 * carry the same ten entries with the same params and the same results, and
 * the receiver decides whether to allow the operation whichever direction it
 * came from. What that is *for* is a client publishing something this host
 * cannot reach - a plugin's virtual files, an editor's unsaved buffers - and
 * addressing it as `<scheme>://<clientId>/…`.
 *
 * So these are about routing: which peer answers, and what happens when the
 * URI names one that is not there.
 */

const DIR = '/tmp/clients';

function peer(name: string): Peer & {
  asked: { method: string; params: unknown }[];
  answer: (method: string, params: Record<string, unknown>) => unknown;
  notes: { method: string; params: unknown }[];
} {
  const asked: { method: string; params: unknown }[] = [];
  const notes: { method: string; params: unknown }[] = [];
  const held = {
    asked,
    notes,
    name,
    answer: (method: string, _params: Record<string, unknown>): unknown => ({ answered: method }),
    send: () => {},
    notify: (method: string, params: unknown) => notes.push({ method, params }),
    request: async (method: string, params: unknown) => {
      asked.push({ method, params });
      return held.answer(method, (params ?? {}) as Record<string, unknown>);
    },
    answered: () => {},
    close: () => {},
  };
  return held;
}

const said: string[] = [];
const host = () => createHost({
  path: DIR,
  agents: [echo({ path: DIR, pace: 0 })],
  resources: fileResources(),
  onEvent: (line) => said.push(line),
});

async function joined(one: ReturnType<typeof host>, clientId: string) {
  const p = peer(clientId);
  const client = one.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId, protocolVersions: ['0.9.0'] },
  });
  return { client, peer: p };
}

it('sends a resource request to the client whose URI it names', async () => {
  const served = host();
  const publisher = await joined(served, 'plugin');
  const reader = await joined(served, 'editor');
  publisher.peer.answer = () => ({ data: 'hello', encoding: 'utf-8' });

  const read = await reader.client.handle({
    method: 'resourceRead',
    params: { channel: 'ahp-root://', uri: 'virtual://plugin/notes.md' },
  });
  // The publisher was asked, in the same words the reader used - and what it
  // said came back untouched.
  expect(publisher.peer.asked).toEqual([
    { method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'virtual://plugin/notes.md' } },
  ]);
  expect(read).toEqual({ data: 'hello', encoding: 'utf-8' });
  // And the client that asked was not asked anything.
  expect(reader.peer.asked).toEqual([]);
});

it('leaves a file on this machine to this host', async () => {
  const served = host();
  const publisher = await joined(served, 'plugin');
  const reader = await joined(served, 'editor');
  // `file:` is never a client's, whatever a client is called - the host has a
  // filesystem for it, and this one refuses a path outside what it serves.
  await expect(reader.client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'file:///etc/passwd' },
  })).rejects.toThrow();
  expect(publisher.peer.asked).toEqual([]);
});

it('leaves a channel URI alone, because its authority is not a client', async () => {
  const served = host();
  const named = await joined(served, 'logs');
  const reader = await joined(served, 'editor');
  // `ahp-otlp://logs/info` has `logs` where a client id would be. A host that
  // read the authority without looking at the scheme would send this to the
  // client that happens to be called that.
  await expect(reader.client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'ahp-otlp://logs/info' },
  })).rejects.toThrow();
  expect(named.peer.asked).toEqual([]);
});

it('will not move a resource from one client into another', async () => {
  const served = host();
  await joined(served, 'plugin');
  const other = await joined(served, 'second');
  const reader = await joined(served, 'editor');
  await expect(reader.client.handle({
    method: 'resourceMove',
    params: { channel: 'ahp-root://', source: 'virtual://plugin/a', destination: 'virtual://second/b' },
  })).rejects.toMatchObject({ code: -32602 });
  // Neither end was asked to do half of it.
  expect(other.peer.asked).toEqual([]);
});

it('relays what a watching client reports, and refuses the same from anybody else', async () => {
  const served = host();
  const publisher = await joined(served, 'plugin');
  const reader = await joined(served, 'editor');
  publisher.peer.answer = () => ({ channel: 'ahp-resource-watch:/from-plugin' });

  const made = await reader.client.handle({
    method: 'createResourceWatch',
    params: { channel: 'ahp-root://', uri: 'virtual://plugin/src', recursive: true },
  }) as { channel: string };
  expect(made.channel).toBe('ahp-resource-watch:/from-plugin');
  await reader.client.handle({ method: 'subscribe', params: { channel: made.channel } });

  // The owner says its files moved. `resourceWatch/changed` is a host's to
  // say - except on a watch a client itself minted, where that client is the
  // only thing that can see the change.
  publisher.client.handle({
    method: 'dispatchAction',
    params: {
      channel: made.channel,
      action: { type: 'resourceWatch/changed', changes: { items: [{ uri: 'virtual://plugin/src/a.ts', kind: 'changed' }] } },
    },
  });
  const relayed = reader.peer.notes
    .filter((one) => one.method === 'action')
    .map((one) => one.params as { channel: string; action: { type: string } })
    .filter((one) => one.channel === made.channel);
  expect(relayed.map((one) => one.action.type)).toEqual(['resourceWatch/changed']);

  // And a third client claiming the same is refused: a change to somebody
  // else's files is not a thing it can have seen.
  const liar = await joined(served, 'third');
  liar.client.handle({
    method: 'dispatchAction',
    params: { channel: made.channel, action: { type: 'resourceWatch/changed', changes: { items: [] } } },
  });
  const refused = liar.peer.notes
    .map((one) => (one.params as { rejectionReason?: string }).rejectionReason)
    .filter((one): one is string => typeof one === 'string');
  expect(refused.some((one) => one.includes("this host's to say"))).toBe(true);
});

it('names the client behind a URI, and answers nothing for one nobody published', async () => {
  const served = host();
  await joined(served, 'plugin');
  expect(served.clients.ids()).toEqual(['plugin']);
  expect(served.clients.owner('virtual://plugin/x')).toBe('plugin');
  expect(served.clients.owner('virtual://gone/x')).toBeUndefined();
  expect(served.clients.owner('file:///tmp/x')).toBeUndefined();
});

it('asks one client directly, which is what the port is for', async () => {
  const served = host();
  const publisher = await joined(served, 'plugin');
  publisher.peer.answer = (method) => ({ ran: method });

  await served.clients.write('plugin', 'virtual://plugin/a.txt', { data: 'x', encoding: 'utf-8' });
  await served.clients.remove('plugin', 'virtual://plugin/a.txt', true);
  expect(publisher.peer.asked.map((one) => one.method)).toEqual(['resourceWrite', 'resourceDelete']);
  // Every one carries `channel`, which the protocol requires of a request
  // whichever direction it is going.
  expect((publisher.peer.asked[0]?.params as { channel: string }).channel).toBe('ahp-root://');
  await expect(served.clients.read('gone', 'virtual://gone/a')).rejects.toMatchObject({ code: -32008 });
});

it('reads a client\'s resource through the port, base64 and all', async () => {
  const served = host();
  const publisher = await joined(served, 'plugin');
  publisher.peer.answer = () => ({ data: 'ZG9uZQ==', encoding: 'base64' });
  // The port hands back whatever the client said, in the client's own shape:
  // decoding is the caller's, because a caller writing a file wants the bytes.
  expect(await served.clients.read('plugin', 'virtual://plugin/notes.md'))
    .toEqual({ data: 'ZG9uZQ==', encoding: 'base64' });
  expect(publisher.peer.asked.map((one) => one.method)).toEqual(['resourceRead']);
});

it('writes down a refusal that crossed a connection, without softening it', async () => {
  said.length = 0;
  const served = host();
  const publisher = await joined(served, 'plugin');
  const reader = await joined(served, 'editor');
  publisher.peer.request = async () => {
    throw Object.assign(new Error('This client published its directory read-only.'), { code: -32009 });
  };

  /*
   * The owner's refusal, verbatim.
   *
   * This host has no standing to soften somebody else's `-32009` - the client
   * that published the resource is the one deciding - so what the reader gets
   * is what the publisher said.
   */
  await expect(reader.client.handle({
    method: 'resourceWrite',
    params: { channel: 'ahp-root://', uri: 'virtual://plugin/a.txt', data: 'x', encoding: 'utf-8' },
  })).rejects.toMatchObject({ code: -32009 });

  /*
   * And written down, because the asking client cannot attribute it.
   *
   * `-32009` for a directory published read-only and `-32009` for a client
   * that has not worked out who is asking yet are the same three digits. The
   * log is the only place the method, the URI, the client that refused and
   * the code are visible together.
   */
  const wrote = said.find((line) => line.includes('refused'));
  expect(wrote).toContain('plugin');
  expect(wrote).toContain('resourceWrite');
  expect(wrote).toContain('virtual://plugin/a.txt');
  expect(wrote).toContain('-32009');
});

it('says a client URI is nobody\'s here when the client that published it has gone', async () => {
  const served = host();
  const reader = await joined(served, 'editor');
  /*
   * Routed nowhere, and then told as what it is.
   *
   * `ownerOf` finds no connected client, so this falls through to the host's
   * own store - which serves a filesystem and used to answer
   * `virtual://plugin/a.txt is not an absolute path`, sending whoever read it
   * to look at their path. The URI is not a path this host got wrong; it is
   * one somebody else was meant to answer.
   */
  await expect(reader.client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'virtual://plugin/a.txt' },
  })).rejects.toThrow(/no connected client publishes it/);

  // And a `file:` URI that really is a bad path still says so.
  await expect(reader.client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'file:relative/x' },
  })).rejects.toThrow(/not an absolute path/);
});
