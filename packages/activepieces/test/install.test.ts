import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apply } from '../src/plugin.js';
import type { Adapter, Alert, InstallAnswer, PluginHost } from '@ahpd/sdk';

/*
 * A piece that is named and not there.
 *
 * A name in the options may carry a version. A piece the plugin does not
 * depend on is installed into the plugin's own `installed/` folder before the
 * engine is asked what the pieces are, and the engine imports it by its package
 * name from there. npm is a fake here, so no test reaches the registry: it
 * writes the package a real npm would leave, and answers as the case says.
 *
 * A piece that still does not load is a warning on the plugin's row. A piece
 * whose install failed keeps the install's error instead, because a warning
 * with the same `ref` would replace it.
 */

/** The fixture piece the plugin already has, as the engine imports it: by its URL. */
const PRESENT = pathToFileURL(fileURLToPath(new URL('./fixtures/piece-run.mjs', import.meta.url))).href;

/** A package that is nowhere: not a dependency, and not installed until a test installs it. */
const MISSING = '@activepieces/piece-nowhere';

/** One package's own schema, as the plugin declares it. */
interface Manifest {
  ahpd: { optionsSchema: { properties: { pieces: { items: { pattern: string } } } } };
}

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ahpd-activepieces-install-')); });

/** The engine of every plugin a case started, stopped after the case. */
let started: Kept[] = [];
afterEach(async () => {
  for (const one of started) {
    for (const close of one.closes) await close();
  }
  started = [];
  rmSync(home, { recursive: true, force: true });
});

/** What one host kept, for the cases of one plugin. */
interface Kept {
  adapters: Map<string, Adapter>;
  alerts: Alert[];
  problems: string[];
  /** Every spec npm was asked to install, in the order it was asked. */
  installs: string[];
  closes: (() => void | Promise<void>)[];
}

/** What one case's fake npm answers, or the error it says instead. */
type Installer = (spec: string) => InstallAnswer | Promise<InstallAnswer>;

/** Start the plugin on the named pieces, and answer what its host kept. */
async function start(options: { pieces: string[]; installed?: string; install?: Installer }): Promise<Kept> {
  const kept: Kept = { adapters: new Map(), alerts: [], problems: [], installs: [], closes: [] };
  const host = {
    ...(options.installed === undefined ? {} : { installed: options.installed }),
    install: async (spec: string): Promise<InstallAnswer> => {
      kept.installs.push(spec);
      return options.install === undefined ? { error: 'this case installs nothing' } : await options.install(spec);
    },
    alert: (alert: Alert) => { kept.alerts.push(alert); },
    registerAdapter: (adapter: Adapter) => { kept.adapters.set(adapter.name, adapter); },
    registerClose: (close: () => void | Promise<void>) => { kept.closes.push(close); },
    problem: (line: string) => { kept.problems.push(line); },
  } as unknown as PluginHost;
  await apply(host, { pieces: options.pieces });
  started.push(kept);
  return kept;
}

/**
 * A piece package, as npm leaves it: a manifest and a CommonJS module.
 *
 * The piece carries the parts the plugin reads: a display name, a secret text
 * auth and one action. It publishes no logo, so no test reaches a network.
 */
function writePiece(installed: string, packageName: string, version: string): void {
  const folder = join(installed, 'node_modules', ...packageName.split('/'));
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: packageName, version, main: './index.js' }));
  writeFileSync(join(folder, 'index.js'), [
    'module.exports = {',
    "  displayName: 'Nowhere',",
    "  description: 'A piece that was installed.',",
    "  auth: { type: 'SECRET_TEXT', displayName: 'API Key', required: true },",
    '  _actions: {',
    "    ping: { name: 'ping', displayName: 'Ping', description: 'Pings.', props: {}, run: async () => ({ ok: true }) },",
    '  },',
    '};',
    '',
  ].join('\n'));
}

/** The adapter names one case's plugin registered. */
const adaptersOf = (kept: Kept): string[] => [...kept.adapters.keys()].sort();

describe('the pieces option', () => {
  it('accepts a version after a piece name', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Manifest;
    const pattern = new RegExp(manifest.ahpd.optionsSchema.properties.pieces.items.pattern, 'u');

    expect(pattern.test('@activepieces/piece-postgres')).toBe(true);
    expect(pattern.test('@activepieces/piece-postgres@0.5.1')).toBe(true);
    expect(pattern.test('@activepieces/piece-postgres@^0.5.0')).toBe(true);
    // A name still starts with the scope, and a version still has a value.
    expect(pattern.test('piece-postgres@0.5.1')).toBe(false);
    expect(pattern.test('@activepieces/piece-postgres@')).toBe(false);
  });
});

describe('a piece that is not there', () => {
  it('installs once, imports it by its name, and says the version on an info alert', async () => {
    const installed = join(home, 'installed');
    const kept = await start({
      pieces: [`${MISSING}@0.5.1`, PRESENT],
      installed,
      install: (spec) => {
        expect(spec).toBe(`${MISSING}@0.5.1`);
        writePiece(installed, MISSING, '0.5.1');
        return { version: '0.5.1' };
      },
    });

    // The version is npm's; the engine was asked for the package alone, and
    // found it in `installed/`.
    expect(kept.installs).toEqual([`${MISSING}@0.5.1`]);
    expect(kept.alerts).toEqual([{
      level: 'info',
      ref: `piece:${MISSING}`,
      text: `installed ${MISSING} 0.5.1`,
    }]);
    expect(adaptersOf(kept)).toEqual(['ap-nowhere', 'ap-run']);
    expect(kept.problems).toEqual([]);
  });

  it('installs again when the version written is not the one there', async () => {
    const installed = join(home, 'installed');
    writePiece(installed, MISSING, '0.4.0');
    const kept = await start({
      pieces: [`${MISSING}@0.5.1`],
      installed,
      install: () => {
        writePiece(installed, MISSING, '0.5.1');
        return { version: '0.5.1' };
      },
    });

    expect(kept.installs).toEqual([`${MISSING}@0.5.1`]);
    expect(kept.alerts.map((one) => one.level)).toEqual(['info']);
    expect(adaptersOf(kept)).toEqual(['ap-nowhere']);
  });

  it('installs nothing when the version written is the one there', async () => {
    const installed = join(home, 'installed');
    writePiece(installed, MISSING, '0.5.1');
    const kept = await start({ pieces: [`${MISSING}@0.5.1`], installed });

    expect(kept.installs).toEqual([]);
    expect(kept.alerts).toEqual([]);
    expect(adaptersOf(kept)).toEqual(['ap-nowhere']);
  });

  it('runs the version written for a piece the plugin ships, from installed/, and installs it once', async () => {
    const installed = join(home, 'installed');
    const shipped = '@activepieces/piece-smtp';
    const install = (): InstallAnswer => {
      writePiece(installed, shipped, '9.0.0');
      return { version: '9.0.0' };
    };
    const kept = await start({ pieces: [`${shipped}@9.0.0`], installed, install });

    expect(kept.installs).toEqual([`${shipped}@9.0.0`]);
    // The installed copy is the one described, not the copy the plugin ships.
    expect(kept.adapters.get('ap-smtp')?.title).toBe('Nowhere');

    const again = await start({ pieces: [`${shipped}@9.0.0`], installed, install });
    expect(again.installs).toEqual([]);
    expect(again.adapters.get('ap-smtp')?.title).toBe('Nowhere');
  });

  it('installs no piece that is one of the plugin\'s own dependencies', async () => {
    const installed = join(home, 'installed');
    const kept = await start({ pieces: ['@activepieces/piece-smtp', PRESENT], installed });

    expect(kept.installs).toEqual([]);
    expect(adaptersOf(kept)).toEqual(['ap-run', 'ap-smtp']);
    expect(kept.alerts).toEqual([]);
  });
});

describe('a piece that does not install', () => {
  it('says npm\'s error, then the load warning that replaces it, and keeps the other pieces', async () => {
    const installed = join(home, 'installed');
    const kept = await start({
      pieces: [`${MISSING}@9.9.9`, PRESENT],
      installed,
      install: () => ({ error: 'npm error 404 Not Found - GET https://registry.npmjs.org/@activepieces%2fpiece-nowhere' }),
    });

    expect(kept.installs).toEqual([`${MISSING}@9.9.9`]);
    // Both lines are about the same piece, so the second replaces the first on
    // the plugin's row; the plugin keeps what it already had.
    // The install's error is what the row keeps: no load warning replaces it.
    expect(kept.alerts).toEqual([{
      level: 'error',
      ref: `piece:${MISSING}`,
      text: `could not install ${MISSING}@9.9.9: npm error 404 Not Found - GET https://registry.npmjs.org/@activepieces%2fpiece-nowhere`,
    }]);
    expect(adaptersOf(kept)).toEqual(['ap-run']);
  });
});
