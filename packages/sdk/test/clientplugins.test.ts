import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { clientPluginsIn } from '../src/clientplugins.js';
import { uriOf } from '../src/fileuri.js';
import type { Clients } from '../src/types/host.js';

/*
 * A client's plugin, copied onto this host's disk.
 *
 * A plugin a client announces is a tree the client serves - `list` says what
 * is in a directory and `read` says what is in a file - and a backend here
 * cannot open a URI. What is checked here is the copy: what it writes, what it
 * does not write twice, what it drops when it has too many, and what it
 * answers when the client will not read.
 */

/** A tree as a client serves it: each directory by its URI, each file by its name. */
type Tree = Record<string, Record<string, string>>;

const PLUGIN = 'virtual://plugin/one';
const OTHER = 'virtual://plugin/two';

/** A plugin of two files and a subfolder, which is what a real one looks like, and a second one beside it. */
const tree = (): Tree => ({
  [PLUGIN]: { 'plugin.json': '{"name":"one"}', '.mcp.json': '{"mcpServers":{}}' },
  [`${PLUGIN}/tools`]: { 'a.ts': 'export {}' },
  [OTHER]: { 'plugin.json': '{}' },
});

/** A client that serves one tree, and counts what it was asked for. */
function serving(tree: Tree, broken: string[] = []): { clients: () => Clients; asked: string[] } {
  const asked: string[] = [];
  const clients = {
    ids: () => ['plugin'],
    owner: () => 'plugin',
    list: async (_client: string, uri: string) => {
      asked.push(`list ${uri}`);
      const node = tree[uri];
      if (node === undefined) throw new Error(`${uri} is not a directory`);
      const prefix = uri.endsWith('/') ? uri : `${uri}/`;
      // A URI under this one with no further separator is a directory of its
      // own, which is how a client's listing says so.
      const below = Object.keys(tree)
        .filter((one) => one.startsWith(prefix) && !one.slice(prefix.length).includes('/'))
        .map((one) => ({ name: one.slice(prefix.length), type: 'directory' }));
      return {
        entries: [...Object.keys(node).map((name) => ({ name, type: 'file' })), ...below],
      };
    },
    read: async (_client: string, uri: string) => {
      asked.push(`read ${uri}`);
      if (broken.includes(uri)) throw new Error('the client has no such file');
      const slash = uri.lastIndexOf('/');
      const leaf = tree[uri.slice(0, slash)]?.[uri.slice(slash + 1)];
      if (typeof leaf !== 'string') throw new Error(`${uri} is not a file`);
      return { data: leaf, encoding: 'utf-8' };
    },
  } as unknown as Clients;
  return { clients: () => clients, asked };
}

/** One plugin that will not read, and a directory of this test's own so its copies are nobody else's. */
const unreadable = (): { clients: () => Clients; dir: string } => ({
  ...serving({ ...tree(), [PLUGIN]: { 'plugin.json': '{}', 'gone.ts': 'x' } }, [`${PLUGIN}/gone.ts`]),
  dir: mkdtempSync(join(tmpdir(), 'ahpd-clientplugins-')),
});

const place = (): string => mkdtempSync(join(tmpdir(), 'ahpd-clientplugins-'));

const dirs = (under: string): string[] => readdirSync(under).sort();

/** What a plugin is filed under, which is its URI with everything but letters and digits turned to dashes. */
const KEY = 'virtual---plugin-one';

it('copies a whole plugin and answers the directory it landed in', async () => {
  const dir = place();
  const port = clientPluginsIn(dir, serving(tree()).clients);

  const [answer] = await port.sync('plugin', [{ uri: PLUGIN, nonce: 'n1' }]);

  expect(answer).toEqual({ uri: PLUGIN, nonce: 'n1', path: join(dir, KEY, 'n1') });
  expect(dirs(join(dir, KEY, 'n1'))).toEqual(['.mcp.json', 'plugin.json', 'tools']);
  expect(readFileSync(join(dir, KEY, 'n1', 'tools', 'a.ts'), 'utf8')).toBe('export {}');
  expect(readFileSync(join(dir, KEY, 'n1', 'plugin.json'), 'utf8')).toBe('{"name":"one"}');
  rmSync(dir, { recursive: true, force: true });
});

it('reads nothing from a client whose plugin it already has', async () => {
  const dir = place();
  const { clients, asked } = serving(tree());
  const port = clientPluginsIn(dir, clients);

  await port.sync('plugin', [{ uri: PLUGIN, nonce: 'n1' }]);
  const reads = asked.length;
  const [again] = await port.sync('plugin', [{ uri: PLUGIN, nonce: 'n1' }]);

  // The second announcement is the same plugin: the copy is the answer, and a
  // byte crossing the connection for it would be a byte thrown away.
  expect(again).toEqual({ uri: PLUGIN, nonce: 'n1', path: join(dir, KEY, 'n1') });
  expect(asked).toHaveLength(reads);
  rmSync(dir, { recursive: true, force: true });
});

it('copies again when the client says the plugin changed', async () => {
  const dir = place();
  const { clients, asked } = serving(tree());
  const port = clientPluginsIn(dir, clients);

  await port.sync('plugin', [{ uri: PLUGIN, nonce: 'n1' }]);
  const [second] = await port.sync('plugin', [{ uri: PLUGIN, nonce: 'n2' }]);

  // A new nonce is a new body, and the old copy stays where it is: a turn
  // already reading it is not made to read something else.
  expect(second).toEqual({ uri: PLUGIN, nonce: 'n2', path: join(dir, KEY, 'n2') });
  expect(asked.filter((one) => one.startsWith('read'))).toHaveLength(6);
  expect(dirs(join(dir, KEY))).toEqual(['n1', 'n2']);
  rmSync(dir, { recursive: true, force: true });
});

it('files a plugin with no nonce under one name, so announcing it twice is announcing one plugin', async () => {
  const dir = place();
  const { clients, asked } = serving(tree());
  const port = clientPluginsIn(dir, clients);

  const [first] = await port.sync('plugin', [{ uri: PLUGIN }]);
  const reads = asked.length;
  const [second] = await port.sync('plugin', [{ uri: PLUGIN }]);

  expect(first).toEqual({ uri: PLUGIN, path: join(dir, KEY, 'default') });
  expect(second).toEqual(first);
  expect(asked).toHaveLength(reads);
  rmSync(dir, { recursive: true, force: true });
});

it('files a plugin with an empty nonce under the same name as one with none', async () => {
  const dir = place();
  const { clients } = serving(tree());
  const port = clientPluginsIn(dir, clients);

  const [synced] = await port.sync('plugin', [{ uri: PLUGIN, nonce: '' }]);

  expect(synced).toEqual({ uri: PLUGIN, nonce: '', path: join(dir, KEY, 'default') });
  rmSync(dir, { recursive: true, force: true });
});

it('keeps eight revisions of one plugin and lets the oldest go', async () => {
  const dir = place();
  const port = clientPluginsIn(dir, serving(tree()).clients);

  for (let n = 1; n <= 9; n++) await port.sync('plugin', [{ uri: PLUGIN, nonce: `n${String(n)}` }]);

  // Nine announced, eight kept, and the one that went is the one nobody has
  // asked for since it was copied.
  expect(dirs(join(dir, KEY))).toEqual(['n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9']);
  rmSync(dir, { recursive: true, force: true });
});

it('answers the error a read failed with and leaves no half-built copy', async () => {
  const { clients, dir } = unreadable();

  const [answer] = await clientPluginsIn(dir, clients).sync('plugin', [{ uri: PLUGIN, nonce: 'n1' }]);

  expect(answer).toEqual({ uri: PLUGIN, nonce: 'n1', error: 'the client has no such file' });
  // Nothing that looks like the plugin: a directory holding half of one is a
  // directory a backend would run.
  expect(existsSync(join(dir, KEY, 'n1'))).toBe(false);
  expect(dirs(dir)).toEqual([]);
  rmSync(dir, { recursive: true, force: true });
});

it('answers one plugin\'s failure without losing the plugin beside it', async () => {
  const { clients, dir } = unreadable();

  const answers = await clientPluginsIn(dir, clients).sync('plugin', [
    { uri: PLUGIN, nonce: 'n1' },
    { uri: OTHER, nonce: 'n1' },
  ]);

  // Two announced, two answered, in the order given: a plugin a client asked
  // for is not lost to the one beside it that would not read.
  expect(answers).toHaveLength(2);
  expect(answers[0]).toHaveProperty('error');
  expect(answers[1]).toEqual({ uri: OTHER, nonce: 'n1', path: join(dir, 'virtual---plugin-two', 'n1') });
  rmSync(dir, { recursive: true, force: true });
});

it('uses a copy already under the directory where it is, without asking a client', async () => {
  const dir = place();
  const folder = join(dir, 'captured', 'one');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'plugin.json'), '{}');
  const { clients, asked } = serving({});
  const port = clientPluginsIn(dir, clients);

  // An automation runs with no client connected: its plugins are copies this
  // host made earlier, named as the paths they are.
  expect(await port.sync('nobody', [{ uri: uriOf(folder), nonce: 'n1' }]))
    .toEqual([{ uri: uriOf(folder), nonce: 'n1', path: folder }]);
  expect(asked).toEqual([]);
  rmSync(dir, { recursive: true, force: true });
});

it('finds the copies an earlier host made through the order it wrote down', async () => {
  const dir = place();
  await clientPluginsIn(dir, serving(tree()).clients).sync('plugin', [{ uri: PLUGIN, nonce: 'n1' }]);

  // A daemon that started again has the directory and no memory of it, so what
  // it holds is read back from the file beside the copies.
  const second = serving(tree());
  const [answer] = await clientPluginsIn(dir, second.clients).sync('plugin', [{ uri: PLUGIN, nonce: 'n1' }]);
  expect(answer).toEqual({ uri: PLUGIN, nonce: 'n1', path: join(dir, KEY, 'n1') });
  expect(second.asked).toEqual([]);

  // And a revision arriving after the restart goes on the end of the order,
  // oldest first, which is the end the limits take from.
  await clientPluginsIn(dir, second.clients).sync('plugin', [{ uri: PLUGIN, nonce: 'n2' }]);
  expect(JSON.parse(readFileSync(join(dir, 'lru.json'), 'utf8'))).toEqual({
    copies: [
      { uri: PLUGIN, nonce: 'n1' },
      { uri: PLUGIN, nonce: 'n2' },
    ],
  });
  rmSync(dir, { recursive: true, force: true });
});
