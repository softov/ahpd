import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { optionsSchema } from '../src/plugin.js';

/*
 * The plugin's options, held to the schema it exports.
 *
 * The loader checks them before `apply`, so a value of the wrong type is
 * reported with the plugin's name and the key, and the plugin is skipped
 * without running. The README's options table is what a person configures
 * from, so the schema declares what it lists.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-cofold/src/index.ts';
const NAME = '@ahpd/agent-cofold';

/** Options that pass, which each case spoils one key of. */
const VALID: Record<string, unknown> = {};

/** The option names the schema declares. */
const declared = (): string[] => Object.keys((optionsSchema as { properties: Record<string, unknown> }).properties);

/** The option names the first options table in the README lists. */
const documented = (): string[] => {
  const lines = readFileSync(join(import.meta.dirname, '../README.md'), 'utf8').split('\n');
  const start = lines.findIndex((line) => /^\| option \|/iu.test(line));
  const names: string[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const found = /^\| `([^`]+)` \|/u.exec(line);
    if (found?.[1] !== undefined) names.push(found[1]);
  }
  return names;
};

const load = (options: Record<string, unknown>) => loadPlugins([{ name: SOURCE, options }], {
  base: { path: '/tmp/agent-cofold-options', agents: [echo({ path: '/tmp/agent-cofold-options' })] },
  configDir: REPO,
  cwd: REPO,
  log: () => {},
});

it('declares every option its README lists, and no other', () => {
  expect(declared().sort()).toEqual(documented().sort());
});

it.each<[string, unknown]>([
  ['provider', 5],
  ['displayName', 5],
  ['description', 5],
  ['model', 5],
  ['baseUrl', 5],
  ['instructions', 5],
  ['computerConfigDir', 5],
  ['store', 5],
  ['memory', 'yes'],
  ['tools', 'all'],
  ['apiKey', 5],
  ['resource', 5],
  ['adapter', 'x'],
  ['policy', 'x'],
])('reports %s of the wrong type and skips the plugin', async (key, value) => {
  const { loaded, problems } = await load({ ...VALID, [key]: value });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatch(new RegExp(`^plugin ${NAME} skipped: plugins\\.${NAME}\\.options\\.${key} must be `, 'u'));
  expect(loaded).toEqual([]);
});

it('reports a tools switch of the wrong type by its full key', async () => {
  const { problems } = await load({ tools: { files: 'no' } });
  expect(problems).toEqual([`plugin ${NAME} skipped: plugins.${NAME}.options.tools.files must be true or false`]);
});

it('takes computerConfigDir as a directory and as false', async () => {
  for (const value of ['/srv/cofold-home', false]) {
    const { loaded, problems } = await load({ ...VALID, computerConfigDir: value });
    expect(problems).toEqual([]);
    expect(loaded).toHaveLength(1);
  }
});
