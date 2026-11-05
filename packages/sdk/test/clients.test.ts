import { expect, it, vi } from 'vitest';
import { createHost } from '../src/host.js';
import { fileResources } from '../src/resources/resources.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * The ten `resource*` methods, run the other way round.
 *
 * The protocol is symmetrical about them: `CommandMap` and `ServerCommandMap`
 * carry the same ten entries with the same params and the same results, and
 * the receiver decides whether to allow the operation whichever direction it
 * came from. What that is *for* is a client serving something this host
 * cannot reach - a plugin's virtual files, an editor's unsaved buffers - which
 * this host addresses as VS Code's host does, under
 * `vscode-agent-client://<clientId>/<scheme>/<authority>/<path>`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentClientUri.ts#L8-L23
 *
 * So these are about routing: which peer answers, about which URI, and what
 * happens when the URI names a client that is not there.
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

/** Every `resourceWatch/changed` a client was told on one channel. */
const changed = (p: ReturnType<typeof peer>, channel: string) => p.notes
  .filter((one) => one.method === 'action')
  .map((one) => one.params as { channel: string; action: { type: string; changes?: { items: unknown[] } }; rejectionReason?: string })
  .filter((one) => one.channel === channel && one.action.type === 'resourceWatch/changed' && one.rejectionReason === undefined)
  .flatMap((one) => one.action.changes?.items ?? []);

it('sends a resource request to the client the client scheme names, about the URI as it knows it', async () => {
  const served = host();
  const publisher = await joined(served, 'plugin');
  const reader = await joined(served, 'editor');
  publisher.peer.answer = () => ({ data: 'hello', encoding: 'utf-8' });

  const read = await reader.client.handle({
    method: 'resourceRead',
    params: { channel: 'ahp-root://', uri: 'vscode-agent-client://plugin/file/-/work/notes.md' },
  });
  // The publisher was asked about its own URI - and what it said came back untouched.
  expect(publisher.peer.asked).toEqual([
    { method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'file:///work/notes.md' } },
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
  // filesystem for it, and answers from that, here that there is no such file.
  await expect(reader.client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'file:///etc/nothing-of-this-name' },
  })).rejects.toMatchObject({ code: -32008 });
  expect(publisher.peer.asked).toEqual([]);
});

it('leaves any other scheme to this host, whatever client its authority happens to name', async () => {
  const served = host();
  const named = await joined(served, 'logs');
  const reader = await joined(served, 'editor');
  await expect(reader.client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'virtual://logs/info' },
  })).rejects.toMatchObject({ code: -32601, message: 'virtual://logs/info is not this host\'s to read: nothing here serves virtual:' });
  expect(named.peer.asked).toEqual([]);
});

/*
 * A move or a copy goes to the source's client with both URIs as it knows
 * them, as VS Code's client filesystem sends a rename to the source's
 * connection.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostFileSystemProvider.ts#L541-L561
 */
it('sends a move between two clients to the source\'s client, with both URIs as it knows them', async () => {
  const served = host();
  const source = await joined(served, 'plugin');
  const other = await joined(served, 'second');
  const reader = await joined(served, 'editor');
  source.peer.answer = () => ({});
  await reader.client.handle({
    method: 'resourceMove',
    params: { channel: 'ahp-root://', source: 'vscode-agent-client://plugin/file/-/a', destination: 'vscode-agent-client://second/file/-/b' },
  });
  expect(source.peer.asked).toEqual([
    { method: 'resourceMove', params: { channel: 'ahp-root://', source: 'file:///a', destination: 'file:///b', failIfExists: false } },
  ]);
  expect(other.peer.asked).toEqual([]);
});

/*
 * A client whose connection has just closed is waited for through VS Code's
 * 5 s grace, and one gone longer, or never here, is refused in its words.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostFileSystemProvider.ts#L205-L216
 */
it('waits 5 s for a client that has just gone, and refuses one gone longer', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const served = host();
    const first = await joined(served, 'plugin');
    const reader = await joined(served, 'editor');
    first.client.close();
    const read = reader.client.handle({
      method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'vscode-agent-client://plugin/file/-/a.txt' },
    });
    await vi.advanceTimersByTimeAsync(4_000);
    const again = peer('plugin');
    again.answer = () => ({ data: 'back', encoding: 'utf-8' });
    const back = served.accept(again);
    await back.handle({ method: 'initialize', params: { clientId: 'plugin', protocolVersions: ['0.9.0'] } });
    expect(await read).toEqual({ data: 'back', encoding: 'utf-8' });
    expect(first.peer.asked).toEqual([]);

    back.close();
    const late = reader.client.handle({
      method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'vscode-agent-client://plugin/file/-/a.txt' },
    });
    const refused = expect(late).rejects.toMatchObject({ code: -32603, message: 'No connection for authority: plugin' });
    await vi.advanceTimersByTimeAsync(5_000);
    await refused;
    await expect(reader.client.handle({
      method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'vscode-agent-client://nobody/file/-/a.txt' },
    })).rejects.toMatchObject({ code: -32603, message: 'No connection for authority: nobody' });
  }
  finally {
    vi.useRealTimers();
  }
});

/*
 * A watch on a client's resource is this host's own channel, and what the
 * client sees comes back as the protocol carries a watch's changes to its
 * caller: this host asks the client for a watch, subscribes to the channel it
 * answers, and takes the client's action envelopes on it, saying each batch
 * on its own channel under the client scheme.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/resource-watch-channel.md#L32-L54
 */
it('says a client\'s changes on this host\'s own watch channel, from the envelopes on the channel it subscribed to', async () => {
  const served = host();
  const publisher = await joined(served, 'plugin');
  const reader = await joined(served, 'editor');
  publisher.peer.answer = (method, params) => (method === 'resourceResolve' ? { uri: params.uri, type: 'directory' }
    : method === 'createResourceWatch' ? { channel: 'ahp-resource-watch:/from-plugin' }
      : { snapshot: { resource: params.channel, state: {}, fromSeq: 0 } });

  const made = await reader.client.handle({
    method: 'createResourceWatch',
    params: { channel: 'ahp-root://', uri: 'vscode-agent-client://plugin/file/-/src', recursive: true },
  }) as { channel: string };
  expect(made.channel.startsWith('ahp-resource-watch://r/')).toBe(true);
  await reader.client.handle({ method: 'subscribe', params: { channel: made.channel } });
  expect(publisher.peer.asked.map((one) => [one.method, (one.params as { uri?: string; channel?: string }).uri ?? (one.params as { channel?: string }).channel])).toEqual([
    ['resourceResolve', 'file:///src'],
    ['createResourceWatch', 'file:///src'],
    ['subscribe', 'ahp-resource-watch:/from-plugin'],
  ]);

  await publisher.client.handle({
    method: 'action',
    params: {
      channel: 'ahp-resource-watch:/from-plugin',
      serverSeq: 1,
      action: { type: 'resourceWatch/changed', changes: { items: [{ uri: 'file:///src/a.ts', type: 'updated' }] } },
    },
  });
  expect(changed(reader.peer, made.channel)).toEqual([{ uri: 'vscode-agent-client://plugin/file/-/src/a.ts', type: 'updated' }]);

  // Heard from the client the watch was asked of, on the channel it answered, and from nobody else.
  const third = await joined(served, 'third');
  await third.client.handle({
    method: 'action',
    params: { channel: 'ahp-resource-watch:/from-plugin', serverSeq: 1, action: { type: 'resourceWatch/changed', changes: { items: [{ uri: 'file:///x', type: 'added' }] } } },
  });
  expect(changed(reader.peer, made.channel)).toHaveLength(1);

  // A dispatch of the change is refused from every client, the one watched among them, as VS Code's host refuses it.
  for (const one of [publisher, third]) {
    await one.client.handle({
      method: 'dispatchAction',
      params: { channel: made.channel, clientSeq: 1, action: { type: 'resourceWatch/changed', changes: { items: [] } } },
    });
    expect(one.peer.notes.map((note) => (note.params as { rejectionReason?: string }).rejectionReason))
      .toContain('Server-only action: resourceWatch/changed');
  }
  expect(changed(reader.peer, made.channel)).toHaveLength(1);
});

it('names the client behind a URI under the client scheme, and answers nothing for any other', async () => {
  const served = host();
  await joined(served, 'plugin');
  expect(served.clients.ids()).toEqual(['plugin']);
  expect(served.clients.owner('vscode-agent-client://plugin/file/-/x')).toBe('plugin');
  expect(served.clients.owner('vscode-agent-client://gone/file/-/x')).toBeUndefined();
  expect(served.clients.owner('virtual://plugin/x')).toBeUndefined();
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
  await expect(served.clients.read('gone', 'virtual://gone/a')).rejects.toMatchObject({ code: -32603, message: 'No connection for authority: gone' });
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

it('writes down a refusal that crossed a connection, and hands it back as the client said it', async () => {
  said.length = 0;
  const served = host();
  const publisher = await joined(served, 'plugin');
  const reader = await joined(served, 'editor');
  publisher.peer.request = async () => {
    throw Object.assign(new Error('This client published its directory read-only.'), { code: -32009 });
  };

  /*
   * The owner's refusal, verbatim: the client that serves the resource is
   * the one deciding, so what the reader gets is what the publisher said.
   */
  await expect(reader.client.handle({
    method: 'resourceWrite',
    params: { channel: 'ahp-root://', uri: 'vscode-agent-client://plugin/file/-/a.txt', data: 'x', encoding: 'utf-8' },
  })).rejects.toMatchObject({
    code: -32009,
    // And the sentence, not only the code. This host's claim is that a
    // refusal comes back *as the owner sent it* - so the message is the half
    // being promised, and a test that checked the code alone would pass on a
    // host that rewrote every word of it.
    message: 'This client published its directory read-only.',
  });

  /*
   * And written down, because the asking client cannot attribute it.
   *
   * `-32009` for a directory published read-only and `-32009` for a client
   * that has not worked out who is asking yet are the same three digits. The
   * log is the only place the method, the URI, the client that refused and
   * the code are visible together.
   */
  // The whole line, not four substrings of it. The claim is that these four
  // facts are in one place and readable together, and four containment checks
  // pass just as happily on four separate lines in any order.
  expect(said.find((line) => line.includes('refused')))
    .toBe('plugin refused resourceWrite for file:///a.txt (-32009):'
      + ' This client published its directory read-only.');
});

it('says what a URI no store serves is, and what a bad path is', async () => {
  const served = host();
  const reader = await joined(served, 'editor');
  await expect(reader.client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'virtual://plugin/a.txt' },
  })).rejects.toThrow(/nothing here serves virtual:$/);

  // And a `file:` URI that really is a bad path still says so.
  await expect(reader.client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'file:relative/x' },
  })).rejects.toThrow(/not an absolute path/);
});
