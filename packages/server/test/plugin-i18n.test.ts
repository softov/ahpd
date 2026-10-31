import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPlugins, readManifest } from '../src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { PluginSpec } from '../../sdk/src/types/plugin.js';

/*
 * The catalogs a manifest names in `ahpd.i18n`.
 *
 * The field names a folder in the package, and each `<locale>.json` in it is
 * one catalog. A catalog that does not parse costs the catalog and one problem
 * line, a folder outside the package is refused, and neither costs the plugin.
 */

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ahpd-plugin-i18n-')); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const base = (): HostOptions => ({ path: home, agents: [echo({ path: home })] });

/** One file under the temporary home. */
function write(rel: string, body: string): void {
  const at = join(home, rel);
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, body);
}

/** A plugin package in the temporary home, and the spec that loads it. */
function pkg(dir: string, ahpd: Record<string, unknown>): string {
  write(`${dir}/package.json`, JSON.stringify({
    name: dir,
    version: '1.0.0',
    private: true,
    type: 'module',
    exports: { '.': './index.mjs' },
    ahpd: { entry: './index.mjs', ...ahpd },
  }));
  write(`${dir}/index.mjs`, `export const name = '${dir}';\nexport function apply() {}\n`);
  return join(home, dir);
}

const load = (specs: PluginSpec[]) =>
  loadPlugins(specs, { base: base(), configDir: home, cwd: home, log: () => {} });

describe('ahpd.i18n', () => {
  it('reads each <locale>.json in the folder into manifest.i18n', async () => {
    write('i18n-ok/i18n/pt.json', JSON.stringify({ meta: { title: 'Demonstração' } }));
    write('i18n-ok/i18n/es.json', JSON.stringify({ meta: { title: 'Demostración' } }));
    write('i18n-ok/i18n/notes.txt', 'not a catalog');
    const dir = pkg('i18n-ok', { i18n: 'i18n' });

    expect(readManifest(dir).i18n).toEqual({
      pt: { meta: { title: 'Demonstração' } },
      es: { meta: { title: 'Demostración' } },
    });
    const { loaded, problems, contributions } = await load([dir]);
    expect(problems).toEqual([]);
    expect(loaded.map((one) => one.name)).toEqual(['i18n-ok']);
    // Carried on the contribution, so the fold keeps it by key and by agent.
    expect(contributions[0]?.i18n?.pt).toEqual({ meta: { title: 'Demonstração' } });
  });

  it('drops each value that is not an object or a string', () => {
    write('i18n-mixed/i18n/pt.json', JSON.stringify({
      meta: { title: 'Título', description: 7, links: ['a'] },
      options: { command: { title: 'Comando', enum: null } },
      flag: true,
    }));
    const dir = pkg('i18n-mixed', { i18n: './i18n' });

    expect(readManifest(dir).i18n).toEqual({
      pt: { meta: { title: 'Título' }, options: { command: { title: 'Comando' } } },
    });
  });

  it('says one problem for a catalog that does not parse, and keeps the others', async () => {
    write('i18n-broken/i18n/pt.json', '{ "meta": ');
    write('i18n-broken/i18n/es.json', JSON.stringify({ meta: { title: 'Roto' } }));
    const dir = pkg('i18n-broken', { i18n: 'i18n' });

    expect(readManifest(dir).i18n).toEqual({ es: { meta: { title: 'Roto' } } });
    const { loaded, problems } = await load([dir]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('i18n/pt.json could not be read');
    expect(loaded.map((one) => one.name)).toEqual(['i18n-broken']);
  });

  it('refuses a folder that leaves the package, by name or by link', async () => {
    write('outside/pt.json', JSON.stringify({ meta: { title: 'Fora' } }));
    const named = pkg('i18n-escape', { i18n: '../outside' });
    expect(readManifest(named).i18n).toBeUndefined();
    expect(readManifest(named).i18nProblems).toEqual(['plugin i18n-escape: the i18n folder ../outside points outside the plugin package']);

    const linked = pkg('i18n-link', { i18n: 'i18n' });
    symlinkSync(join(home, 'outside'), join(linked, 'i18n'));
    expect(readManifest(linked).i18n).toBeUndefined();

    const filed = pkg('i18n-file-link', { i18n: 'i18n' });
    write('i18n-file-link/i18n/es.json', JSON.stringify({ meta: { title: 'Dentro' } }));
    symlinkSync(join(home, 'outside', 'pt.json'), join(filed, 'i18n', 'pt.json'));
    expect(readManifest(filed).i18n).toEqual({ es: { meta: { title: 'Dentro' } } });
    expect(readManifest(filed).i18nProblems).toEqual(['plugin i18n-file-link: the catalog i18n/pt.json points outside the plugin package']);

    const { loaded, problems } = await load([named]);
    expect(problems).toEqual(['plugin i18n-escape: the i18n folder ../outside points outside the plugin package']);
    expect(loaded.map((one) => one.name)).toEqual(['i18n-escape']);
  });

  it('refuses a value that is not a string, and names the field', async () => {
    const dir = pkg('i18n-wrong', { i18n: ['i18n'] });
    const { loaded, problems } = await load([dir]);
    expect(loaded).toEqual([]);
    expect(problems.join('\n')).toContain('ahpd.i18n');
  });

  it('reads the pt and es catalogs each first-party plugin ships', () => {
    const packages = join(import.meta.dirname, '..', '..');
    for (const name of ['activepieces', 'agent-acp', 'agent-claude', 'agent-cofold', 'agent-pi', 'bot', 'computer', 'push', 'tasks', 'tunnel-devtunnel', 'webhook']) {
      const manifest = readManifest(join(packages, name));
      expect(manifest.i18nProblems, name).toBeUndefined();
      expect(Object.keys(manifest.i18n ?? {}).sort(), name).toEqual(['es', 'pt']);
      expect(typeof (manifest.i18n?.pt?.meta as Record<string, unknown> | undefined)?.title, name).toBe('string');
    }
  });
});

describe('tools/i18n-check.mjs', () => {
  const script = join(import.meta.dirname, '..', '..', '..', 'tools', 'i18n-check.mjs');
  const run = (...dirs: string[]) => spawnSync(process.execPath, [script, ...dirs], { encoding: 'utf8' });

  it('prints nothing on the shipped catalogs', () => {
    const answer = run();
    expect(answer.stdout).toBe('');
    expect(answer.status).toBe(0);
  });

  it('prints each path that matches no field, and exits 1', () => {
    write('i18n-stale/src/agent.ts', "const schema = { mode: { enum: ['fast', 'slow'] } };\n");
    write('i18n-stale/i18n/pt.json', JSON.stringify({
      meta: { title: 'Velho', subtitle: 'Nada' },
      options: { region: { title: 'Região', enum: { eu: 'Europa', mars: 'Marte' } }, gone: { title: 'Sumiu' } },
      session: { mode: { enum: { fast: 'Rápido', warp: 'Dobra' } }, lost: { title: 'Perdido' } },
      views: { main: { state: { text: 'Pronto', color: 'verde' }, open: { label: 1 } }, side: 'Lado' },
      labels: {},
    }));
    const dir = pkg('i18n-stale', {
      i18n: 'i18n',
      optionsSchema: { type: 'object', properties: { region: { type: 'string', enum: ['eu', 'us'] } } },
    });

    const answer = run(dir);
    expect(answer.status).toBe(1);
    expect(answer.stdout.trim().split('\n').map((line) => line.replace(/^.*pt\.json: /, ''))).toEqual([
      'meta.subtitle matches no field',
      'options.region.enum.mars matches no enum value',
      'options.gone matches no field',
      'session.mode.enum.warp matches no enum value',
      'session.lost matches no field',
      'views.main.state.color matches no field',
      'views.main.open.label is not a string',
      'views.side is not an object',
      'labels is not a block a lookup reads',
    ]);
  });
});
