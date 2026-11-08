import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import manifest from '../package.json' with { type: 'json' };

/*
 * The plugin's options, held to the schema its manifest declares.
 *
 * The loader checks them before `apply`, so a value of the wrong type is
 * reported with the plugin's name and the key, and the plugin is skipped
 * without running. The README's options table is what a person configures
 * from, so the schema declares what it lists.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-cofold/src/index.ts';
const NAME = 'agent-cofold';
const optionsSchema = manifest.ahpd.optionsSchema;

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
  ['model', 5],
  ['baseUrl', 5],
  ['instructions', 5],
  ['computerConfigDir', 5],
  ['store', 5],
  ['memory', 'yes'],
  ['tools', 'all'],
  ['strictTools', 'yes'],
  ['apiKey', 5],
  ['resource', 5],
])('reports %s of the wrong type and skips the plugin', async (key, value) => {
  const { loaded, problems } = await load({ ...VALID, [key]: value });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatch(new RegExp(`^plugin ${NAME} skipped: plugins\\.${NAME}\\.options\\.${key} must be `, 'u'));
  expect(loaded).toEqual([]);
});

/*
 * `adapter` and `policy` are an embedder's, not a configuration's.
 *
 * They are not in the schema, so the loader says it does not know them and lets
 * them through, and the plugin holds them whatever type they are: the schema is
 * not closed, which is what lets an embedder that passes one keep passing it.
 */
it.each(['adapter', 'policy'])('lets %s through, naming it as an option the plugin does not know', async (key) => {
  const { loaded, problems } = await load({ ...VALID, [key]: 'x' });
  expect(loaded).toHaveLength(1);
  expect(problems).toEqual([`plugin ${NAME}: plugins.${NAME}.options.${key} is not an option ${NAME} knows; passed through`]);
});

it('reports a tools switch of the wrong type by its full key', async () => {
  const { problems } = await load({ tools: { files: 'no' } });
  expect(problems).toEqual([`plugin ${NAME} skipped: plugins.${NAME}.options.tools.files must be true or false`]);
});

/*
 * The files switch is an object as well as a boolean, on either check.
 *
 * `strictTools: false` holds the option to the loose reading instead of
 * cofold's schema, and `files: { requireRead: false }` is a value both of them
 * take: `requireRead` is a boolean, so the loose reading keeps it.
 */
it('takes the files switch as an object, with and without the strict check', async () => {
  for (const strictTools of [undefined, false]) {
    const { loaded, problems } = await load({
      tools: { files: { requireRead: false } },
      ...(strictTools === undefined ? {} : { strictTools }),
    });
    expect(problems).toEqual([]);
    expect(loaded).toHaveLength(1);
  }
});

it('refuses a requireRead that is not a boolean', async () => {
  const { loaded, problems } = await load({ tools: { files: { requireRead: 'no' } } });
  expect(loaded).toEqual([]);
  expect(problems).toEqual([`plugin ${NAME} skipped: plugins.${NAME}.options.tools.files.requireRead must be true or false`]);
});

/*
 * A model's declared levels take any string, as VS Code's Custom Endpoint
 * models setting does; the ones cofold does not have are left out when the
 * model is offered.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/extensions/copilot/package.json#L2043-L2049
 */
it('takes a declared level cofold does not have', async () => {
  const { loaded, problems } = await load({ ...VALID, models: [{ id: 'm', supportsReasoningEffort: ['xhigh', 'low'] }] });
  expect(problems).toEqual([]);
  expect(loaded).toHaveLength(1);
});

it('takes computerConfigDir as a directory and as false', async () => {
  for (const value of ['/srv/cofold-home', false]) {
    const { loaded, problems } = await load({ ...VALID, computerConfigDir: value });
    expect(problems).toEqual([]);
    expect(loaded).toHaveLength(1);
  }
});

/*
 * An agent is a record, so the three fields a record carries are refused here.
 *
 * The schema cannot refuse them - they are not in it - so the loader says it
 * does not know the key and lets it through, and `apply` refuses it with a
 * sentence that says where the field is written now.
 */
it.each<[string, string]>([
  ['provider', "the record's id"],
  ['displayName', "the record's name"],
  ['description', "the record's description"],
])('refuses %s, which a record carries now', async (key, where) => {
  const { loaded, problems } = await load({ [key]: 'x' });
  expect(loaded).toEqual([]);
  expect(problems).toHaveLength(2);
  expect(problems[0]).toContain(`plugins.${NAME}.options.${key} is not an option`);
  expect(problems[1]).toContain(`options.${key} is written per record now, as ${where}`);
});
