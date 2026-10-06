import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { satisfies } from '../src/compat.js';
import { loadPlugins } from '../src/plugins.js';
import { sdkVersion } from '../../sdk/src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import type { HostOptions } from '../../sdk/src/types/host.js';

/*
 * The range check, and the one moment it matters.
 *
 * `satisfies` is a table because a hand-written comparison is exactly the kind
 * of thing that is wrong in one corner; the loader half is here because the
 * point of checking compatibility is that the check happens *before* the
 * import, and a fixture that records its own import is the only way to pin the
 * order rather than assume it.
 */

const here = import.meta.dirname;
const fixtures = join(here, './fixtures');

const load = (specs: Parameters<typeof loadPlugins>[0]) => loadPlugins(specs, {
  base: { path: '/tmp/plugin-compat', agents: [echo({ path: '/tmp/plugin-compat' })] } satisfies HostOptions,
  configDir: fixtures,
  cwd: here,
  log: () => {},
});

describe('satisfies', () => {
  it.each([
    ['0.6.0', '*', true],
    ['0.6.0', '0.6.0', true],
    ['0.6.1', '0.6.0', false],
    ['0.6.0', '=0.6.0', true],
    ['0.6.0', '^0.6.0', true],
    ['0.6.9', '^0.6.0', true],
    ['0.7.0', '^0.6.0', false],
    ['1.0.0', '^1.2.3', false],
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['0.6.5', '>=0.6 <0.7', true],
    ['0.7.0', '>=0.6 <0.7', false],
    ['0.6.0', '>=0.6.0', true],
    ['0.6.0', '<=0.6.0', true],
    ['0.6.1', '<=0.6.0', false],
    ['0.6.0', '0.5.0', false],
  ])('%s against %s is %s', (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });

  it('refuses a range it cannot read, by name', () => {
    expect(() => satisfies('0.6.0', 'banana')).toThrow(/banana/);
  });
});

describe('a plugin that declares a range', () => {
  it('is refused before its entry is imported, naming the range and the version', async () => {
    delete (globalThis as Record<string, unknown>).__pluginIncompatibleImported;
    const { loaded, problems } = await load(['./fixtures/plugin-incompatible']);

    expect(loaded).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('^0.11.0');
    expect(problems[0]).toContain(sdkVersion());
    expect((globalThis as Record<string, unknown>).__pluginIncompatibleImported).toBeUndefined();
  });

  it('loads a plugin that declares no range, because absent is not incompatible', async () => {
    const { loaded, problems } = await load(['./fixtures/plugin-no-peer']);

    expect(problems).toEqual([]);
    expect(loaded.map((one) => one.name)).toEqual(['no-peer']);
  });
});

describe('a plugin that names the oldest sdk it needs', () => {
  /** A plugin in a scratch directory whose `@ahpd/sdk` peer range is `range`, loaded on a daemon at `version`. */
  const loadWith = async (range: string, version: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-compat-'));
    try {
      mkdirSync(join(dir, 'plugin'));
      writeFileSync(join(dir, 'plugin', 'package.json'), JSON.stringify({
        name: 'oldest-sdk', version: '1.0.0', type: 'module',
        peerDependencies: { '@ahpd/sdk': range }, ahpd: { entry: './index.js' },
      }));
      writeFileSync(join(dir, 'plugin', 'index.js'), "export const name = 'oldest-sdk';\nexport const apply = () => {};\n");
      return await loadPlugins([join(dir, 'plugin')], {
        base: { path: '/tmp/plugin-compat', agents: [echo({ path: '/tmp/plugin-compat' })] },
        configDir: dir, cwd: dir, log: () => {}, version,
      });
    }
    finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('loads a plugin that takes >=0.8 on a 0.9 daemon', async () => {
    const { loaded, problems } = await loadWith('>=0.8', '0.9.0');
    expect(problems).toEqual([]);
    expect(loaded.map((one) => one.name)).toEqual(['oldest-sdk']);
  });

  it('refuses a plugin that takes >=0.9 on a 0.8 daemon, with the loader\'s sentence', async () => {
    const { loaded, problems } = await loadWith('>=0.9', '0.8.0');
    expect(loaded).toEqual([]);
    expect(problems).toEqual(['plugin oldest-sdk needs @ahpd/sdk >=0.9, this is 0.8.0']);
  });

  /*
   * Each package's floor is the first sdk that exports what it imports: the
   * four agents read `uriOf`, which 0.10 added, the computer reads `callTimes`,
   * `startOf`, `withCallTimes` and `secretRef` (0.9) and `hasUsers` on its
   * plugin context (0.10), and the tunnel reads nothing newer than 0.8.
   */
  it.each([
    ['agent-acp', '>=0.10'], ['agent-claude', '>=0.10'], ['agent-cofold', '>=0.10'], ['agent-pi', '>=0.10'],
    ['computer', '>=0.10'], ['tunnel-devtunnel', '>=0.8'],
  ])(
    'declares @ahpd/%s as taking any sdk from %s on',
    (name, floor) => {
      const manifest = JSON.parse(readFileSync(join(here, '../..', name, 'package.json'), 'utf8')) as {
        peerDependencies: Record<string, string>;
      };
      expect(manifest.peerDependencies['@ahpd/sdk']).toBe(floor);
      // The sdk this workspace builds is one every package on the list can be
      // run against, whatever each floor is.
      expect(satisfies(sdkVersion(), manifest.peerDependencies['@ahpd/sdk'] as string)).toBe(true);
    },
  );
});
