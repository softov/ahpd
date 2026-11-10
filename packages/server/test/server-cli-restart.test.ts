/*
 * What `ahpd` does at the command line, as `server-cli.test.ts` says.
 *
 * `restart`, from the terminal and over HTTP, which starts two daemons a case.
 */
import { posix } from '../../../tools/posix.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alive, announced, BACKEND, cli, config, fakeSystemctl, foreground, freePort, gone, home, INITIALIZE, KEPT, knock, put, recordOf, rpc, signalled, SKIPS, SLOW_STOP, spawned, supervised, systemctlAsked } from './cli.js';

describe('start, stop and status', () => {
  it('restarts a started daemon over HTTP with the line it was started with', async () => {
    put({ httpApi: true, plugins: [BACKEND] });
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
    expect(await answered.json()).toEqual({ restarting: true, pid: before.pid, restartDelayMs: 3000 });

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
    expect(listed.items.map((row) => row.resource)).toContain('ahp-session:/kept-1');
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
    // Windows has no SIGHUP, so a restart reaches the daemon there by its control pipe.
    const receipt = `restart: stopping (${posix ? 'SIGHUP' : 'control pipe'})`;
    const until = Date.now() + 10000;
    while (!readFileSync(log, 'utf8').includes(receipt) && Date.now() < until) {
      await new Promise((wait) => setTimeout(wait, 25));
    }
    expect(readFileSync(log, 'utf8')).toContain(receipt);
    // The stop waits for the daemon to go, and this daemon is held inside the
    // `stopping` handler: the release is written from under it, so the stop
    // lands while the handler runs and then waits the handler out.
    const stopping = cli(['stop']);
    setTimeout(() => { writeFileSync(release, ''); }, 3000);
    const stopped = await stopping;
    expect(stopped.code).toBe(0);
    // It went, so the stop waited rather than killing at the limit.
    expect(stopped.stdout).toContain('Stopped');

    const restarted = await restarting;
    expect(restarted.code).toBe(1);
    expect(restarted.stderr).toContain('stopped first');
    await gone(before.pid);
    expect(alive(before.pid)).toBe(false);
    expect(existsSync(join(home, 'ahpd', 'daemon.json'))).toBe(false);
    expect(announced().filter(alive)).toEqual([]);
  }, 60000);

  // Windows cannot send SIGHUP or SIGUSR2, so there is no default to leave it to.
  it.skipIf(!posix)('leaves a foreground daemon to the default for either restart signal, which ends it', async () => {
    expect(await signalled('SIGHUP')).toBe('SIGHUP');
    expect(await signalled('SIGUSR2')).toBe('SIGUSR2');
  }, 60000);

  /*
   * A daemon a service manager holds, from both ends: `ahpd stop` asks the
   * manager and nothing else, and a restart asked over HTTP is handed to the
   * manager, which is the one that starts the next daemon. The machine this
   * runs on has no systemd user session, so the manager is the stand-in that
   * says what it was asked and does what the case names.
   */
  // A service manager is systemd or launchd, and Windows has neither: the
  // stand-in `systemctl` is a shell script, and `ahpd service install` refuses there.
  it.skipIf(!posix)('stops a supervised daemon by asking the service manager for it', async () => {
    const daemon = await supervised();
    // The manager is what stops it: the half of `systemctl stop` that matters
    // here is the signal the real one sends the daemon it holds.
    const stopped = await cli(['stop'], { env: fakeSystemctl(`kill -TERM ${String(daemon.pid)}`) });
    expect({ code: stopped.code, stderr: stopped.stderr }).toEqual({ code: 0, stderr: '' });
    expect(stopped.stdout).toBe(`Stopped ${daemon.url} (pid ${String(daemon.pid)}).\n`);
    expect(systemctlAsked()).toEqual(['--user', 'stop', 'ahpd']);
    // It went, so no kill was needed, and the record went with it: a daemon
    // still there is one the manager is still stopping, which is said and not
    // forced.
    await gone(daemon.pid);
    expect(alive(daemon.pid)).toBe(false);
    expect(existsSync(join(home, 'ahpd', 'daemon.json'))).toBe(false);
  }, 60000);

  /*
   * A container daemon is stopped by stopping the container: the restart policy
   * starts again what leaves, so a stop from inside is a restart.
   */
  it('refuses to stop a container daemon, and sends it no signal', async () => {
    const daemon = await supervised([], { AHPD_SERVICE: 'container' });
    // It writes its own record, naming the container, and no service name:
    // that is a name only a manager holds a daemon beside another under.
    expect(recordOf().service).toBe('container');
    expect(recordOf().serviceName).toBeUndefined();
    // `status` reads the same record every daemon writes, and exits 0.
    const shown = await cli(['status', '--json']);
    expect(shown.code).toBe(0);
    expect(JSON.parse(shown.stdout)).toMatchObject({ pid: daemon.pid, service: 'container' });
    const stopped = await cli(['stop']);
    expect(stopped.code).toBe(1);
    expect(stopped.stderr).toContain('This daemon runs in a container; stop the container instead.');
    // Nothing was sent and nothing was forgotten: it still runs, and its
    // record still says where.
    expect(alive(daemon.pid)).toBe(true);
    expect(existsSync(join(home, 'ahpd', 'daemon.json'))).toBe(true);
  }, 60000);

  // A service manager is systemd or launchd, and Windows has neither.
  it.skipIf(!posix)('hands a restarted supervised daemon to the service manager, and starts nothing itself', async () => {
    put({ httpApi: true, plugins: [BACKEND], connectionToken: 'abc' });
    const daemon = await supervised(['--config-file', config, '--connection-token', 'abc'], fakeSystemctl());
    const api = `http://127.0.0.1:${new URL(daemon.url).port}/api/restart`;

    const answered = await fetch(api, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer abc' },
      body: '{}',
    });
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ restarting: true, pid: daemon.pid, restartDelayMs: 3000 });

    // The stop the restart begins with is the manager's, so no successor is
    // started from here, and the record goes before it is asked: the daemon the
    // manager starts next serves this same configuration folder.
    await gone(daemon.pid);
    expect(await daemon.ended).toBe(0);
    expect(existsSync(join(home, 'ahpd', 'daemon.json'))).toBe(false);
    expect(systemctlAsked()).toEqual(['--user', '--no-block', 'restart', 'ahpd']);
    // A daemon a manager started writes no log file: its own words go where the
    // unit sends them, which is this case's pipe.
    expect(daemon.said()).toContain('restart: handed to the service manager');
    // The stand-in does not start one, and neither did the daemon.
    await new Promise((wait) => { setTimeout(wait, 500); });
    expect(announced().filter(alive)).toEqual([]);
  }, 60000);

  /*
   * A daemon that runs beside another, under the service its configuration
   * names: it records that name, and both a stop and its own restart ask the
   * manager for that service rather than for the plain one.
   */
  it.skipIf(!posix)('stops a daemon a named service holds by asking for that service', async () => {
    put({ service: { name: 'two' } });
    const daemon = await supervised(['--config-file', config]);
    expect(recordOf().serviceName).toBe('two');
    const stopped = await cli(['stop'], { env: fakeSystemctl(`kill -TERM ${String(daemon.pid)}`) });
    expect({ code: stopped.code, stderr: stopped.stderr }).toEqual({ code: 0, stderr: '' });
    expect(systemctlAsked()).toEqual(['--user', 'stop', 'ahpd@two']);
    await gone(daemon.pid);
  }, 60000);

  it.skipIf(!posix)('hands the restart of a daemon a named service holds to that service', async () => {
    put({ httpApi: true, plugins: [BACKEND], connectionToken: 'abc', service: { name: 'two' } });
    const daemon = await supervised(['--config-file', config, '--connection-token', 'abc'], fakeSystemctl());
    const answered = await fetch(`http://127.0.0.1:${new URL(daemon.url).port}/api/restart`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer abc' },
      body: '{}',
    });
    expect(answered.status).toBe(200);
    await gone(daemon.pid);
    expect(systemctlAsked()).toEqual(['--user', '--no-block', 'restart', 'ahpd@two']);
  }, 60000);

  it('says none is running to restart', async () => {
    const said = await cli(['restart']);
    expect(said.code).toBe(1);
    expect(said.stderr).toContain('None running in the background');
  });
});
