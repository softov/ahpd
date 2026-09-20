import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configDir } from '../packages/server/src/config.js';
import { denoMessage, entryOf, resolvePlugin } from '../packages/server/src/plugins.js';

/*
 * Turning a spec into something importable, without importing it.
 *
 * Every case is built under a temporary `XDG_CONFIG_HOME`, the way the update
 * check's file cases are, so the configuration directory is a real one this
 * test owns and nothing here reads or writes the person's own. Nothing is
 * imported: resolving is a question a listing asks too, and the whole point of
 * testing it apart from the loader is that the answer is available without
 * running any plugin code.
 */

let home: string;
let had: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-resolve-'));
  had = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  put('package.json', '{}');
});

afterEach(() => {
  if (had === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = had;
  rmSync(home, { recursive: true, force: true });
});

/** A path under the configuration directory this test owns. */
const at = (...parts: string[]): string => join(home, 'ahpd', ...parts);

/** Write a file under it, making the directories on the way. */
const put = (where: string, text: string): void => {
  const path = at(where);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

/** A directory under the working directory the resolver is pointed at, holding what is given. */
const directory = (name: string, files: Record<string, string>): string => {
  const dir = join(home, 'fixtures', name);
  for (const [file, text] of Object.entries(files)) {
    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
};

describe('resolvePlugin', () => {
  it('resolves a bare name through the configuration directory, and reports the package it found', () => {
    put('node_modules/fixture-plugin/package.json', JSON.stringify({ name: 'fixture-plugin', version: '1.0.0', main: './index.js' }));
    put('node_modules/fixture-plugin/index.js', 'export const name = "fixture";\n');

    const resolved = resolvePlugin('fixture-plugin', { configDir: configDir(), cwd: process.cwd() });

    expect(resolved.url.startsWith('file:')).toBe(true);
    expect(resolved.url).toContain('node_modules/fixture-plugin/index.js');
    expect(resolved.path).toBe(at('node_modules/fixture-plugin/index.js'));
    expect(resolved.packageDir).toBe(at('node_modules/fixture-plugin'));
  });

  it('refuses a relative path that is in neither the working directory nor the configuration directory', () => {
    const cwd = join(home, 'work');
    mkdirSync(cwd, { recursive: true });
    expect(() => resolvePlugin('./missing.js', { configDir: configDir(), cwd }))
      .toThrow(new RegExp(`${resolve(cwd, './missing.js')}.*${resolve(configDir(), './missing.js')}`));
  });

  it('passes a spec with a scheme of its own through untouched', () => {
    const resolved = resolvePlugin('npm:fixture-plugin', { configDir: configDir(), cwd: process.cwd() });
    expect(resolved.url).toBe('npm:fixture-plugin');
    expect(resolved.path).toBeUndefined();
    expect(resolved.packageDir).toBeUndefined();
  });

  it('refuses a scoped name that is not installed, in its own words', () => {
    expect(() => resolvePlugin('@scope/missing', { configDir: configDir(), cwd: process.cwd() }))
      .toThrow(/@scope\/missing.*is not installed/);
  });

  it('reads a directory entry through its manifest, in the order the decision names', () => {
    const ahpd = directory('ahpd-entry', {
      'package.json': JSON.stringify({ name: 'ahpd-entry', ahpd: { entry: './main.js' } }),
      'main.js': '',
    });
    const main = directory('main-only', {
      'package.json': JSON.stringify({ name: 'main-only', main: './main.js' }),
      'main.js': '',
    });
    const exports = directory('exports-default', {
      'package.json': JSON.stringify({ name: 'exports-default', exports: { '.': { default: './exports.js' } } }),
      'exports.js': '',
    });
    const index = directory('index-only', { 'package.json': JSON.stringify({ name: 'index-only' }), 'index.js': '' });

    expect(entryOf(ahpd)).toBe(join(ahpd, 'main.js'));
    expect(entryOf(main)).toBe(join(main, 'main.js'));
    expect(entryOf(exports)).toBe(join(exports, 'exports.js'));
    expect(entryOf(index)).toBe(join(index, 'index.js'));

    const resolved = resolvePlugin('./fixtures/ahpd-entry', { configDir: configDir(), cwd: home });
    expect(resolved.packageDir).toBe(ahpd);
    expect(resolved.path).toBe(join(ahpd, 'main.js'));
  });

  it('refuses a directory with none of the four entries, naming it', () => {
    const none = directory('none', { 'package.json': JSON.stringify({ name: 'none' }) });
    expect(() => entryOf(none)).toThrow(new RegExp(`${none} has no plugin entry`));
  });

  it('refuses a manifest entry that points outside its own package', () => {
    const escape = directory('escape', {
      'package.json': JSON.stringify({ name: 'escape', ahpd: { entry: '../outside.js' } }),
      '../outside.js': '',
    });
    expect(() => entryOf(escape)).toThrow(/points outside the package/);
  });

  it('falls back to index.js when the manifest cannot be read, so the loader can name the file', () => {
    const broken = directory('broken', { 'package.json': '{not json', 'index.js': '' });
    expect(entryOf(broken)).toBe(join(broken, 'index.js'));
  });
});

describe('denoMessage', () => {
  it('says what to write instead of a bare name, since the branch cannot run here', () => {
    const message = denoMessage('fixture-plugin', '/tmp/config/ahpd');
    expect(message).toContain('fixture-plugin');
    expect(message).toContain('npm:fixture-plugin');
    expect(message).toContain('createRequire');
  });
});
