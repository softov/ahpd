/*
 * Where `@ahpd/server` is installed, read off folders this test makes.
 *
 * The update replaces the package the running code came from, so the first
 * question it asks is which npm install that is: a global one, whose prefix npm
 * is given with `-g`, or a folder whose own `package.json` made it a project,
 * which npm is given with `--prefix`. A checkout and a linked package are the
 * two it cannot replace, and both are refused with the same sentence naming the
 * folder that would have to be updated by hand.
 *
 * The layout cases are paths the machine they name would have, with the folder
 * checks answered by the test: the layout is what is being read, and it does not
 * change with the system the suite runs on. The refusals read real folders.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Running } from '../src/daemon.js';
import { IN_IMAGE, installPlace, planUpdate } from '../src/selfupdate.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-place-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** A folder holding a `package.json`, which is what a prefix install and a checkout both have. */
const manifestIn = (folder: string): string => {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'package.json'), `${JSON.stringify({ name: '@ahpd/server', version: '1.0.0' })}\n`);
  return folder;
};

/** The sentence a refusal threw. */
const refusal = (work: () => unknown): string => {
  try { work(); }
  catch (error) { return error instanceof Error ? error.message : String(error); }
  throw new Error('it was not refused');
};

describe('the install place', () => {
  it('answers the prefix of a global install on Linux and macOS', () => {
    const prefix = '/usr/local';
    const server = '/usr/local/lib/node_modules/@ahpd/server';
    for (const platform of ['linux', 'darwin'] as const) {
      expect(installPlace({ root: server, platform, exists: () => false, real: (path) => path }))
        .toEqual({ kind: 'global', prefix });
    }
  });

  it('answers the prefix of a global install on Windows', () => {
    const prefix = 'C:\\Users\\ana\\AppData\\npm';
    const server = 'C:\\Users\\ana\\AppData\\npm\\node_modules\\@ahpd\\server';
    // Nothing of npm's own making is at the prefix: the folder only holds the
    // packages npm installed there.
    expect(installPlace({ root: server, platform: 'win32', exists: () => false, real: (path) => path }))
      .toEqual({ kind: 'global', prefix });
  });

  it('answers a folder with its own package.json as a prefix install', () => {
    const exists = (path: string): boolean => path.endsWith('package.json');
    const folder = '/home/ana/project';
    const server = '/home/ana/project/node_modules/@ahpd/server';
    expect(installPlace({ root: server, platform: 'linux', exists, real: (path) => path }))
      .toEqual({ kind: 'prefix', prefix: folder });

    // The same layout on Windows is a project too when the folder says so, and
    // a global install only when it does not.
    const windows = 'C:\\work\\project';
    const windowsServer = 'C:\\work\\project\\node_modules\\@ahpd\\server';
    expect(installPlace({ root: windowsServer, platform: 'win32', exists, real: (path) => path }))
      .toEqual({ kind: 'prefix', prefix: windows });
  });

  it('refuses a linked package, naming the link and nothing behind it', () => {
    const install = join(root, 'lib', 'node_modules', '@ahpd');
    mkdirSync(install, { recursive: true });
    const elsewhere = manifestIn(join(root, 'source'));
    const link = join(install, 'server');
    // A junction on Windows, which needs no privilege and resolves as a link does.
    symlinkSync(elsewhere, link, process.platform === 'win32' ? 'junction' : 'dir');

    const said = refusal(() => installPlace({ root: link, platform: 'linux' }));
    expect(said).toContain(link);
    expect(said).not.toContain(elsewhere);
    expect(said).toContain('by hand');
  });

  it('refuses a checkout, naming the folder and nothing else', () => {
    const checkout = manifestIn(join(root, 'packages', 'server'));
    const said = refusal(() => installPlace({ root: checkout, platform: 'linux' }));
    expect(said).toContain(checkout);
    expect(said).toContain('by hand');
  });

  it('refuses a folder whose package.json would make it a prefix npm did not install into', () => {
    const folder = join(root, 'project');
    manifestIn(folder);
    // `<dir>/node_modules/@ahpd/server` with no package.json at `<dir>` is not
    // an install this update can name a prefix for.
    const server = join(folder, 'node_modules', '@ahpd', 'server');
    expect(refusal(() => installPlace({ root: server, platform: 'linux' }))).toContain(server);
  });
});

describe('planning an update', () => {
  /** A record of a daemon the container runtime holds. */
  const held: Running = {
    pid: 7,
    url: 'ws://127.0.0.1:9',
    connectUrl: 'ws://127.0.0.1:9/',
    paths: [],
    startedAt: '2026-11-10T00:00:00.000Z',
    service: 'container',
  };

  it('refuses a container record with the image sentence, and reads no install place', async () => {
    const plan = await planUpdate({
      version: '999.0.0',
      record: held,
      // A place this plan never reaches: reading it would refuse with its own
      // sentence naming the folder, which is what the answer below is not.
      place: { root: join(root, 'no', 'such', 'install') },
    });
    expect(plan).toMatchObject({ why: IN_IMAGE });
    expect(plan).not.toHaveProperty('place');
  });
});
