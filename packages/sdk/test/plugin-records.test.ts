import { loggerOf } from '../src/log.js';
import { expect, it } from 'vitest';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { memoryRecords } from '../src/resources/records.js';
import type { HostOptions } from '../src/types/host.js';
import type { LoaderContext } from '../src/types/plugin.js';
import type { RecordChange, RecordStore } from '../src/types/records.js';

/*
 * The records port: a plugin opens a collection while `apply` runs, and the
 * collection reads and writes through whatever store the fold names.
 */

const context = (logged: string[] = []): LoaderContext => ({
  path: '/tmp/plugin-records',
  paths: ['/tmp/plugin-records'],
  version: '0.0.0',
  hostName: 'host',
  configDir: '/tmp/plugin-records',
  log: loggerOf((line: string) => { logged.push(line); }),
  say: () => {},
});

const base = (): HostOptions => ({ path: '/tmp/plugin-records', agents: [] });

/** A turn of the event loop, for the work a watch starts without a call to await. */
const settled = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

it('reads and writes through the store a plugin put in place with replace', async () => {
  const daemon = memoryRecords();
  const store = memoryRecords();
  let folded: (held: RecordStore | undefined) => void = () => {};
  const named = new Promise<RecordStore | undefined>((resolve) => { folded = resolve; });
  const collections = new Map<string, string>();

  const owner = pluginHost('sqlite', context(), { records: () => named, collections });
  owner.host.registerRecords(store, 'replace');
  const user = pluginHost('bot', context(), { records: () => named, collections });
  const bots = user.host.records('bots', { body: 'instructions' });
  const put = bots.put({ id: 'ana', owner: 'ana', instructions: 'Be brief.' });

  const { options, problems } = foldHostOptions({ ...base(), records: daemon }, [owner.contribution, user.contribution]);
  expect(problems).toEqual([]);
  expect(options.records).toBe(store);
  folded(options.records);
  await put;

  expect(await bots.get('ana')).toEqual({ id: 'ana', owner: 'ana', instructions: 'Be brief.' });
  expect(await (await store.collection('bots')).list()).toEqual([{ id: 'ana', owner: 'ana', instructions: 'Be brief.' }]);
  expect(await (await daemon.collection('bots')).list()).toEqual([]);
});

it('refuses a second plugin that opens the same name, and the first keeps its collection', async () => {
  const store = memoryRecords();
  const collections = new Map<string, string>();
  const first = pluginHost('first', context(), { records: () => store, collections }).host;
  const second = pluginHost('second', context(), { records: () => store, collections }).host;

  const held = first.records('notes');
  expect(() => second.records('notes')).toThrow(/second.*records.*notes.*plugin first opened it/);
  // The plugin that opened it opens it again.
  expect(() => first.records('notes')).not.toThrow();
  await held.put({ id: 'one' });
  expect(await held.list()).toEqual([{ id: 'one' }]);
});

it('takes a collection name of up to three slugs joined by /, and refuses any other', () => {
  const host = pluginHost('fixture', context(), { records: () => memoryRecords() }).host;
  expect(() => host.records('Bots')).toThrow(/fixture.*records.*Bots.*slug/);
  expect(() => host.records('a/B/c')).toThrow(/slug/);
  expect(() => host.records('a/b/c/d')).toThrow(/slug/);
  expect(() => host.records('a//b')).toThrow(/slug/);
  expect(() => host.records('')).toThrow(/slug/);
  expect(() => host.records('bots', { body: 1 } as never)).toThrow(/body/);
  expect(() => host.records('bots/x/chats', { file: 'A File' })).toThrow(/file name/);
  expect(() => host.records('bots/x/chats')).not.toThrow();
});

it('keeps the claim on the first slug, so a path under a collection is the opener\'s', async () => {
  const store = memoryRecords();
  const collections = new Map<string, string>();
  const first = pluginHost('first', context(), { records: () => store, collections }).host;
  const second = pluginHost('second', context(), { records: () => store, collections }).host;

  first.records('bots');
  expect(() => second.records('bots/ana/chats')).toThrow(/plugin first opened it/);
  const chats = first.records('bots/ana/chats');
  await chats.put({ id: 'one', bot: 'ana' });
  expect(await chats.list()).toEqual([{ id: 'one', bot: 'ana' }]);
});

it('refuses each call when the host has no records port', async () => {
  const logged: string[] = [];
  const notes = pluginHost('fixture', context(logged)).host.records('notes');
  await expect(notes.get('one')).rejects.toThrow(/no record store/);
  await expect(notes.list()).rejects.toThrow(/no record store/);
  await expect(notes.find({})).rejects.toThrow(/no record store/);
  await expect(notes.put({ id: 'one' })).rejects.toThrow(/no record store/);
  await expect(notes.remove('one')).rejects.toThrow(/no record store/);
  notes.watch(() => {});
  await settled();
  expect(logged.join('\n')).toMatch(/records notes cannot be watched.*no record store/);
});

it('finds only the records whose fields equal the match', async () => {
  const notes = await memoryRecords().collection('notes');
  await notes.put({ id: 'one', owner: 'ana', kind: 'bot' });
  await notes.put({ id: 'two', owner: 'bea', kind: 'bot' });
  await notes.put({ id: 'three', owner: 'ana', kind: 'note' });

  expect((await notes.find({ owner: 'ana' })).map((one) => one.id).sort()).toEqual(['one', 'three']);
  expect((await notes.find({ owner: 'ana', kind: 'bot' })).map((one) => one.id)).toEqual(['one']);
  expect(await notes.find({ owner: 'cid' })).toEqual([]);
});

it('tells a watcher of each put and remove, and nothing after it stops', async () => {
  const host = pluginHost('fixture', context(), { records: () => memoryRecords() }).host;
  const notes = host.records('notes');
  const heard: RecordChange[] = [];
  const stop = notes.watch((change) => { heard.push(change); });
  await settled();

  await notes.put({ id: 'one', text: 'a' });
  await notes.put({ id: 'one', text: 'b' });
  expect(await notes.remove('one')).toBe(true);
  expect(await notes.remove('one')).toBe(false);
  expect(heard).toEqual([
    { id: 'one', type: 'added' },
    { id: 'one', type: 'updated' },
    { id: 'one', type: 'deleted' },
  ]);

  stop();
  await notes.put({ id: 'two' });
  expect(heard).toHaveLength(3);
});

it('starts no watch that was stopped before the collection opened', async () => {
  const store = memoryRecords();
  const host = pluginHost('fixture', context(), { records: () => store }).host;
  const heard: RecordChange[] = [];
  host.records('notes').watch((change) => { heard.push(change); })();
  await settled();
  await (await store.collection('notes')).put({ id: 'one' });
  expect(heard).toEqual([]);
});

it('refuses a record whose id is not a slug, and keeps a copy of each record', async () => {
  const notes = await memoryRecords().collection('notes');
  await expect(notes.put({ id: 'Not A Slug' })).rejects.toThrow(/not a record id/);
  await expect(notes.put({ id: 7 } as never)).rejects.toThrow(/not a record id/);
  await expect(memoryRecords().collection('No')).rejects.toThrow(/not a collection name/);

  const record = { id: 'one', tags: ['a'] };
  await notes.put(record);
  record.tags.push('b');
  const read = await notes.get('one');
  expect(read).toEqual({ id: 'one', tags: ['a'] });
  (read?.['tags'] as string[]).push('c');
  expect(await notes.get('one')).toEqual({ id: 'one', tags: ['a'] });
  expect(await notes.get('two')).toBeUndefined();
});

it('refuses a records port with no collection, and a second registration', () => {
  const { host } = pluginHost('fixture', context());
  expect(() => host.registerRecords({} as never)).toThrow(/fixture.*registerRecords.*collection/);
  host.registerRecords(memoryRecords());
  expect(() => host.registerRecords(memoryRecords())).toThrow(/registered only once/);
});
