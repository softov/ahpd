import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPlugins } from '../src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { PluginSpec } from '../../sdk/src/types/plugin.js';

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
const fixtures = join(here, './fixtures');

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

describe('one plugin named twice', () => {
  it('refuses the second entry, whatever options it carries, and loads the first', async () => {
    const { loaded, options, problems } = await load([
      './fixtures/plugin-hello',
      { name: './fixtures/plugin-hello', options: { provider: 'second' } },
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('is named 2 times; write it once and use its options for variants');
    expect(loaded).toHaveLength(1);
    expect(options.agents.map((one) => one.provider)).toEqual(['echo', 'hello']);
  });

  it('refuses the second entry even when the first is switched off', async () => {
    // A switched-off entry still counts: root config would key it the same.
    const { problems } = await load([
      { name: './fixtures/plugin-hello', enabled: false },
      './fixtures/plugin-hello',
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('is named 2 times; write it once and use its options for variants');
  });

  it('loads the one entry that is not a repeat', async () => {
    const { loaded, problems } = await load(['./fixtures/plugin-hello']);

    expect(problems).toEqual([]);
    expect(loaded).toHaveLength(1);
  });
});

describe('loadPlugins log', () => {
  const logged = async (specs: PluginSpec[]) => {
    const lines: string[] = [];
    const result = await loadPlugins(specs, { base: base(), configDir: fixtures, cwd: here, log: (line) => { lines.push(line); } });
    return { lines, ...result };
  };

  it('logs each plugin starting, then loaded with its time, one after another', async () => {
    const { lines, loaded } = await logged(['./fixtures/plugin-hello', './fixtures/plugin-alike']);

    expect(loaded.map((one) => one.name)).toEqual(['hello', 'alike']);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('plugin plugin-hello loading');
    expect(lines[1]).toMatch(new RegExp(`^plugin hello from ${join(fixtures, 'plugin-hello', 'index.ts')} in \\d+ ms$`));
    expect(lines[2]).toBe('plugin plugin-alike loading');
    expect(lines[3]).toMatch(new RegExp(`^plugin alike from ${join(fixtures, 'plugin-alike', 'index.ts')} in \\d+ ms$`));
  });

  it('logs a plugin whose apply throws starting, and says in its problem how long it took', async () => {
    const { lines, problems } = await logged(['./fixtures/plugin-configurable']);

    expect(lines).toEqual(['plugin plugin-configurable loading']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^plugin configurable failed in \d+ ms: the configurable fixture must not be loaded without a token$/);
  });

  it('logs a plugin whose import throws starting, and says in its problem how long it took', async () => {
    const { lines, problems } = await logged(['./fixtures/plugin-explodes']);

    expect(lines).toEqual(['plugin plugin-explodes loading']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(new RegExp(`^plugin plugin-explodes could not be imported from ${join(fixtures, 'plugin-explodes', 'index.ts')} in \\d+ ms: .*the explodes fixture throws when imported`));
  });
});

describe('a plugin file with no plugin manifest of its own', () => {
  it('is named by its name export, and never by the package it sits in', async () => {
    const said: string[] = [];
    const { problems } = await loadPlugins(['./fixtures/plugin-throws/index.ts'], {
      base: base(), configDir: fixtures, cwd: here, log: (line) => { said.push(line); },
    });
    expect(said).toContain('plugin plugin-throws loading');
    expect(said.join('\n')).not.toContain('@ahpd/server');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('plugin throws failed');
  });

  it('is checked against no other package\'s range, and named by its file when it exports no name', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-no-manifest-'));
    try {
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'not-a-plugin', peerDependencies: { '@ahpd/sdk': '^99.0.0' } }));
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src', 'loose.js'), 'export function apply() {}\n');
      const { loaded, problems } = await load([join(root, 'src', 'loose.js')]);
      expect(problems).toEqual([]);
      expect(loaded.map((one) => one.name)).toEqual(['loose']);
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
