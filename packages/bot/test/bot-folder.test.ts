import { loggerOf } from '@ahpd/sdk';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { fileRecords } from '../../server/src/records.js';
import { pluginHost } from '../../sdk/src/plugins/plugins.js';
import { memoryRecords } from '../../sdk/src/resources/records.js';
import { memorySessions } from '../../sdk/src/sessions/sessions.js';
import { sdkVersion } from '../../sdk/src/version.js';
import { AGENTS_FILE, CLAUDE_FILE, prepareAgentsTemplate, prepareFolder } from '../src/folder.js';
import { apply } from '../src/plugin.js';
import { agentsFilled, agentsTemplatePath, agentsTextOf, DEFAULT_AGENTS_TEMPLATE } from '../src/template.js';
import type { BotRecord } from '../src/record.js';
import type { LoaderContext } from '../../sdk/src/types/plugin.js';

/*
 * The files a bot's folder holds, and the template that makes them.
 *
 * `AGENTS.md` is the bot's rules and `CLAUDE.md` is the one line that makes
 * Claude read them. The rules come from the bot's template, filled with its
 * words; a bot that names no template gets the file ahpd ships under
 * `<configDir>/templates/bots/`, which the plugin writes at load and a person
 * may edit. Neither file is ever written over: a bot that writes its own rules,
 * or a person who wrote some, is the one the next message is answered by.
 */

/** A temporary directory removed after the test that made it. */
let loose: string[] = [];
afterEach(() => {
  for (const dir of loose) rmSync(dir, { recursive: true, force: true });
  loose = [];
});

/** A directory of its own for one case. */
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-bot-folder-'));
  loose.push(dir);
  return dir;
};

/** The daemon's configuration folder, as the plugin is given it. */
const configDir = (): string => join(temp(), 'config');

/** The folder a bot works in, which does not exist yet. */
const folder = (): string => join(temp(), 'bot');

/** A file in a folder as it is on disk. */
const read = (dir: string, name: string): string => readFileSync(join(dir, name), 'utf8');

/** One bot, as its store holds it. */
const bot = (over: Partial<BotRecord> = {}): BotRecord => ({
  id: 'backer',
  name: 'Backer',
  labels: [],
  body: 'robot',
  color: 'red',
  session: 'work',
  workspace: '/bots/backer',
  owner: 'user:soft',
  createdAt: '2026-10-16T00:00:00.000Z',
  updatedAt: '2026-10-16T00:00:00.000Z',
  ...over,
});

/** A reader of named templates, holding the text each name stands for. */
const templates = (held: Record<string, string>) => ({
  text: async (name: string): Promise<string | undefined> => held[name],
});

/** A daemon's plugin host, with the bot plugin applied over one configuration folder. */
function loaded(config: string, root = join(temp(), 'bots')): string[] {
  const reported: string[] = [];
  const path = temp();
  const context: LoaderContext = {
    path, paths: [path], version: sdkVersion(), hostName: 'test', configDir: config, log: loggerOf(() => {}), say: () => {},
  };
  const { host } = pluginHost('bot', context, {
    sessions: () => memorySessions(),
    records: () => memoryRecords(),
    alert: (alert) => { reported.push(alert.text); },
  });
  apply(host, { root });
  return reported;
}

it('writes a bot with no template the default AGENTS.md, filled with its words', async () => {
  const config = configDir();
  prepareAgentsTemplate(config);
  const dir = folder();
  const record = bot({ description: 'A careful reviewer.', instructions: 'Be calm.' });

  prepareFolder(dir, await agentsTextOf(record, templates({}), config));

  // The file the plugin ships is the text ahpd wrote, and the bot gets it with
  // its own words in place of the three.
  expect(read(config, join('templates', 'bots', 'AGENTS.md'))).toBe(DEFAULT_AGENTS_TEMPLATE);
  expect(read(dir, AGENTS_FILE)).toBe(agentsFilled(record, DEFAULT_AGENTS_TEMPLATE));
  expect(read(dir, AGENTS_FILE)).toContain('name: Backer');
  expect(read(dir, AGENTS_FILE)).toContain('A careful reviewer.');
  expect(read(dir, AGENTS_FILE)).toContain('Be calm.');
  // The import is the whole of CLAUDE.md: Claude reads that file, and the line
  // is what puts AGENTS.md in front of it.
  expect(read(dir, CLAUDE_FILE)).toBe('@AGENTS.md\n');
});

it('writes a bot that names a template that template\'s text', async () => {
  const dir = folder();
  const record = bot({ template: 'short', description: 'A careful reviewer.', instructions: 'Be calm.' });

  prepareFolder(dir, await agentsTextOf(record, templates({ short: '# {{name}}\n\n{{description}}\n\n{{instructions}}\n' }), configDir()));

  expect(read(dir, AGENTS_FILE)).toBe('# Backer\n\nA careful reviewer.\n\nBe calm.\n');
});

it('writes the default template at load, and keeps a file somebody edited', () => {
  const config = configDir();
  loaded(config);
  expect(readFileSync(agentsTemplatePath(config), 'utf8')).toBe(DEFAULT_AGENTS_TEMPLATE);

  // The file is the person's once they wrote it: a daemon that starts again
  // does not put the shipped text back over theirs.
  writeFileSync(agentsTemplatePath(config), '# Our bots\n\nAsk before pushing.\n');
  loaded(config);
  expect(readFileSync(agentsTemplatePath(config), 'utf8')).toBe('# Our bots\n\nAsk before pushing.\n');
});

it('refuses a root inside the configuration folder, and uses the default', () => {
  const config = configDir();

  // A work folder there is one bad delete away from the records: the option is
  // not used, and the problem names both folders and the root that takes its
  // place.
  const problems = loaded(config, join(config, 'bots'));
  expect(problems.join('\n')).toMatch(/root .* is inside the configuration folder .*; using .*\.bots/);
});

it('leaves an AGENTS.md in the bot folder alone', () => {
  const dir = folder();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, AGENTS_FILE), '# Our rules\n\nAsk before pushing.\n');
  writeFileSync(join(dir, CLAUDE_FILE), '@AGENTS.md\n\nAnd read the README.\n');

  prepareFolder(dir, '# Backer\n\n## How you work\n');

  // The folder is the bot's own document once anything is there, and a later
  // wake is not the place to decide otherwise.
  expect(read(dir, AGENTS_FILE)).toBe('# Our rules\n\nAsk before pushing.\n');
  expect(read(dir, CLAUDE_FILE)).toBe('@AGENTS.md\n\nAnd read the README.\n');
});

it('uses the text ahpd ships when the default file cannot be read', async () => {
  const record = bot();

  // No file was ever written under this configuration folder, so the plugin is
  // not left without a maker: the text it ships is the text it uses.
  expect(await agentsTextOf(record, templates({}), configDir())).toBe(agentsFilled(record, DEFAULT_AGENTS_TEMPLATE));
});

it('keeps the default template out of the templates collection', async () => {
  const config = configDir();
  prepareAgentsTemplate(config);
  const problems: string[] = [];

  const collection = await fileRecords(config, { onProblem: (line) => problems.push(line) })
    .collection('templates', { body: 'text' });

  // `bots/` is a folder, and a collection reads the `.md` files directly in
  // its own folder: the default template is not a record and is not reported.
  expect(await collection.list()).toEqual([]);
  expect(await collection.get('bots')).toBeUndefined();
  expect(problems).toEqual([]);
});
