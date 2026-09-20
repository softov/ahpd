import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPlugins } from '../packages/server/src/plugins.js';
import { echo } from '../examples/echo/agent.js';
import type { HostOptions } from '../packages/sdk/src/types/host.js';
import type { PluginSpec } from '../packages/sdk/src/types/plugin.js';

/*
 * Loading a plugin: resolve, manifest, import, apply.
 *
 * The fixtures are real modules loaded by the real loader, not mocks, because
 * the things under test are exactly the ones a mock would replace: that the
 * manifest is read before the import, that a module with no `apply` is named
 * and skipped, that a throw costs a line and not the daemon, and that the
 * fold sees what a plugin registered.
 */

const here = import.meta.dirname;
const fixtures = join(here, 'fixtures');

const base = (): HostOptions => ({ path: '/tmp/plugin-load', agents: [echo({ path: '/tmp/plugin-load' })] });

const load = (specs: PluginSpec[]) => loadPlugins(specs, { base: base(), configDir: fixtures, cwd: here, log: () => {} });

describe('loadPlugins', () => {
  it('loads the hello fixture and folds its agent and tool in', async () => {
    const { loaded, options, contributions, problems } = await load(['./fixtures/plugin-hello']);

    expect(problems).toEqual([]);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.name).toBe('hello');
    expect(loaded[0]?.path).toBe(join(fixtures, 'plugin-hello', 'index.ts'));
    expect(contributions).toHaveLength(1);
    expect(options.agents.map((one) => one.provider)).toEqual(['echo', 'hello']);
    expect(options.tools?.map((one) => one.definition.name)).toEqual(['hello_tool']);
  });

  it('reports a module with no apply and still loads the plugin after it', async () => {
    const { loaded, problems } = await load(['./fixtures/plugin-broken/index.ts', './fixtures/plugin-hello']);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('does not export an apply function');
    expect(loaded.map((one) => one.name)).toEqual(['hello']);
  });

  it('reports what a plugin threw and does not reject', async () => {
    const { loaded, problems } = await load(['./fixtures/plugin-throws/index.ts']);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('the throws fixture threw on purpose');
    expect(loaded).toEqual([]);
  });

  it('reports a provider two plugins share, naming the provider and both', async () => {
    const { loaded, problems } = await load(['./fixtures/plugin-hello', './fixtures/plugin-alike']);

    expect(loaded.map((one) => one.name)).toEqual(['hello', 'alike']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('hello');
    expect(problems[0]).toContain('alike');
  });

  it('skips a spec that is turned off, in neither loaded nor problems', async () => {
    const { loaded, problems } = await load([{ name: './fixtures/plugin-hello', enabled: false }]);

    expect(loaded).toEqual([]);
    expect(problems).toEqual([]);
  });

  it('reports a spec that does not resolve and loads the next one', async () => {
    const { loaded, problems } = await load(['./fixtures/nowhere-at-all', './fixtures/plugin-hello']);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('nowhere-at-all');
    expect(loaded.map((one) => one.name)).toEqual(['hello']);
  });

  it('names a broken manifest and never imports its entry', async () => {
    delete (globalThis as Record<string, unknown>).__pluginBadManifestImported;
    const { loaded, problems } = await load(['./fixtures/plugin-bad-manifest']);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('package.json');
    expect(problems[0]).toContain('could not be read');
    expect(loaded).toEqual([]);
    expect((globalThis as Record<string, unknown>).__pluginBadManifestImported).toBeUndefined();
  });
});
