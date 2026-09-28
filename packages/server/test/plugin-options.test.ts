import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadPlugins } from '../src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { PluginSpec } from '../../sdk/src/types/plugin.js';

/*
 * A plugin's options, held to the schema the plugin declares.
 *
 * The loader checks the options after the plugin's defaults are merged under
 * them and before `apply` runs. Options that fail cost that plugin and nothing
 * else; an option the schema does not name is said and passed through; a
 * plugin with no schema gets what it was given.
 */

const here = import.meta.dirname;
const fixtures = join(here, './fixtures');

const base = (): HostOptions => ({ path: '/tmp/plugin-options', agents: [echo({ path: '/tmp/plugin-options' })] });

const load = (specs: PluginSpec[]) => loadPlugins(specs, { base: base(), configDir: fixtures, cwd: here, log: () => {} });

const applied = (key: string): unknown => (globalThis as Record<string, unknown>)[key];

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__pluginSchemaApplied;
  delete (globalThis as Record<string, unknown>).__pluginUncheckedApplied;
});

describe('a plugin that declares optionsSchema', () => {
  it('is applied with its defaults under options that pass', async () => {
    const { loaded, problems } = await load([{ name: './fixtures/plugin-schema/index.ts', options: { command: 'run' } }]);
    expect(problems).toEqual([]);
    expect(loaded.map((one) => one.name)).toEqual(['schema']);
    expect(applied('__pluginSchemaApplied')).toEqual({ greeting: 'hi', internal: true, command: 'run' });
  });

  it('reports a wrong type naming the plugin and the key, skips it, and loads the others', async () => {
    const { loaded, problems } = await load([
      { name: './fixtures/plugin-schema/index.ts', options: { command: 3 } },
      './fixtures/plugin-hello',
    ]);
    expect(problems).toEqual(['plugin schema skipped: plugins.schema.options.command must be text']);
    expect(loaded.map((one) => one.name)).toEqual(['hello']);
    expect(applied('__pluginSchemaApplied')).toBeUndefined();
  });

  it('reports a value the schema bounds', async () => {
    const { problems } = await load([{ name: './fixtures/plugin-schema/index.ts', options: { command: 'run', retries: -1 } }]);
    expect(problems).toEqual(['plugin schema skipped: plugins.schema.options.retries must be an integer >= 0']);
  });

  it('reports a missing required key', async () => {
    const { loaded, problems } = await load(['./fixtures/plugin-schema/index.ts']);
    expect(problems).toEqual(['plugin schema skipped: plugins.schema.options.command is required']);
    expect(loaded).toEqual([]);
  });

  it('says nothing about a default the schema does not name', async () => {
    const { problems } = await load([{ name: './fixtures/plugin-schema/index.ts', options: { command: 'run' } }]);
    expect(problems).toEqual([]);
  });

  it('lets a default satisfy a required key', async () => {
    const { problems } = await load([{ name: './fixtures/plugin-schema/index.ts', options: { command: 'run' } }]);
    expect(problems).toEqual([]);
  });

  it('warns about a key the schema does not name, and passes it through', async () => {
    const { loaded, problems } = await load([{ name: './fixtures/plugin-schema/index.ts', options: { command: 'run', extra: true } }]);
    expect(problems).toEqual(['plugin schema: plugins.schema.options.extra is not an option schema knows; passed through']);
    expect(loaded.map((one) => one.name)).toEqual(['schema']);
    expect(applied('__pluginSchemaApplied')).toEqual({ greeting: 'hi', internal: true, command: 'run', extra: true });
  });
});

describe('a plugin with no optionsSchema', () => {
  it('is applied with its options unchecked', async () => {
    const { loaded, problems } = await load([{ name: './fixtures/plugin-unchecked/index.ts', options: { anything: [1, 'two'] } }]);
    expect(problems).toEqual([]);
    expect(loaded.map((one) => one.name)).toEqual(['unchecked']);
    expect(applied('__pluginUncheckedApplied')).toEqual({ anything: [1, 'two'] });
  });
});
