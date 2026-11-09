import { loggerOf } from '../src/log.js';
import { expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { fileResources } from '../src/resources/resources.js';
import { sdkVersion } from '../src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import { call, directory, hello, RECORD, root, watching } from './users-gate-helpers.js';
import type { Bag } from './users-gate-helpers.js';
import type { HostOptions } from '../src/types/host.js';
import type { ChannelHandle, PluginChannel, LoaderContext } from '../src/types/plugin.js';
import type { Grant, Principal } from '../src/types/users.js';

/*
 * A plugin channel: an `x-` scheme one plugin serves, which a client
 * subscribes to and never writes
 * and `a-plugin-channel-filters-each-action-per-subscriber`.
 *
 * One plugin, `demo`, serves `x-demo://`. Its snapshot says who asked, so a
 * case can read what the host handed it.
 */

const URI = 'x-demo://all';

const context = (): LoaderContext => ({ path: root, paths: [root], version: sdkVersion(), hostName: 'test', configDir: root, log: loggerOf(() => {}), say: () => {} });

const settle = async (): Promise<void> => { await new Promise((resolve) => { setTimeout(resolve, 20); }); };

/** What the demo channel was asked, in order. */
interface Heard { snapshots: { uri: string; reader: string | undefined; client: string }[]; left: string[]; authorized: string[] }

/** A host with the demo plugin's channel, and the handle the plugin holds. */
function served(extra: Partial<PluginChannel> = {}, options: Partial<HostOptions> = {}) {
  const heard: Heard = { snapshots: [], left: [], authorized: [] };
  const { host: plugin, contribution } = pluginHost('demo', context());
  // The channel's grant is on `ahpd.grants`, so the fold has a list to check
  // it against.
  plugin.registerGrants('demo', { operations: ['pin'] });
  const channel: PluginChannel = {
    grant: 'demo:read',
    snapshot: (uri, reader, client) => {
      heard.snapshots.push({ uri, reader: reader?.id, client });
      return { items: ['one'] };
    },
    left: (client) => { heard.left.push(client); },
    ...extra,
  };
  const handle: ChannelHandle = plugin.registerChannel('x-demo', channel);
  const folded = foldHostOptions({
    path: root,
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }],
    resources: fileResources(),
    ...options,
  }, [contribution]);
  expect(folded.problems).toEqual([]);
  return { heard, handle, made: createHost(folded.options) };
}

/** A client of `made`, introduced as `id`, whose notifications are kept. */
const client = async (made: ReturnType<typeof createHost>, id: string, token?: string) => {
  const seen = watching();
  const one = made.accept(seen);
  const ready = await hello(one, id) as Bag;
  if (token !== undefined) {
    await one.handle({ method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token } });
  }
  /** The actions sent on the demo channel, by type. */
  const actions = () => seen.seen
    .filter((note) => note.method === 'action' && note.params.channel === URI && note.params.rejectionReason === undefined)
    .map((note) => note.params);
  return { one, seen, ready, actions };
};

const subscribe = (one: Awaited<ReturnType<typeof client>>, channel = URI) => call(one.one, 'subscribe', { channel });

it('answers a subscribe with the plugin snapshot, naming who asked', async () => {
  const { heard, made } = served();
  const ana = await client(made, 'ana');
  const answer = await subscribe(ana) as Bag;
  expect(answer.result.snapshot).toMatchObject({ resource: URI, state: { items: ['one'] } });
  expect(typeof answer.result.snapshot.fromSeq).toBe('number');
  expect(heard.snapshots).toEqual([{ uri: URI, reader: undefined, client: 'ana' }]);
});

it('refuses a scheme without x-, and a scheme a plugin already took', () => {
  const { host: plugin } = pluginHost('demo', context());
  expect(() => plugin.registerChannel('demo', { grant: 'demo:read', snapshot: () => ({}) }))
    .toThrow(/starts with x-/);
  plugin.registerChannel('x-demo', { grant: 'demo:read', snapshot: () => ({}) });
  expect(() => plugin.registerChannel('X-Demo', { grant: 'demo:read', snapshot: () => ({}) }))
    .toThrow(/no other channel in this plugin/);

  const first = pluginHost('first', context());
  const second = pluginHost('second', context());
  first.host.registerChannel('x-same', { grant: 'session:read', snapshot: () => ({}) });
  second.host.registerChannel('x-same', { grant: 'session:read', snapshot: () => ({}) });
  const { options, problems } = foldHostOptions({ path: root, agents: [] }, [first.contribution, second.contribution]);
  expect(problems).toEqual(['plugin second registers channel x-same, which plugin first already registered']);
  expect(options.channels?.['x-same']?.by).toBe('first');
});

it('needs the channel grant to subscribe, unless authorize lets the reader in', async () => {
  const users = directory({ ana: ['demo:read' as Grant], bo: [], cy: [] });
  const { heard, made } = served({
    authorize: async (uri, reader) => { heard.authorized.push(reader.id); return reader.id === 'cy' && uri === URI; },
  }, { users });
  const ana = await client(made, 'ana', 'ana');
  const bo = await client(made, 'bo', 'bo');
  const cy = await client(made, 'cy', 'cy');
  expect(await subscribe(ana)).toHaveProperty('result');
  expect(await subscribe(bo)).toMatchObject({ code: -32009 });
  expect(await subscribe(cy)).toHaveProperty('result');
  // Asked only of the readers the grant refused.
  expect(heard.authorized).toEqual(['bo', 'cy']);
  expect(heard.snapshots.map((one) => one.reader)).toEqual(['ana', 'cy']);
});

it('refuses a dispatch to a plugin channel, and the plugin hears nothing of it', async () => {
  const { handle, made } = served();
  const ana = await client(made, 'ana');
  await subscribe(ana);
  ana.one.handle({ method: 'dispatchAction', params: { channel: URI, action: { type: 'x-demo/added', item: 'two' } } });
  await settle();
  const refused = ana.seen.seen.filter((note) => note.method === 'action' && note.params.rejectionReason !== undefined);
  expect(refused.map((note) => note.params.rejectionReason)).toEqual(["x-demo/added is x-demo://all's plugin's to say, not a client's"]);
  expect(ana.actions()).toEqual([]);
  expect(handle.subscribers(URI)).toEqual([{ client: 'ana', reader: undefined }]);
});

it('calls left once a client watches no URI on the scheme, on unsubscribe and on disconnect', async () => {
  const { heard, made } = served();
  const ana = await client(made, 'ana');
  await subscribe(ana);
  await subscribe(ana, 'x-demo://other');
  ana.one.handle({ method: 'unsubscribe', params: { channel: URI } });
  expect(heard.left).toEqual([]);
  ana.one.handle({ method: 'unsubscribe', params: { channel: 'x-demo://other' } });
  expect(heard.left).toEqual(['ana']);

  const bo = await client(made, 'bo');
  await subscribe(bo);
  bo.one.close();
  expect(heard.left).toEqual(['ana', 'bo']);
});

it('never reads an x- URI as a session', async () => {
  const { made } = served();
  const ana = await client(made, 'ana');
  // No plugin serves it, and it is not looked up as a session.
  expect(await subscribe(ana, 'x-none:/abc')).toMatchObject({ code: -32001, message: 'No channel at x-none:/abc' });
  // A session may not be made under one, served or not.
  expect(await call(ana.one, 'createSession', { channel: 'x-demo:/abc', provider: 'base' })).toMatchObject({ code: -32003 });
  expect(await call(ana.one, 'createSession', { channel: 'x-none:/abc', provider: 'base' })).toMatchObject({ code: -32003 });
  // A session action on one is the plugin's refusal, not a session lookup.
  ana.one.handle({ method: 'dispatchAction', params: { channel: 'x-none:/abc', action: { type: 'session/titleChanged', title: 'no' } } });
  await settle();
  const reasons = ana.seen.seen.filter((note) => note.method === 'action').map((note) => String(note.params.rejectionReason));
  expect(reasons).toEqual(["session/titleChanged is x-none:/abc's plugin's to say, not a client's"]);
});

it('refuses a publish before a host is built, and an action type off the scheme', () => {
  const { host: plugin } = pluginHost('demo', context());
  const handle = plugin.registerChannel('x-demo', { grant: 'demo:read', snapshot: () => ({}) });
  expect(() => { handle.publish(URI, { type: 'x-demo/added' }); }).toThrow(/once a host is built/);
  expect(() => { handle.publish(URI, { type: 'session/added' }); }).toThrow(/starts with x-demo\//);
  expect(() => { handle.publish('x-other://all', { type: 'x-demo/added' }); }).toThrow(/a URI on x-demo:/);
  expect(handle.subscribers(URI)).toEqual([]);
});

it('sends each reader only what visible lets them see, and what to names them in', async () => {
  const users = directory({ ana: ['demo:read' as Grant], bo: ['demo:read' as Grant] });
  const { handle, made } = served({}, { users });
  const ana = await client(made, 'ana', 'ana');
  const bo = await client(made, 'bo', 'bo');
  await subscribe(ana);
  await subscribe(bo);
  expect(handle.subscribers(URI).map((one) => [one.client, one.reader?.id])).toEqual([['ana', 'ana'], ['bo', 'bo']]);

  const mine = (reader: Principal | undefined) => (item: string) => item.startsWith(reader?.id ?? '-');
  for (const item of ['ana-1', 'bo-1', 'ana-2']) {
    handle.publish(URI, { type: 'x-demo/added', item }, { visible: (reader) => mine(reader)(item) });
  }
  handle.publish(URI, { type: 'x-demo/note', item: 'for-bo' }, { to: 'bo' });
  handle.publish(URI, { type: 'x-demo/note', item: 'everyone' });

  expect(ana.actions().map((one) => one.action.item)).toEqual(['ana-1', 'ana-2', 'everyone']);
  expect(bo.actions().map((one) => one.action.item)).toEqual(['bo-1', 'for-bo', 'everyone']);
  // The audience is the host's and never goes out.
  for (const one of [...ana.actions(), ...bo.actions()]) expect(one).not.toHaveProperty('audience');
  // A gap in serverSeq where an action was not for this reader.
  const seqs = ana.actions().map((one) => one.serverSeq as number);
  expect(seqs[1]! - seqs[0]!).toBe(2);
});

it('filters a replay the same way, at reconnect and at subscribe', async () => {
  const { handle, made } = served();
  const ana = await client(made, 'ana');
  const at = (await subscribe(ana) as Bag).result.snapshot.fromSeq as number;
  ana.one.close();

  handle.publish(URI, { type: 'x-demo/added', item: 'for-ana' }, { visible: (_reader, id) => id === 'ana' });
  handle.publish(URI, { type: 'x-demo/added', item: 'for-bo' }, { visible: (_reader, id) => id === 'bo' });
  handle.publish(URI, { type: 'x-demo/note', item: 'to-bo' }, { to: 'bo' });
  handle.publish(URI, { type: 'x-demo/note', item: 'to-ana' }, { to: 'ana' });

  const back = made.accept(watching());
  const replay = await back.handle({
    method: 'reconnect',
    params: { clientId: 'ana', lastSeenServerSeq: at, subscriptions: [URI] },
  }) as Bag;
  expect(replay.type).toBe('replay');
  expect(replay.actions.map((one: Bag) => one.action.item)).toEqual(['for-ana', 'to-ana']);
  for (const one of replay.actions) expect(one).not.toHaveProperty('audience');
});

it('advertises each plugin channel on initialize and in root state', async () => {
  const { made } = served({ describe: () => ({ title: 'Demo', description: 'What demo serves.' }) });
  const ana = await client(made, 'ana');
  const entry = [{ scheme: 'x-demo', title: 'Demo', description: 'What demo serves.', grant: 'demo:read' }];
  expect(ana.ready._meta?.['ahpd.channels']).toEqual(entry);
  expect(ana.ready.snapshots[0]?.state._meta?.['ahpd.channels']).toEqual(entry);

  const plain = served({});
  const bo = await client(plain.made, 'bo');
  expect(bo.ready._meta?.['ahpd.channels']).toEqual([{ scheme: 'x-demo', title: 'x-demo', grant: 'demo:read' }]);
});

it('advertises no channels on a host whose plugins serve none', async () => {
  const made = createHost({ path: root, agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }] });
  const ana = await client(made, 'ana');
  expect(ana.ready._meta).not.toHaveProperty('ahpd.channels');
  expect(ana.ready.snapshots[0]?.state._meta ?? {}).not.toHaveProperty('ahpd.channels');
});
