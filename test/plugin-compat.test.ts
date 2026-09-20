import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { satisfies } from '../packages/server/src/compat.js';
import { loadPlugins } from '../packages/server/src/plugins.js';
import { sdkVersion } from '../packages/sdk/src/version.js';
import { echo } from '../examples/echo/agent.js';
import type { HostOptions } from '../packages/sdk/src/types/host.js';

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
const fixtures = join(here, 'fixtures');

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
    expect(problems[0]).toContain('^0.9.0');
    expect(problems[0]).toContain(sdkVersion());
    expect((globalThis as Record<string, unknown>).__pluginIncompatibleImported).toBeUndefined();
  });

  it('loads a plugin that declares no range, because absent is not incompatible', async () => {
    const { loaded, problems } = await load(['./fixtures/plugin-no-peer']);

    expect(problems).toEqual([]);
    expect(loaded.map((one) => one.name)).toEqual(['no-peer']);
  });
});
