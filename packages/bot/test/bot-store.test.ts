import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { parseYaml, stringifyYaml } from '@cofold/yaml';
import { memoryRecords } from '../../sdk/src/resources/records.js';
import { backSessions, chatsOf, sessionsOf } from '../src/names.js';
import { botProvider } from '../src/provider.js';
import { botStore } from '../src/store.js';
import type { BotProvider } from '../src/provider.js';
import type { BotStore } from '../src/store.js';
import type { BotRecord } from '../src/record.js';
import type { RecordCollection, RecordStore, StoredRecord } from '../../sdk/src/types/records.js';
import type { Write } from '../../sdk/src/types/resources.js';

/*
 * The bot store, as two collections of the host's record store.
 *
 * The store keeps a cache that every read is answered from, and a tombstone for
 * each slug that had a bot. What is checked here is that shape: a record read
 * into the cache, a write that reaches the collection, a delete that leaves a
 * tombstone, and the refusals the cache is what makes possible.
 */

/** A write of one JSON body, as a client makes one. */
const said = (body: unknown, extra: Partial<Write> = {}): Write =>
  ({ data: JSON.stringify(body), encoding: 'utf-8', ...extra });

/** One bot's record as a read answers it. */
const record = async (provider: BotProvider, uri: string): Promise<Record<string, unknown>> =>
  JSON.parse((await provider.read(uri)).data) as Record<string, unknown>;

/** One record as a collection holds it, which a case has just written. */
const held = async (collection: RecordCollection, id: string): Promise<StoredRecord> => {
  const one = await collection.get(id);
  if (one === undefined) throw new Error(`${id} is not in the collection`);
  return one;
};

/** The YAML a bot's `AGENTS.md` is read and written with, which the host gives a plugin. */
const yaml = { parseYaml, stringifyYaml };

/**
 * The `AGENTS.md` a bot with no file is given here.
 *
 * A template, in the shape a bot's file has, filled with its words - what the
 * plugin's own seam makes from the default file.
 */
const agents = async (one: BotRecord): Promise<string> =>
  `# ${one.name}\n\n## Instructions\n\n${one.instructions ?? ''}\n`;

/** A record as the `bots` collection holds one, with the parts a bot needs. */
const bot = (id: string, rest: Record<string, unknown> = {}): StoredRecord => ({
  id,
  name: id,
  labels: [],
  body: 'robot',
  color: 'red',
  workspace: join(root, 'bots', id),
  owner: 'user:soft',
  createdAt: '2026-10-11T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
  ...rest,
});

/** A temporary root, so no case writes into a folder a person actually has. */
let root = '';
let loose: string[] = [];
beforeEach(() => {
  loose = [];
  root = mkdtempSync(join(tmpdir(), 'ahpd-bot-store-'));
  loose.push(root);
});
afterEach(() => {
  for (const dir of loose) rmSync(dir, { recursive: true, force: true });
  loose = [];
});

/** A provider over one store, and the collections behind it. */
async function made() {
  const records: RecordStore = memoryRecords();
  const problems: string[] = [];
  const folder = join(root, 'bots');
  const config = join(root, 'config');
  const bots: RecordCollection = await records.collection('bots');
  const graves: RecordCollection = await records.collection('bots-gone');
  const store: BotStore = botStore(bots, graves, (line) => problems.push(line), { yaml, agents });
  /*
   * One collection per bot, opened up front because the provider's seams are
   * synchronous: every slug these cases use is named here.
   */
  const chatRows = new Map<string, RecordCollection>();
  const sessionRows = new Map<string, RecordCollection>();
  for (const slug of ['flame', 'motion', 'other']) {
    chatRows.set(slug, await records.collection(chatsOf(slug)));
    sessionRows.set(slug, await records.collection(sessionsOf(slug)));
  }
  const rowsOf = (held: Map<string, RecordCollection>, slug: string): RecordCollection => {
    const one = held.get(slug);
    if (one === undefined) throw new Error(`this case opened no collection for ${slug}`);
    return one;
  };
  const provider = botProvider({
    root: folder,
    botsDir: join(config, 'bots'),
    store,
    sessions: { owner: async () => undefined, start: async () => 'echo:/one' },
    chats: (bot) => rowsOf(chatRows, bot),
    backSessions: backSessions((bot) => rowsOf(sessionRows, bot)),
    hostName: 'test',
    templates: { text: async () => undefined, lastChats: 10 },
    yaml,
    agents,
  });
  return { records, bots, graves, store, provider, problems, folder, config };
}

it('keeps a bot in the collection, and answers it from the cache', async () => {
  const { store, provider, problems } = await made();

  await provider.write('bot://motion', said({ name: 'Motion', instructions: 'Be brief.' }));

  // The cache is what a synchronous read is answered from, and it holds the
  // record the provider composed rather than what the write's body said.
  expect(store.get('motion')).toMatchObject({ id: 'motion', name: 'Motion', owner: 'root:test' });
  expect(store.all().map((one) => one.id)).toEqual(['motion']);
  expect(store.gone('motion')).toBe(false);
  expect(problems).toEqual([]);
});

it('writes the record without its persona, which is the file\'s', async () => {
  const { bots, provider, folder } = await made();

  await provider.write('bot://motion', said({ name: 'Motion', body: 'robot', instructions: 'Be brief.' }));

  // The record keeps what the file cannot say, and the persona is written into
  // the `AGENTS.md` the make leaves in the bot's folder.
  const kept = await bots.get('motion');
  expect(kept).not.toHaveProperty('name');
  expect(kept).not.toHaveProperty('instructions');
  expect(kept).toMatchObject({ id: 'motion', body: 'robot', workspace: join(folder, 'motion') });
  const file = readFileSync(join(folder, 'motion', 'AGENTS.md'), 'utf8');
  expect(file).toContain('name: Motion');
  expect(file).toContain('Be brief.');
});

it('leaves a tombstone where a bot is deleted, and refuses to make it again', async () => {
  const { graves, store, provider } = await made();
  await provider.write('bot://motion', said({ name: 'Motion' }));

  await provider.delete('bot://motion');

  expect(store.get('motion')).toBeUndefined();
  expect(store.gone('motion')).toBe(true);
  expect(await graves.get('motion')).toMatchObject({ id: 'motion' });
  // The name is spent: a client holding `bot://motion` is never handed another
  // bot under it, so the make is refused rather than allowed.
  await expect(provider.write('bot://motion', said({ name: 'Another' }))).rejects.toMatchObject({ code: -32010 });
});

it('reads the collections back, as a daemon that started again does', async () => {
  const { records, provider } = await made();
  await provider.write('bot://motion', said({ name: 'Motion' }));
  await provider.delete('bot://motion');
  await provider.write('bot://other', said({ name: 'Other' }));

  // A second store over the same collections, which is what a restart is.
  const problems: string[] = [];
  const again = botStore(
    await records.collection('bots'),
    await records.collection('bots-gone'),
    (line) => problems.push(line),
    { yaml, agents },
  );
  await again.ready();

  expect(again.all().map((one) => one.id)).toEqual(['other']);
  expect(again.gone('motion')).toBe(true);
  expect(problems).toEqual([]);
});

it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('keeps the persona in the record when its AGENTS.md cannot be read', async () => {
  const { bots, store, problems } = await made();
  const folder = join(root, 'bots', 'motion');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'AGENTS.md'), '---\nname: Motion\n---\n\n## Instructions\n\nBe brief.\n', { mode: 0o000 });
  await bots.put(bot('motion', { instructions: 'Be brief.' }));

  await store.ready();

  // The file is the one copy, but a file this host cannot read is not one it
  // may put the record back without: the persona stays in the record, and the
  // next load tries again.
  expect(store.get('motion')).toMatchObject({ instructions: 'Be brief.' });
  expect((await held(bots, 'motion'))['instructions']).toBe('Be brief.');
  expect(problems.join('\n')).toMatch(/bots\/motion was left in its record: its AGENTS\.md cannot be read/);
});

it('keeps the persona when a folder stands where its AGENTS.md should be', async () => {
  const { bots, store, problems } = await made();
  mkdirSync(join(root, 'bots', 'motion', 'AGENTS.md'), { recursive: true });
  await bots.put(bot('motion', { name: 'Motion', instructions: 'Be brief.' }));

  await store.ready();

  expect(store.get('motion')).toMatchObject({ name: 'Motion', instructions: 'Be brief.' });
  expect((await held(bots, 'motion'))['instructions']).toBe('Be brief.');
  expect(problems.join('\n')).toMatch(/bots\/motion was left in its record: its AGENTS\.md cannot be read/);
});

it('keeps the indentation of an older record\'s instructions through the move', async () => {
  const { bots, store, problems } = await made();
  await bots.put(bot('motion', { instructions: '    Be brief.' }));

  await store.ready();

  // The four spaces are the bot's own first line, and the file it is moved into
  // says them back the same.
  expect(store.get('motion')).toMatchObject({ instructions: '    Be brief.' });
  expect(readFileSync(join(root, 'bots', 'motion', 'AGENTS.md'), 'utf8')).toContain('    Be brief.');
  expect(problems).toEqual([]);
});

it('keeps the file\'s Instructions section when a move finds one', async () => {
  const { bots, store, problems } = await made();
  const folder = join(root, 'bots', 'motion');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'AGENTS.md'), '---\nversion: 1\nname: Motion\n---\n\n## Instructions\n\nThe bot\'s own words.\n');
  await bots.put(bot('motion', { instructions: 'The older copy.' }));

  await store.ready();

  // The file is the one copy: its section is the bot's writing, and the older
  // record's copy is dropped rather than written over it.
  expect(store.get('motion')).toMatchObject({ instructions: 'The bot\'s own words.' });
  expect(readFileSync(join(folder, 'AGENTS.md'), 'utf8')).toContain('The bot\'s own words.');
  expect(readFileSync(join(folder, 'AGENTS.md'), 'utf8')).not.toContain('The older copy.');
  expect((await held(bots, 'motion'))['instructions']).toBeUndefined();
  expect(problems).toEqual([]);
});

it('reports a record that is not a bot, and keeps every other one', async () => {
  const { bots, store, problems } = await made();
  await bots.put(bot('motion'));
  await bots.put(bot('broken', { color: 'chartreuse' }));

  await store.ready();

  expect(store.all().map((one) => one.id)).toEqual(['motion']);
  expect(problems.join('\n')).toMatch(/broken is not a bot record/);
});

it('answers a read of a bot that was put straight into the collection', async () => {
  const { bots, store, provider } = await made();
  await bots.put(bot('motion', { instructions: 'Be brief.' }));

  await store.ready();

  expect(await record(provider, 'bot://motion')).toMatchObject({ id: 'motion', name: 'motion' });
});

/*
 * A change made where the store is not looking: a person editing the file, or a
 * program writing to the store. The collection's watch is the one road in, and
 * what it does with the change is what these cases check.
 */

/** What one watcher on `bot://` was told, as `type slug` lines. */
const watching = async (provider: BotProvider): Promise<string[]> => {
  const heard: string[] = [];
  await provider.watch('bot://', {}, (changes) => {
    for (const change of changes) heard.push(`${change.type} ${change.uri.slice('bot://'.length)}`);
  });
  return heard;
};

it('takes a bot edited in the collection, and tells a watcher', async () => {
  const { bots, store, provider } = await made();
  await provider.write('bot://motion', said({ name: 'Motion' }));
  const heard = await watching(provider);

  // What a person's edit leaves behind: the record, written whole, with the
  // fields they did not touch as they were.
  await bots.put({ ...await held(bots, 'motion'), name: 'Motion two' });
  await new Promise((resolve) => { setTimeout(resolve, 5); });

  expect(heard).toEqual(['updated motion']);
  expect(store.get('motion')).toMatchObject({ name: 'Motion two' });
});

it('takes a bot put into the collection from outside, and tells a watcher', async () => {
  const { bots, provider } = await made();
  await provider.write('bot://motion', said({ name: 'Motion' }));
  const heard = await watching(provider);

  await bots.put(bot('other'));
  await new Promise((resolve) => { setTimeout(resolve, 5); });

  expect(heard).toEqual(['added other']);
  expect(await record(provider, 'bot://other')).toMatchObject({ id: 'other' });
});

it('buries a bot deleted in the collection, and refuses to make it again', async () => {
  const { bots, graves, store, provider } = await made();
  await provider.write('bot://motion', said({ name: 'Motion' }));
  const heard = await watching(provider);

  await bots.remove('motion');
  await new Promise((resolve) => { setTimeout(resolve, 5); });

  expect(heard).toEqual(['deleted motion']);
  expect(store.get('motion')).toBeUndefined();
  expect(store.gone('motion')).toBe(true);
  expect(await graves.get('motion')).toMatchObject({ id: 'motion' });
  await expect(provider.write('bot://motion', said({ name: 'Another' }))).rejects.toMatchObject({ code: -32010 });
});

it('refuses a bot file that comes back after its delete', async () => {
  const { records, bots, store, problems } = await made();
  await store.ready();
  await bots.put(bot('motion'));
  await new Promise((resolve) => { setTimeout(resolve, 5); });
  await bots.remove('motion');
  await new Promise((resolve) => { setTimeout(resolve, 5); });

  // The file put back, as an editor's restore or a copy left behind by a
  // delete that died: the name is spent, so it is no bot this store answers.
  await bots.put(bot('motion'));
  await new Promise((resolve) => { setTimeout(resolve, 5); });

  expect(store.get('motion')).toBeUndefined();
  expect(problems.join('\n')).toMatch(/bots\/motion has a tombstone; the name is spent/);

  // And a daemon that starts again finds it in the collection, and leaves it
  // out for the same reason: its folder is kept, and the bot is not.
  const again: string[] = [];
  const next = botStore(
    await records.collection('bots'),
    await records.collection('bots-gone'),
    (line) => again.push(line),
    { yaml, agents },
  );
  await next.ready();

  expect(next.get('motion')).toBeUndefined();
  expect(next.gone('motion')).toBe(true);
  expect(again.join('\n')).toMatch(/bots\/motion has a tombstone; the name is spent/);
});

it('leaves a bot alone when a hand edit changes its owner', async () => {
  const { bots, store, provider, problems } = await made();
  await provider.write('bot://motion', said({ name: 'Motion' }));
  const heard = await watching(provider);

  await bots.put({ ...await held(bots, 'motion'), owner: 'user:somebody-else' });
  await new Promise((resolve) => { setTimeout(resolve, 5); });

  expect(heard).toEqual([]);
  expect(store.get('motion')).toMatchObject({ owner: 'root:test' });
  expect(problems.join('\n')).toMatch(/motion changed owner/);
});

it('leaves a bot alone when a hand edit changes its workspace', async () => {
  const { bots, store, provider, problems } = await made();
  await provider.write('bot://motion', said({ name: 'Motion' }));
  const heard = await watching(provider);

  await bots.put({ ...await held(bots, 'motion'), workspace: '/tmp/elsewhere' });
  await new Promise((resolve) => { setTimeout(resolve, 5); });

  expect(heard).toEqual([]);
  expect(store.get('motion')).toMatchObject({ workspace: join(root, 'bots', 'motion') });
  expect(problems.join('\n')).toMatch(/motion changed workspace/);
});

it('reports a record that fails kept, and leaves the bot as it was', async () => {
  const { bots, store, provider, problems } = await made();
  await provider.write('bot://motion', said({ name: 'Motion' }));
  const heard = await watching(provider);

  await bots.put(bot('motion', { color: 'chartreuse' }));
  await new Promise((resolve) => { setTimeout(resolve, 5); });

  expect(heard).toEqual([]);
  expect(store.get('motion')).toMatchObject({ name: 'Motion' });
  expect((await record(provider, 'bot://motion'))['name']).toBe('Motion');
  expect(problems.join('\n')).toMatch(/motion is not a bot record/);
});

it('says a write made through the scheme once, and not again for the store', async () => {
  const { store, provider } = await made();
  await store.ready();
  const heard = await watching(provider);

  // The collection tells the store about the store's own put, and the store
  // tells the provider once: a write through `bot://` is one event, not two.
  await provider.write('bot://motion', said({ name: 'Motion' }));
  await new Promise((resolve) => { setTimeout(resolve, 5); });

  expect(heard).toEqual(['added motion']);
});

it('lists a saved bot whatever its body says, and gives one with no body the first suggestion', async () => {
  const { bots, store, provider, problems } = await made();
  await bots.put(bot('flame', { body: 'flame' }));
  const { body: _, ...bare } = bot('bare');
  await bots.put(bare as StoredRecord);
  await store.ready();

  expect(store.all().map((one) => one.id).sort()).toEqual(['bare', 'flame']);
  expect(store.get('flame')).toMatchObject({ body: 'flame' });
  expect(store.get('bare')).toMatchObject({ body: 'robot' });
  expect(problems).toEqual([]);

  // And an edit to another word is kept, rather than refused.
  await provider.write('bot://flame', said({ name: 'flame', body: 'spark' }));
  expect((await record(provider, 'bot://flame'))['body']).toBe('spark');
});

it('answers a listing asked for me with no reader as empty', async () => {
  const { provider } = await made();
  await provider.write('bot://motion', said({ name: 'Motion' }));

  // With no reader there is no one for `me` to name, so the filter keeps nothing.
  expect((await provider.list('bot://')).map((one) => one.name)).toEqual(['motion']);
  expect(await provider.list('bot://?owner=me')).toEqual([]);
});
