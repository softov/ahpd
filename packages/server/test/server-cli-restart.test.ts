/*
 * What `ahpd` does at the command line, as `server-cli.test.ts` says.
 *
 * `restart`, from the terminal and over HTTP, which starts two daemons a case.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alive, announced, BACKEND, cli, config, foreground, freePort, gone, home, INITIALIZE, KEPT, knock, put, recordOf, rpc, signalled, SKIPS, SLOW_STOP, spawned } from './cli.js';

describe('start, stop and status', () => {
  it('restarts a started daemon over HTTP with the line it was started with', async () => {
    put({ http: true, plugins: [BACKEND] });
    const began = await cli([
      'start', '--config-file', config, '--port', '0', '--connection-token', 'abc',
      '--sessions', 'memory', '--automations', 'memory', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const before = recordOf() as { pid: number; url: string; argv?: string[] };
    spawned.push(before.pid);
    const api = `http://127.0.0.1:${new URL(before.url).port}/api/restart`;
    const answered = await fetch(api, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer abc' },
      body: '{}',
    });
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ restarting: true, pid: before.pid });

    await gone(before.pid);
    expect(alive(before.pid)).toBe(false);
    // The successor writes its record once it has announced itself.
    const until = Date.now() + 20000;
    let after: { pid: number; argv?: string[]; connectUrl?: string } | undefined;
    while (Date.now() < until) {
      try { after = recordOf() as typeof after; }
      catch { after = undefined; }
      if (after !== undefined && after.pid !== before.pid) break;
      await new Promise((wait) => setTimeout(wait, 100));
    }
    expect(after?.pid).not.toBe(before.pid);
    if (after !== undefined) spawned.push(after.pid);
    expect(after?.argv).toEqual(before.argv);
    expect(await knock(String(after?.connectUrl))).toBe('open');
  }, 60000);

  it('prints the successor\'s skips when it restarts from the terminal', async () => {
    const began = await cli([
      'start', '--port', '0', '--plugin', BACKEND, '--plugin', SKIPS,
      '--sessions', 'memory', '--automations', 'memory', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const before = recordOf() as { pid: number };
    spawned.push(before.pid);

    const again = await cli(['restart']);
    const after = recordOf() as { pid: number; url: string };
    spawned.push(after.pid);
    expect({ code: again.code, stderr: again.stderr }).toEqual({ code: 0, stderr: '' });
    expect(again.stdout).toBe([
      'skipped: presets.router reads OPENROUTER_API_KEY, which the daemon\'s environment does not have',
      `ahpd on ${after.url} (pid ${String(after.pid)}), restarted from pid ${String(before.pid)}`,
      '',
    ].join('\n'));

    // And the daemon announced them between its own two lines, which is what
    // the terminal reads them out of.
    const log = readFileSync(join(home, 'ahpd', 'daemon.log'), 'utf8');
    expect(log.indexOf('restart: starting the successor')).toBeLessThan(log.lastIndexOf('skipped: presets.router'));
    expect(log.lastIndexOf('skipped: presets.router')).toBeLessThan(log.lastIndexOf('restarted as'));
  }, 90000);

  it('restarts a started daemon from the terminal with the line it was started with', async () => {
    const began = await cli([
      'start', '--port', '0', '--plugin', BACKEND, '--sessions', 'memory', '--automations', 'memory', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const before = recordOf() as { pid: number; argv?: string[] };
    spawned.push(before.pid);

    const again = await cli(['restart']);
    const after = recordOf() as { pid: number; url: string; argv?: string[] };
    spawned.push(after.pid);
    expect({ code: again.code, stderr: again.stderr }).toEqual({ code: 0, stderr: '' });
    expect(again.stdout).toBe(`ahpd on ${after.url} (pid ${String(after.pid)}), restarted from pid ${String(before.pid)}\n`);
    expect(after.pid).not.toBe(before.pid);
    expect(after.argv).toEqual(before.argv);
    await gone(before.pid);
    expect(alive(before.pid)).toBe(false);

    const forced = await cli(['restart', '--force']);
    const last = recordOf() as { pid: number };
    spawned.push(last.pid);
    expect(forced.code).toBe(0);
    expect(last.pid).not.toBe(after.pid);
  }, 90000);

  it('restarts from the terminal, and the successor carries the token its line reads now', async () => {
    put({ plugins: [BACKEND], connectionToken: 'abc' });
    const began = await cli([
      'start', '--config-file', config, '--port', '0', '--sessions', 'memory', '--automations', 'memory', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const before = recordOf();
    spawned.push(before.pid);
    expect(before.connectUrl).toContain('tkn=abc');

    put({ plugins: [BACKEND], connectionToken: 'xyz' });
    const again = await cli(['restart']);
    const after = recordOf();
    spawned.push(after.pid);
    expect({ code: again.code, stderr: again.stderr }).toEqual({ code: 0, stderr: '' });
    expect(after.pid).not.toBe(before.pid);
    expect(after.connectUrl).toContain('tkn=xyz');
    expect(await knock(String(after.connectUrl))).toBe('open');
  }, 90000);

  it('refuses a restart whose line cannot run over the file as it is now, and the daemon runs on', async () => {
    put({ plugins: [BACKEND] });
    const began = await cli([
      'start', '--config-file', config, '--port', '0', '--sessions', 'memory', '--automations', 'memory', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const before = recordOf();
    spawned.push(before.pid);

    put('{ "plugins": [');
    const again = await cli(['restart']);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain('Its line cannot run now, so it was not stopped:');
    expect(alive(before.pid)).toBe(true);
    expect(recordOf().pid).toBe(before.pid);
    expect(await knock(before.connectUrl as string)).toBe('open');
  }, 60000);

  it('refuses a restart whose recorded line this code does not take, and the daemon runs on', async () => {
    const began = await cli([
      'start', '--port', '0', '--plugin', BACKEND, '--sessions', 'memory', '--automations', 'memory', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const before = recordOf();
    spawned.push(before.pid);

    /*
     * A line written by an ahpd that had a flag this one does not, which is
     * what an update under a running daemon leaves in the record: the old
     * daemon carries on holding a line only the new code can read.
     */
    const written = join(home, 'ahpd', 'daemon.json');
    const record = JSON.parse(readFileSync(written, 'utf8')) as Record<string, unknown>;
    writeFileSync(written, JSON.stringify({ ...record, argv: [...(record['argv'] as string[]), '--frobnicate'] }));

    // The refusal carries the successor's own words, because they are what it
    // would have died of, with the daemon that holds the line still up.
    const again = await cli(['restart']);
    expect(again.code).toBe(1);
    expect(again.stderr).toBe('ahpd: Its line cannot run now, so it was not stopped: Unknown option --frobnicate.\n');
    expect(alive(before.pid)).toBe(true);
    expect(recordOf().pid).toBe(before.pid);
    expect(await knock(before.connectUrl as string)).toBe('open');
  }, 60000);

  it('restarts on a fixed port at the same URL, and a session made before is listed after', async () => {
    const port = await freePort();
    const began = await cli([
      'start', '--port', String(port), '--path', home, '--plugin', KEPT, '--automations', 'memory', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const before = recordOf();
    spawned.push(before.pid);
    expect(before.url).toBe(`ws://127.0.0.1:${String(port)}`);
    await rpc(`${before.url}/`, [INITIALIZE, { method: 'createSession', params: { channel: 'ahp-session:/kept-1', provider: 'kept' } }]);

    const again = await cli(['restart']);
    const after = recordOf();
    spawned.push(after.pid);
    expect({ code: again.code, stderr: again.stderr }).toEqual({ code: 0, stderr: '' });
    expect(after.pid).not.toBe(before.pid);
    expect(after.url).toBe(before.url);

    const [, listed] = await rpc(`${after.url}/`, [INITIALIZE, { method: 'listSessions', params: {} }]) as [unknown, { items: { resource: string }[] }];
    expect(listed.items.map((row) => row.resource)).toContain('kept:/kept-1');
  }, 90000);

  it('lets a stop sent while a restart is stopping win, and leaves no daemon running', async () => {
    const release = join(home, 'release');
    const began = await cli([
      'start', '--port', '0', '--plugin', BACKEND, '--plugin', SLOW_STOP, '--sessions', 'memory', '--automations', 'memory', '--no-update-check',
    ], { env: { AHPD_RELEASE: release } });
    expect(began.code).toBe(0);
    const before = recordOf();
    spawned.push(before.pid);

    const restarting = cli(['restart']);
    // The receipt is written before the `stopping` handler, which holds until the file exists.
    const log = join(home, 'ahpd', 'daemon.log');
    const until = Date.now() + 10000;
    while (!readFileSync(log, 'utf8').includes('restart: stopping (SIGHUP)') && Date.now() < until) {
      await new Promise((wait) => setTimeout(wait, 25));
    }
    expect(readFileSync(log, 'utf8')).toContain('restart: stopping (SIGHUP)');
    const stopped = await cli(['stop']);
    expect(stopped.code).toBe(0);
    writeFileSync(release, '');

    const restarted = await restarting;
    expect(restarted.code).toBe(1);
    expect(restarted.stderr).toContain('stopped first');
    await gone(before.pid);
    expect(alive(before.pid)).toBe(false);
    expect(existsSync(join(home, 'ahpd', 'daemon.json'))).toBe(false);
    expect(announced().filter(alive)).toEqual([]);
  }, 60000);

  it('leaves a foreground daemon to the default for either restart signal, which ends it', async () => {
    expect(await signalled('SIGHUP')).toBe('SIGHUP');
    expect(await signalled('SIGUSR2')).toBe('SIGUSR2');
  }, 60000);

  it('says none is running to restart', async () => {
    const said = await cli(['restart']);
    expect(said.code).toBe(1);
    expect(said.stderr).toContain('None running in the background');
  });
});
