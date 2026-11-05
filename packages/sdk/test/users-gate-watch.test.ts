import { expect, it } from 'vitest';
import { ROOT } from '../src/host.js';
import { call, directory, hello, host, peer, signIn } from './users-gate-helpers.js';
import type { Bag } from './users-gate-helpers.js';
import type { ResourceChange, ResourceProvider } from '../src/types/resources.js';
import type { Principal } from '../src/types/users.js';

/*
 * A watch on a provider's scheme.
 *
 * It answers to the scheme it watches, at `createResourceWatch` and at the
 * subscribe that follows, and the provider is told who is watching.
 */

/** A provider that can be watched, and keeps the reader each watch was opened by. */
const watchable = (open: (uri: string, reader: Principal | undefined) => boolean = () => false) => {
  const readers: (Principal | undefined)[] = [];
  const told: ((changes: ResourceChange[]) => void)[] = [];
  const provider: ResourceProvider = {
    read: async () => ({ data: '{}', encoding: 'utf-8' }),
    watch: async (_uri, _options, onChange, reader) => {
      readers.push(reader);
      told.push(onChange);
      return { close: () => {} };
    },
    authorize: async (uri, reader) => open(uri, reader),
  };
  return { provider, readers, told };
};

const opened = async (made: ReturnType<typeof host>, token: string) => {
  const client = made.accept(peer());
  await hello(client, token); await signIn(client, token);
  return client;
};

it('hands the provider the reader whose subscribe attaches the watch', async () => {
  const { provider, readers } = watchable();
  const made = host({ users: directory({ ana: ['bot:watch'] }), resourceProviders: { bot: provider } });
  const ana = await opened(made, 'ana');
  const { result } = await call(ana, 'createResourceWatch', { channel: ROOT, uri: 'bot://' }) as { result: { channel: string } };
  expect(readers).toEqual([]);
  expect(await call(ana, 'subscribe', { channel: result.channel })).toMatchObject({ result: { snapshot: expect.anything() } });
  expect(readers).toEqual([expect.objectContaining({ id: 'ana' })]);
});

it('gives each reader of one watch a watcher of their own, its reports theirs alone', async () => {
  const { provider, readers, told } = watchable();
  const made = host({ users: directory({ ana: ['bot:watch'], bob: ['bot:watch'] }), resourceProviders: { bot: provider } });
  const heard: Record<string, { method: string; params: unknown }[]> = { ana: [], bob: [] };
  const [ana, bob] = await Promise.all(['ana', 'bob'].map(async (token) => {
    const client = made.accept({ ...peer(), notify: (method, params) => { heard[token]?.push({ method, params }); } });
    await hello(client, token); await signIn(client, token);
    return client;
  }));
  if (ana === undefined || bob === undefined) throw new Error('Two readers were opened.');
  const { result } = await call(ana, 'createResourceWatch', { channel: ROOT, uri: 'bot://' }) as { result: { channel: string } };
  expect(await call(bob, 'createResourceWatch', { channel: ROOT, uri: 'bot://' })).toMatchObject({ result: { channel: result.channel } });
  await call(ana, 'subscribe', { channel: result.channel });
  await call(bob, 'subscribe', { channel: result.channel });
  expect(readers).toEqual([expect.objectContaining({ id: 'ana' }), expect.objectContaining({ id: 'bob' })]);

  told[0]?.([{ uri: 'bot://seen-by-ana', type: 'added' }]);
  const changed = (who: string) => (heard[who] ?? [])
    .map((one) => one.params as { channel?: string; action?: { type: string } })
    .filter((one) => one.channel === result.channel && one.action?.type === 'resourceWatch/changed');
  expect(changed('ana')).toHaveLength(1);
  expect(changed('bob')).toEqual([]);
});

it('gates the watch channel by the scheme it watches, not by file:watch', async () => {
  const { provider } = watchable();
  const made = host({
    users: directory({ owner: ['bot:watch'], bots: ['bot:watch'], files: ['file:watch'] }),
    resourceProviders: { bot: provider },
  });
  const owner = await opened(made, 'owner');
  const { result } = await call(owner, 'createResourceWatch', { channel: ROOT, uri: 'bot://' }) as { result: { channel: string } };

  const bots = await opened(made, 'bots');
  expect(await call(bots, 'subscribe', { channel: result.channel })).toMatchObject({ result: { snapshot: expect.anything() } });

  const files = await opened(made, 'files');
  expect(await call(files, 'subscribe', { channel: result.channel })).toMatchObject({ code: -32009, message: 'files may not bot:watch here' });
});

it('lets a provider\'s authorize open a watch and its channel to a reader with no grant', async () => {
  const { provider } = watchable((uri, reader) => reader?.id === 'ana' && uri === 'bot://');
  const made = host({ users: directory({ ana: [], bob: [] }), resourceProviders: { bot: provider } });

  const ana = await opened(made, 'ana');
  const { result } = await call(ana, 'createResourceWatch', { channel: ROOT, uri: 'bot://' }) as { result: { channel: string } };
  expect(result.channel).toMatch(/^ahp-resource-watch:\//);
  expect(await call(ana, 'subscribe', { channel: result.channel })).toMatchObject({ result: { snapshot: expect.anything() } });

  const bob = await opened(made, 'bob');
  expect(await call(bob, 'createResourceWatch', { channel: ROOT, uri: 'bot://' })).toMatchObject({ code: -32009, message: 'bob may not bot:watch here' });
  expect(await call(bob, 'subscribe', { channel: result.channel })).toMatchObject({ code: -32009, message: 'bob may not bot:watch here' });
});

it('advertises watch for a provider that has it', async () => {
  const { provider } = watchable();
  const made = host({ resourceProviders: { bot: provider, plain: { read: provider.read } } });
  const client = made.accept(peer());
  const ready = await hello(client) as Bag;
  const schemes = ready._meta['ahpd.resourceProviders'] as Bag;
  expect(schemes['bot'].operations).toEqual(['get', 'watch']);
  expect(schemes['plain'].operations).toEqual(['get']);
});
