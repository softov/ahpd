import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkingUpdates, newer, readUpdate, refreshUpdate, registry, stale, updateLine } from '../packages/server/src/update.js';

/*
 * The update check, without a network.
 *
 * The comparison is a table, and the same table is in ahpc's test of its copy,
 * in the same order - the two repositories share no package, so this is how
 * they are kept from disagreeing. The request is made against a server on
 * this machine that answers whatever the case needs, and the file is written
 * under an `XDG_CONFIG_HOME` that is thrown away after each case.
 */

describe('newer', () => {
  it.each([
    ['0.6.0', '0.5.0', true],
    ['0.10.0', '0.9.0', true],
    ['1.0.0', '0.99.99', true],
    ['0.5.0', '0.5.0', false],
    ['0.5.0', '0.6.0', false],
    ['0.5.0', '0.5.0-beta.1', true],
    ['0.5.0-beta.1', '0.5.0', false],
    ['0.5.0-beta.2', '0.5.0-beta.1', false],
    ['0.6.0', 'unknown', false],
    ['unknown', '0.5.0', false],
    ['', '0.5.0', false],
    ['1.2', '0.5.0', false],
    ['0.6.0', '1.2', false],
  ])('%s over %s is %s', (latest, current, expected) => {
    expect(newer(latest, current)).toBe(expected);
  });
});

describe('registry', () => {
  it('assumes npmjs.org when nothing says otherwise', () => {
    expect(registry({})).toBe('https://registry.npmjs.org');
  });
  it('reads npm_config_registry, without its trailing slash', () => {
    expect(registry({ npm_config_registry: 'https://mirror.example/npm/' })).toBe('https://mirror.example/npm');
    expect(registry({ npm_config_registry: 'http://127.0.0.1:4873' })).toBe('http://127.0.0.1:4873');
  });
});

describe('checkingUpdates', () => {
  it('is on with nothing against it', () => { expect(checkingUpdates(true, {})).toBe(true); });
  it('is off when the flag or the file said so', () => { expect(checkingUpdates(false, {})).toBe(false); });
  it('is off under NO_UPDATE_NOTIFIER, whatever it says', () => {
    expect(checkingUpdates(true, { NO_UPDATE_NOTIFIER: '1' })).toBe(false);
    expect(checkingUpdates(true, { NO_UPDATE_NOTIFIER: '' })).toBe(false);
  });
  it('is off on CI', () => { expect(checkingUpdates(true, { CI: 'true' })).toBe(false); });
});

describe('stale', () => {
  const now = Date.parse('2026-09-18T12:00:00Z');
  it('is true with no file', () => { expect(stale(undefined, now)).toBe(true); });
  it('is false for an answer an hour old', () => {
    expect(stale({ name: 'x', latest: '1.0.0', checkedAt: '2026-09-18T11:00:00Z' }, now)).toBe(false);
  });
  it('is true for one seven hours old', () => {
    expect(stale({ name: 'x', latest: '1.0.0', checkedAt: '2026-09-18T05:00:00Z' }, now)).toBe(true);
  });
  it('is true when the date does not read', () => {
    expect(stale({ name: 'x', latest: '1.0.0', checkedAt: 'yesterday' }, now)).toBe(true);
  });
});

describe('the file', () => {
  let home: string;
  let had: string | undefined;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ahpd-update-'));
    had = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = home;
  });
  afterEach(() => {
    if (had === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = had;
    rmSync(home, { recursive: true, force: true });
  });
  const at = (): string => join(home, 'ahpd', 'update.json');
  const put = (text: string): void => {
    mkdirSync(join(home, 'ahpd'), { recursive: true });
    writeFileSync(at(), text);
  };

  it('reads nothing when there is no file', () => {
    expect(readUpdate()).toBeUndefined();
  });
  it('reads nothing from a broken file', () => {
    put('{not json');
    expect(readUpdate()).toBeUndefined();
  });
  it('reads nothing from a file of the wrong shape', () => {
    put(JSON.stringify({ latest: 5 }));
    expect(readUpdate()).toBeUndefined();
  });
  it('reads a good file', () => {
    put(JSON.stringify({ name: '@ahpd/server', latest: '9.9.9', checkedAt: '2026-09-18T12:00:00Z' }));
    expect(readUpdate()).toEqual({ name: '@ahpd/server', latest: '9.9.9', checkedAt: '2026-09-18T12:00:00Z' });
  });

  describe('updateLine', () => {
    const self = { name: '@ahpd/server', version: '0.5.0' };
    it('says nothing with no file', () => { expect(updateLine(self)).toBeUndefined(); });
    it('says nothing about another package', () => {
      put(JSON.stringify({ name: '@ahpd/sdk', latest: '9.9.9', checkedAt: '2026-09-18T12:00:00Z' }));
      expect(updateLine(self)).toBeUndefined();
    });
    it('says nothing when this one is not behind', () => {
      put(JSON.stringify({ name: '@ahpd/server', latest: '0.5.0', checkedAt: '2026-09-18T12:00:00Z' }));
      expect(updateLine(self)).toBeUndefined();
      put(JSON.stringify({ name: '@ahpd/server', latest: '0.4.0', checkedAt: '2026-09-18T12:00:00Z' }));
      expect(updateLine(self)).toBeUndefined();
    });
    it('says the one line when it is', () => {
      put(JSON.stringify({ name: '@ahpd/server', latest: '0.6.0', checkedAt: '2026-09-18T12:00:00Z' }));
      expect(updateLine(self)).toBe('update: @ahpd/server 0.6.0 is on npm, this is 0.5.0\n');
    });
  });

  describe('refreshUpdate', () => {
    let server: Server | undefined;
    afterEach(async () => { await new Promise<void>((done) => server ? server.close(() => done()) : done()); server = undefined; });
    const serve = async (answer: (path: string, respond: (status: number, body?: string) => void) => void): Promise<string> => {
      server = createServer((request, response) => {
        answer(request.url ?? '', (status, body) => {
          response.writeHead(status, { 'content-type': 'application/json' });
          response.end(body);
        });
      });
      await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done));
      return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    };

    it('writes what the registry said, at the dist-tags path', async () => {
      let asked = '';
      const base = await serve((path, respond) => { asked = path; respond(200, '{"latest":"9.9.9","next":"10.0.0-rc.1"}'); });
      await refreshUpdate({ name: '@ahpd/server', registry: base });
      expect(asked).toBe('/-/package/@ahpd/server/dist-tags');
      const written = JSON.parse(readFileSync(at(), 'utf8')) as { name: string; latest: string; checkedAt: string };
      expect(written.name).toBe('@ahpd/server');
      expect(written.latest).toBe('9.9.9');
      expect(Number.isNaN(Date.parse(written.checkedAt))).toBe(false);
    });
    it('replaces an old answer with the new one', async () => {
      put(JSON.stringify({ name: '@ahpd/server', latest: '0.6.0', checkedAt: '2026-09-18T12:00:00Z' }));
      const base = await serve((_, respond) => respond(200, '{"latest":"0.7.0"}'));
      await refreshUpdate({ name: '@ahpd/server', registry: base });
      const written = JSON.parse(readFileSync(at(), 'utf8')) as { latest: string; checkedAt: string };
      expect(written.latest).toBe('0.7.0');
      expect(written.checkedAt).not.toBe('2026-09-18T12:00:00Z');
    });
    it('writes nothing on a 404', async () => {
      const base = await serve((_, respond) => respond(404, '{"error":"Not found"}'));
      await refreshUpdate({ name: '@ahpd/server', registry: base });
      expect(existsSync(at())).toBe(false);
    });
    it('leaves the old answer alone when the registry fails', async () => {
      const before = JSON.stringify({ name: '@ahpd/server', latest: '0.6.0', checkedAt: '2026-09-18T12:00:00Z' });
      put(before);
      const base = await serve((_, respond) => respond(503, '{"error":"down"}'));
      await refreshUpdate({ name: '@ahpd/server', registry: base });
      expect(readFileSync(at(), 'utf8')).toBe(before);
    });
    it('leaves the old answer alone when nothing answers', async () => {
      const before = JSON.stringify({ name: '@ahpd/server', latest: '0.6.0', checkedAt: '2026-09-18T12:00:00Z' });
      put(before);
      const base = await serve((_, respond) => respond(200, '{}'));
      await new Promise<void>((done) => server?.close(() => done()));
      server = undefined;
      await refreshUpdate({ name: '@ahpd/server', registry: base });
      expect(readFileSync(at(), 'utf8')).toBe(before);
    });
    it('writes nothing when the body is not what was asked for', async () => {
      const base = await serve((_, respond) => respond(200, '<html>sign in</html>'));
      await refreshUpdate({ name: '@ahpd/server', registry: base });
      expect(existsSync(at())).toBe(false);
    });
    it('writes nothing and gives up when nothing answers', async () => {
      const base = await serve(() => { /* never responds */ });
      const began = Date.now();
      await refreshUpdate({ name: '@ahpd/server', registry: base, timeoutMs: 200 });
      expect(Date.now() - began).toBeLessThan(2000);
      expect(existsSync(at())).toBe(false);
    });
    it('writes nothing when the port is closed', async () => {
      const base = await serve((_, respond) => respond(200, '{}'));
      await new Promise<void>((done) => server?.close(() => done()));
      server = undefined;
      await refreshUpdate({ name: '@ahpd/server', registry: base });
      expect(existsSync(at())).toBe(false);
    });
  });
});

describe('ahpd status, and whether a newer release is out', () => {
  /*
   * The verb as a process, because `main.ts` runs the daemon on import and
   * cannot be called. It is given a `daemon.json` naming this process, which
   * is alive, so `status` has something to report; `update.json` says a
   * version far ahead. Nothing here asks the registry: the verb prints what
   * the file says and leaves, so there is no server to answer one.
   */
  const run = async (rest: string[], env: Record<string, string> = {}, config?: string): Promise<string> => {
    const home = mkdtempSync(join(tmpdir(), 'ahpd-status-'));
    mkdirSync(join(home, 'ahpd'), { recursive: true });
    writeFileSync(join(home, 'ahpd', 'daemon.json'), JSON.stringify({ pid: process.pid, url: 'ws://127.0.0.1:1', paths: ['/x'], startedAt: '2026-09-18T12:00:00Z' }));
    writeFileSync(join(home, 'ahpd', 'update.json'), JSON.stringify({ name: '@ahpd/server', latest: '9.9.9', checkedAt: '2026-09-18T12:00:00Z' }));
    if (config !== undefined) writeFileSync(join(home, 'ahpd', 'config.json'), config);
    const clean: NodeJS.ProcessEnv = { ...process.env, XDG_CONFIG_HOME: home };
    delete clean.CI;
    delete clean.NO_UPDATE_NOTIFIER;
    Object.assign(clean, env);
    try {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ['--conditions', 'development', '--import', './scripts/dev.mjs', 'packages/server/src/main.ts', 'status', ...rest],
        { env: clean, cwd: join(import.meta.dirname, '..') },
      );
      return stdout;
    }
    finally { rmSync(home, { recursive: true, force: true }); }
  };

  it('prints the line last, from the file', async () => {
    const lines = (await run([])).split('\n');
    expect(lines[0]).toMatch(/^ahpd on ws:\/\/127\.0\.0\.1:1 \(pid \d+\), started /);
    expect(lines[1]).toBe('sessions in /x');
    expect(lines[2]).toMatch(/^update: @ahpd\/server 9\.9\.9 is on npm, this is \d+\.\d+\.\d+$/);
  }, 20000);
  it('says nothing under --no-update-check, CI, NO_UPDATE_NOTIFIER or updateCheck: false', async () => {
    expect((await run(['--no-update-check'])).split('\n')).toHaveLength(3);
    expect((await run([], { CI: '1' })).split('\n')).toHaveLength(3);
    expect((await run([], { NO_UPDATE_NOTIFIER: '' })).split('\n')).toHaveLength(3);
    expect((await run([], {}, '{"updateCheck": false}')).split('\n')).toHaveLength(3);
  }, 40000);
});
