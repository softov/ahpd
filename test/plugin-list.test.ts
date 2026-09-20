import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { describePlugin, pluginLine } from '../packages/server/src/plugins.js';
import { sdkVersion } from '../packages/sdk/src/version.js';
import type { PluginSpec } from '../packages/sdk/src/types/plugin.js';

/*
 * The listing: what a run would load, without loading any of it.
 *
 * Every case here is about the same promise - that a listing reads manifests
 * and never imports - so the fixtures include one that throws the moment it is
 * imported and one whose `apply` would throw. Seeing either of them listed as
 * `ready` is the proof that nothing ran.
 */

const here = import.meta.dirname;
const fixtures = join(here, 'fixtures');

const listing = (spec: PluginSpec) => describePlugin(spec, { configDir: fixtures, cwd: here });

let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

describe('describePlugin', () => {
  it('reads a path, a name and a title out of an ahpd manifest', async () => {
    const row = await listing('./fixtures/plugin-hello');
    expect(row.state).toBe('ready');
    expect(row.name).toBe('plugin-hello');
    expect(row.title).toBe('Hello');
    expect(row.path).toBe(join(fixtures, 'plugin-hello', 'index.ts'));
  });

  it('lists a package with no ahpd key by its package name and no title', async () => {
    const row = await listing('./fixtures/plugin-plain');
    expect(row.state).toBe('ready');
    expect(row.name).toBe('plugin-plain');
    expect(row.title).toBeUndefined();
    expect(row.path).toBe(join(fixtures, 'plugin-plain', 'index.js'));
  });

  it('lists a single file with no manifest above it as (no manifest)', async () => {
    loose = mkdtempSync(join(tmpdir(), 'ahpd-loose-'));
    writeFileSync(join(loose, 'loose.js'), 'export const x = 1;\n');
    const row = await listing(join(loose, 'loose.js'));

    expect(row.state).toBe('ready');
    expect(row.name).toBeUndefined();
    expect(row.title).toBeUndefined();
    expect(pluginLine(row)).toContain('(no manifest)');
  });

  it('lists a spec that does not resolve as missing, with its problem and no path', async () => {
    const row = await listing('./fixtures/nowhere-at-all');
    expect(row.state).toBe('missing');
    expect(row.path).toBeUndefined();
    expect(row.problem).toContain('nowhere-at-all');
    expect(pluginLine(row)).toContain('nowhere-at-all');
  });

  it('lists a module that throws on import as ready, because nothing imported it', async () => {
    const row = await listing('./fixtures/plugin-explodes');
    expect(row.state).toBe('ready');
    expect(row.title).toBe('Explodes');
  });

  it('lists a spec that is switched off as disabled', async () => {
    const row = await listing({ name: './fixtures/plugin-hello', enabled: false });
    expect(row.state).toBe('disabled');
    expect(row.path).toBeUndefined();
  });

  it('lists a manifest option the configuration does not set as unconfigured', async () => {
    const missing = await listing({ name: './fixtures/plugin-configurable' });
    expect(missing.state).toBe('unconfigured');
    expect(missing.problem).toContain('token');

    const given = await listing({ name: './fixtures/plugin-configurable', options: { token: 'shh' } });
    expect(given.state).toBe('ready');
  });

  it('lists an incompatible peer range without importing the entry', async () => {
    delete (globalThis as Record<string, unknown>).__pluginIncompatibleImported;
    const row = await listing('./fixtures/plugin-incompatible');

    expect(row.state).toBe('incompatible');
    expect(row.problem).toContain('^0.9.0');
    expect(row.problem).toContain(sdkVersion());
    expect((globalThis as Record<string, unknown>).__pluginIncompatibleImported).toBeUndefined();
  });

  it('lists a manifest that does not parse as error, naming the file', async () => {
    const row = await listing('./fixtures/plugin-bad-manifest');
    expect(row.state).toBe('error');
    expect(row.problem).toContain('package.json');
  });
});
