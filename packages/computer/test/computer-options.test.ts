import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { closeAll, keeping } from './support/closing.js';
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
const SOURCE = './packages/computer/src/index.ts';
const NAME = 'ahpd-computer';

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

/*
 * The state directory a load is given, which is a temporary one of its own.
 *
 * A load with this repository as its state directory writes into the checkout:
 * a machine made on a linked worktree leaves `computers.gitfile` at whatever
 * `configDir` names, and a test that did that put a file in the repository.
 */
let home: string | undefined;
afterEach(async () => {
  // Every load this test made, closed before its folder goes: a load on its
  // own has already read what is out there and armed what it found.
  await closeAll();
  if (home !== undefined) rmSync(home, { recursive: true, force: true });
  home = undefined;
});

const stateDir = (): string => (home ??= mkdtempSync(join(tmpdir(), 'ahpd-computer-options-')));

const load = async (options: Record<string, unknown>) => {
  const result = await loadPlugins([{ name: SOURCE, options }], {
    base: { path: '/tmp/computer-options', agents: [echo({ path: '/tmp/computer-options' })] },
    configDir: stateDir(),
    cwd: REPO,
    log: () => {},
  });
  keeping(result.options);
  return result;
};

it('declares every option its README lists', () => {
  expect(declared()).toEqual(expect.arrayContaining(documented()));
});

it('takes a profile\'s secretUnreadable as fail or drop, and refuses anything else by name', async () => {
  const drop = await load({ profiles: { claude: { secretUnreadable: 'drop' } } });
  expect(drop.problems).toEqual([]);
  expect(drop.loaded.map((one) => one.name)).toEqual([NAME]);

  // The loader's check does not reach into a profile, so the plugin refuses it.
  const skip = await load({ profiles: { claude: { secretUnreadable: 'skip' } } });
  expect(skip.loaded).toEqual([]);
  expect(skip.problems.join('\n')).toContain('profiles.claude.secretUnreadable is fail or drop, and skip is neither');
});

it('takes a profile\'s state and stateScope by their values, and refuses anything else by name', async () => {
  const shared = await load({ profiles: { bots: { state: 'volume', stateScope: 'shared' }, home: { state: 'host', stateScope: 'owner' } } });
  expect(shared.problems).toEqual([]);
  expect(shared.loaded.map((one) => one.name)).toEqual([NAME]);

  const team = await load({ profiles: { bots: { stateScope: 'team' } } });
  expect(team.loaded).toEqual([]);
  expect(team.problems.join('\n')).toContain('profiles.bots.stateScope is owner or shared, and team is neither');

  const disk = await load({ profiles: { bots: { state: 'disk' } } });
  expect(disk.loaded).toEqual([]);
  expect(disk.problems.join('\n')).toContain('profiles.bots.state is volume or host, and disk is neither');
});

it('takes a profile\'s gitGuard by its values, and refuses anything else by name', async () => {
  // `bind` is the guard plan host/67 removes, kept readable so a profile
  // written for it still loads; it is read as `fetch`, which the plugin test
  // asks of the machine a session makes.
  const all = await load({ profiles: { fetched: { gitGuard: 'fetch' }, open: { gitGuard: 'open' }, bound: { gitGuard: 'bind' } } });
  expect(all.problems).toEqual([]);
  expect(all.loaded.map((one) => one.name)).toEqual([NAME]);

  const loose = await load({ profiles: { bots: { gitGuard: 'loose' } } });
  expect(loose.loaded).toEqual([]);
  expect(loose.problems.join('\n')).toContain('profiles.bots.gitGuard is fetch, open or bind, and loose is neither');
});

it('takes a profile\'s nestedDelete by its values, and refuses anything else by name', async () => {
  const both = await load({ profiles: { cofold: { nestedDelete: 'inside' }, bots: { nestedDelete: 'record' } } });
  expect(both.problems).toEqual([]);
  expect(both.loaded.map((one) => one.name)).toEqual([NAME]);

  const skip = await load({ profiles: { cofold: { nestedDelete: 'skip' } } });
  expect(skip.loaded).toEqual([]);
  expect(skip.problems.join('\n')).toContain('profiles.cofold.nestedDelete is inside or record, and skip is neither');
});

it.each<[string, unknown]>([
  ['runtime', 'podman'],
  ['command', 5],
  ['args', 'x'],
  ['env', 'x'],
  ['image', 5],
  ['cpus', 2],
  ['memory', 5],
  ['max', 0],
  ['label', 5],
  ['prefix', 5],
  ['sessionSetting', 'no'],
  ['sessionDefault', 5],
  ['needs', 'x'],
  ['mounts', 'x'],
  ['profiles', 'x'],
  ['bodyMounts', 'yes'],
  ['images', 'x'],
  ['devcontainer', 'x'],
])('reports %s of the wrong type and skips the plugin', async (key, value) => {
  const { loaded, problems } = await load({ ...VALID, [key]: value });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatch(new RegExp(`^plugin ${NAME} skipped: plugins\\.${NAME}\\.options\\.${key} must be `, 'u'));
  expect(loaded).toEqual([]);
});
