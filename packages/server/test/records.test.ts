import { WAIT_MS } from '../../../tools/wait.ts';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordChange, RecordCollection } from '@ahpd/sdk';
import { echo } from '../../../examples/echo/agent.js';
import { loadPlugins } from '../src/plugins.js';
import { fileRecords, readRecordFile, recordFile } from '../src/records.js';
import { posix } from '../../../tools/posix.ts';

/*
 * The daemon's record store: a folder per collection, a Markdown or JSON file
 * per record, and a watch that reads a hand edit again.
 */

let dir: string;
let problems: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ahpd-records-'));
  problems = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const store = () => fileRecords(dir, { onProblem: (message) => { problems.push(message); } });

const bot = {
  id: 'helper',
  name: 'Helper',
  labels: ['a', 'b'],
  count: 2,
  instructions: 'Answer briefly.\n\nUse the tools: a, b.\n',
};

/** Every change a collection tells, from now on. */
const heard = (collection: RecordCollection): RecordChange[] => {
  const changes: RecordChange[] = [];
  collection.watch((change) => { changes.push(change); });
  return changes;
};

describe('recordFile and readRecordFile', () => {
  it('writes the fields as frontmatter and the body field as the body', () => {
    const text = recordFile(bot, 'instructions');

    expect(text).toBe('---\nid: helper\nname: Helper\nlabels:\n  - a\n  - b\ncount: 2\n---\nAnswer briefly.\n\nUse the tools: a, b.\n\n');
    expect(readRecordFile(text, 'instructions')).toEqual(bot);
  });

  it('writes an empty body where the collection has no body field', () => {
    const text = recordFile({ id: 'one', note: 'x' });

    expect(text).toBe('---\nid: one\nnote: x\n---\n');
    expect(readRecordFile(`${text}text nobody asked for\n`)).toEqual({ id: 'one', note: 'x' });
  });

  it('reads a body an editor saved without its last newline', () => {
    expect(readRecordFile('---\nid: one\n---\nhello', 'text')).toEqual({ id: 'one', text: 'hello' });
  });

  it('refuses a file with no frontmatter, or a frontmatter that is not a mapping', () => {
    expect(() => readRecordFile('id: one\n')).toThrow('---');
    expect(() => readRecordFile('---\nid: one\n')).toThrow('closing');
    expect(() => readRecordFile('---\n- one\n---\n')).toThrow('mapping');
  });
});

describe('fileRecords', () => {
  it('keeps a record with a multi-line body as plain text below the frontmatter', async () => {
    const bots = await store().collection('bots', { body: 'instructions' });
    await bots.put(bot);

    const file = join(dir, 'bots', 'helper.md');
    const text = readFileSync(file, 'utf8');
    expect(text.endsWith('---\nAnswer briefly.\n\nUse the tools: a, b.\n\n')).toBe(true);
    // A POSIX mode, which Windows has none of.
    if (posix) expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(await bots.get('helper')).toEqual(bot);
  });

  it('reads back what it put, from a store opened again', async () => {
    const bots = await store().collection('bots', { body: 'instructions' });
    await bots.put(bot);
    await bots.put({ id: 'other', name: 'Other', owner: 'ana' });

    const again = await store().collection('bots', { body: 'instructions' });
    expect(await again.get('helper')).toEqual(bot);
    expect(await again.get('other')).toEqual({ id: 'other', name: 'Other', owner: 'ana', instructions: '' });
    expect((await again.list()).map((one) => one.id).sort()).toEqual(['helper', 'other']);
    expect(await again.find({ owner: 'ana' })).toEqual([{ id: 'other', name: 'Other', owner: 'ana', instructions: '' }]);
  });

  it('keeps each record of a file collection in a folder of its own, and lists it after a restart', async () => {
    const bots = await store().collection('bots', { file: 'bot', body: 'instructions' });
    await bots.put(bot);
    // Another folder beside the record file, which is not a record of this
    // collection: a bot's chats sit beside its `bot.md`.
    mkdirSync(join(dir, 'bots', 'helper', 'chats'));

    expect(readFileSync(join(dir, 'bots', 'helper', 'bot.md'), 'utf8')).toBe(recordFile(bot, 'instructions'));
    const again = await store().collection('bots', { file: 'bot', body: 'instructions' });
    expect((await again.list()).map((one) => one.id)).toEqual(['helper']);
    expect(await again.get('helper')).toEqual(bot);
    expect(problems).toEqual([]);
  });

  it('tells a watcher of a hand edit of a file collection record', async () => {
    const bots = await store().collection('bots', { file: 'bot', body: 'instructions' });
    const changes = heard(bots);
    await bots.put(bot);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(changes).toEqual([{ id: 'helper', type: 'added' }]);

    writeFileSync(join(dir, 'bots', 'helper', 'bot.md'), recordFile({ ...bot, name: 'Edited' }, 'instructions'));
    await vi.waitFor(() => { expect(changes).toHaveLength(2); }, { timeout: WAIT_MS });
    expect(changes[1]).toEqual({ id: 'helper', type: 'updated' });
    expect(await bots.get('helper')).toEqual({ ...bot, name: 'Edited' });
  });

  it('tells a watcher of a file collection record folder made and removed by hand', async () => {
    const bots = await store().collection('bots', { file: 'bot', body: 'instructions' });
    const changes = heard(bots);

    mkdirSync(join(dir, 'bots', 'helper'));
    writeFileSync(join(dir, 'bots', 'helper', 'bot.md'), recordFile(bot, 'instructions'));
    await vi.waitFor(() => { expect(changes).toEqual([{ id: 'helper', type: 'added' }]); }, { timeout: WAIT_MS });
    expect(await bots.get('helper')).toEqual(bot);

    rmSync(join(dir, 'bots', 'helper'), { recursive: true });
    await vi.waitFor(() => { expect(changes).toHaveLength(2); }, { timeout: WAIT_MS });
    expect(changes[1]).toEqual({ id: 'helper', type: 'deleted' });
    expect(await bots.get('helper')).toBeUndefined();
  });

  it('opens a collection at a path of slugs, in a folder under the first', async () => {
    const chats = await store().collection('bots/helper/chats');
    await chats.put({ id: 'row-1', bot: 'helper', chat: 'session:1' });

    expect(existsSync(join(dir, 'bots', 'helper', 'chats', 'row-1.md'))).toBe(true);
    const again = await store().collection('bots/helper/chats');
    expect(await again.get('row-1')).toEqual({ id: 'row-1', bot: 'helper', chat: 'session:1' });
  });

  it('refuses a record whose id is not a slug, and a body that is not text', async () => {
    const bots = await store().collection('bots', { body: 'instructions' });

    await expect(bots.put({ id: 'Not A Slug' })).rejects.toThrow('not a record id');
    await expect(bots.put({ id: 'one', instructions: 3 })).rejects.toThrow('body');
    await expect(store().collection('../up')).rejects.toThrow('not a collection name');
  });

  it('refuses a collection named after a folder the daemon keeps its own files in', async () => {
    mkdirSync(join(dir, 'sessions'));
    writeFileSync(join(dir, 'sessions', 'abc.json'), JSON.stringify({ id: 'abc' }));

    await expect(store().collection('sessions')).rejects.toThrow('the daemon keeps its own files');
    // A path is refused by its first slug: everything under `sessions` is the
    // daemon's own too.
    await expect(store().collection('sessions/abc/chats')).rejects.toThrow('the daemon keeps its own files');
    await expect(store().collection('usage')).rejects.toThrow('the daemon keeps its own files');
    // The automations folder is one of them since an automation is a file
    // there, so a collection of that name would be the daemon's own automations
    // read and written by a plugin.
    await expect(store().collection('automations')).rejects.toThrow('the daemon keeps its own files');
    expect(existsSync(join(dir, 'sessions', 'abc.json'))).toBe(true);

    // `bots` is not reserved: that folder is the bot plugin's, and the plugin
    // opens it through this store.
    await expect(store().collection('bots')).resolves.toBeDefined();
  });

  it('refuses to remove a record whose id is not a slug', async () => {
    const bots = await store().collection('bots');
    writeFileSync(join(dir, 'outside.md'), 'kept\n');

    await expect(bots.remove('../outside')).rejects.toThrow('not a record id');
    expect(existsSync(join(dir, 'outside.md'))).toBe(true);
  });

  it('removes a record and its file', async () => {
    const bots = await store().collection('bots');
    await bots.put({ id: 'one' });

    expect(await bots.remove('one')).toBe(true);
    expect(await bots.remove('one')).toBe(false);
    expect(existsSync(join(dir, 'bots', 'one.md'))).toBe(false);
  });

  it('converts each <id>.json once, and keeps it as <id>.json.migrated', async () => {
    const folder = join(dir, 'bots');
    mkdirSync(folder);
    writeFileSync(join(folder, 'helper.json'), JSON.stringify(bot));
    writeFileSync(join(folder, 'wrong.json'), JSON.stringify({ id: 'other' }));

    const bots = await store().collection('bots', { body: 'instructions' });
    expect(await bots.get('helper')).toEqual(bot);
    expect(existsSync(join(folder, 'helper.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(folder, 'helper.json.migrated'), 'utf8'))).toEqual(bot);
    expect(existsSync(join(folder, 'wrong.json'))).toBe(true);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('wrong.json');

    // A second start finds the Markdown file and converts nothing.
    writeFileSync(join(folder, 'helper.json'), JSON.stringify({ ...bot, name: 'Stale' }));
    const again = await store().collection('bots', { body: 'instructions' });
    expect(await again.get('helper')).toEqual(bot);
    expect(existsSync(join(folder, 'helper.json'))).toBe(true);
  });

  it('refuses a file whose frontmatter id is not its file name', async () => {
    const folder = join(dir, 'bots');
    mkdirSync(folder);
    writeFileSync(join(folder, 'one.md'), '---\nid: two\n---\n');

    const bots = await store().collection('bots');
    expect(await bots.list()).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('one.md');
  });

  it('tells a watcher of a hand edit as updated, and of its own put once', async () => {
    const bots = await store().collection('bots', { body: 'instructions' });
    const changes = heard(bots);
    await bots.put(bot);

    // Long enough for the watch to have seen the store's own write.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(changes).toEqual([{ id: 'helper', type: 'added' }]);

    writeFileSync(join(dir, 'bots', 'helper.md'), recordFile({ ...bot, name: 'Edited' }, 'instructions'));
    await vi.waitFor(() => { expect(changes).toHaveLength(2); }, { timeout: WAIT_MS });
    expect(changes[1]).toEqual({ id: 'helper', type: 'updated' });
    expect(await bots.get('helper')).toEqual({ ...bot, name: 'Edited' });

    writeFileSync(join(dir, 'bots', 'new.md'), '---\nid: new\n---\nhi\n');
    await vi.waitFor(() => { expect(changes).toHaveLength(3); }, { timeout: WAIT_MS });
    expect(changes[2]).toEqual({ id: 'new', type: 'added' });

    rmSync(join(dir, 'bots', 'new.md'));
    await vi.waitFor(() => { expect(changes).toHaveLength(4); }, { timeout: WAIT_MS });
    expect(changes[3]).toEqual({ id: 'new', type: 'deleted' });
  });

  it('reports a file with a broken frontmatter, and keeps the record from before', async () => {
    const bots = await store().collection('bots', { body: 'instructions' });
    const changes = heard(bots);
    await bots.put(bot);

    writeFileSync(join(dir, 'bots', 'helper.md'), '---\nid: helper\nname: [unclosed\n');
    await vi.waitFor(() => { expect(problems).toHaveLength(1); }, { timeout: WAIT_MS });
    expect(problems[0]).toContain('helper.md');
    expect(changes).toEqual([{ id: 'helper', type: 'added' }]);
    expect(await bots.get('helper')).toEqual(bot);
  });
});

describe('a collection that keeps JSON records', () => {
  const connector = {
    id: 'first',
    kind: 'webhook',
    options: { url: 'https://example.test/hook', sign: true },
  };

  it('writes <id>.json, and a new store reads it back', async () => {
    const connectors = await store().collection('connectors', { format: 'json' });
    await connectors.put(connector);

    const file = join(dir, 'connectors', 'first.json');
    expect(readFileSync(file, 'utf8')).toBe(`${JSON.stringify(connector, null, 2)}\n`);
    // A POSIX mode, which Windows has none of.
    if (posix) expect(statSync(file).mode & 0o777).toBe(0o600);

    const again = await store().collection('connectors', { format: 'json' });
    expect(await again.get('first')).toEqual(connector);
    expect(await again.list()).toEqual([connector]);
    expect(await again.find({ kind: 'webhook' })).toEqual([connector]);
    // A JSON collection has neither a body field nor a migration to report.
    expect(problems).toEqual([]);
  });

  it('tells a watcher of a hand edit of a .json file', async () => {
    const connectors = await store().collection('connectors', { format: 'json' });
    const changes = heard(connectors);
    await connectors.put(connector);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(changes).toEqual([{ id: 'first', type: 'added' }]);

    writeFileSync(join(dir, 'connectors', 'first.json'), `${JSON.stringify({ ...connector, title: 'Edited' }, null, 2)}\n`);
    await vi.waitFor(() => { expect(changes).toHaveLength(2); }, { timeout: WAIT_MS });
    expect(changes[1]).toEqual({ id: 'first', type: 'updated' });
    expect(await connectors.get('first')).toEqual({ ...connector, title: 'Edited' });
  });

  it('does not turn a .json file into .md', async () => {
    const folder = join(dir, 'connectors');
    mkdirSync(folder);
    writeFileSync(join(folder, 'first.json'), JSON.stringify(connector));

    const connectors = await store().collection('connectors', { format: 'json' });
    expect(await connectors.get('first')).toEqual(connector);
    expect(existsSync(join(folder, 'first.md'))).toBe(false);
    expect(existsSync(join(folder, 'first.json.migrated'))).toBe(false);
    expect(problems).toEqual([]);
  });

  it('reports a .json file that does not parse, and keeps the record from before', async () => {
    const connectors = await store().collection('connectors', { format: 'json' });
    await connectors.put(connector);

    writeFileSync(join(dir, 'connectors', 'first.json'), '{"id": "first",');
    await vi.waitFor(() => { expect(problems).toHaveLength(1); }, { timeout: WAIT_MS });
    expect(problems[0]).toContain('first.json');
    expect(await connectors.get('first')).toEqual(connector);
  });

  it('refuses a body field and a file of its own', async () => {
    await expect(store().collection('connectors', { format: 'json', body: 'text' })).rejects.toThrow('no body field');
    await expect(store().collection('connectors', { format: 'json', file: 'connector' })).rejects.toThrow('no file of its own');
  });
});

describe('the loader', () => {
  it('gives a plugin a collection over the folded store, and refuses its name to a second plugin', async () => {
    const here = import.meta.dirname;
    const base = { path: '/tmp/plugin-records', agents: [echo({ path: '/tmp/plugin-records' })], records: fileRecords(dir) };
    const loaded = await loadPlugins(['./fixtures/plugin-notes/index.ts', './fixtures/plugin-notes-again/index.ts'], {
      base,
      configDir: join(here, 'fixtures'),
      cwd: here,
      log: () => {},
    });

    expect(loaded.loaded.map((one) => one.name)).toEqual(['notes']);
    expect(loaded.problems).toHaveLength(1);
    expect(loaded.problems[0]).toContain('plugin notes opened it');

    const notes = (globalThis as Record<string, unknown>).__notesCollection as RecordCollection | undefined;
    await notes?.put({ id: 'first', text: 'A note.' });
    expect(readFileSync(join(dir, 'notes', 'first.md'), 'utf8')).toBe('---\nid: first\n---\nA note.\n');
  });
});
