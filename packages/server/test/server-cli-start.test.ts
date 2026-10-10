/*
 * What `ahpd` does at the command line, as `server-cli.test.ts` says.
 *
 * `start`, `stop` and `status`, with a daemon started in the background.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alive, BACKEND, cli, config, daemonEnv, ENV, gone, home, knock, MAIN, MULTILINE, recordOf, REPO, SKIPS, spawned, THROWS } from './cli.js';

describe('start, stop and status', () => {
  it('says none is running when none is, from stop and from status', async () => {
    for (const verb of ['stop', 'status']) {
      const said = await cli([verb]);
      expect(said.code).toBe(1);
      expect(said.stdout).toBe('');
      expect(said.stderr).toBe('ahpd: None running.\n');
    }
  });

  it('a global before start still starts the daemon the record names', async () => {
    const began = await cli([
      '--no-color', 'start', '--port', '0', '--plugin', BACKEND,
      '--automations', 'memory', '--sessions', 'memory', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const record = JSON.parse(readFileSync(join(home, 'ahpd', 'daemon.json'), 'utf8')) as { pid: number };
    spawned.push(record.pid);

    const status = await cli(['status']);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain(`(pid ${String(record.pid)})`);

    const stopped = await cli(['stop']);
    expect(stopped.code).toBe(0);
    await gone(record.pid);
    expect(alive(record.pid)).toBe(false);
  }, 40000);

  it('forwards an option typed before start, token and all', async () => {
    const began = await cli([
      '--connection-token', 'abc', 'start', '--port', '0', '--plugin', BACKEND, '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const record = recordOf();
    spawned.push(record.pid);

    expect(readFileSync(join(home, 'ahpd', 'daemon.log'), 'utf8')).not.toContain('no token: loopback only');
    expect(record.connectUrl).toContain('tkn=abc');
    expect(await knock(String(record.connectUrl))).toBe('open');
    // A loopback daemon with no token opens to anyone, so only a refusal here
    // shows the token reached the child.
    expect(await knock(record.url)).not.toBe('open');
  }, 40000);

  it('records the line the child was given, and not the parent\'s globals', async () => {
    const began = await cli([
      '--no-color', 'start', '--port', '0', '--path', home, '--plugin', BACKEND, '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const record = JSON.parse(readFileSync(join(home, 'ahpd', 'daemon.json'), 'utf8')) as { pid: number; argv?: string[] };
    spawned.push(record.pid);
    expect(record.argv).toEqual(['--port', '0', '--path', home, '--plugin', BACKEND, '--no-update-check']);
  }, 40000);

  it('forwards --plugin-option to the child, which loads with it', async () => {
    // The schema fixture requires `command`, so it loads only when the flag reached the child.
    const schema = join(import.meta.dirname, 'fixtures', 'plugin-schema', 'index.ts');
    const began = await cli([
      'start', '--port', '0', '--plugin', BACKEND, '--plugin', schema,
      '--plugin-option', `${schema}.command=run`, '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const record = JSON.parse(readFileSync(join(home, 'ahpd', 'daemon.json'), 'utf8')) as { pid: number; argv?: string[] };
    spawned.push(record.pid);
    expect(record.argv).toContain(`${schema}.command=run`);
    const log = readFileSync(join(home, 'ahpd', 'daemon.log'), 'utf8');
    expect(log).toContain('plugins echo-plugin, schema');
    expect(log).not.toContain('skipped');
  }, 40000);

  it('prints what a plugin failed on, and what a plugin skipped, before it says it started', async () => {
    // Both cost one item and not the daemon: the throwing plugin and the one
    // that dropped a preset are both told about, and the echo backend is still
    // served, so the start exits 0 either way.
    const began = await cli([
      'start', '--port', '0', '--plugin', BACKEND, '--plugin', THROWS, '--plugin', SKIPS,
      '--sessions', 'memory', '--automations', 'memory', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const record = JSON.parse(readFileSync(join(home, 'ahpd', 'daemon.json'), 'utf8')) as { pid: number; skipped?: string[] };
    spawned.push(record.pid);

    const lines = began.stdout.split('\n');
    const up = lines.findIndex((line) => line.startsWith('ahpd on ws://'));
    expect(up).toBeGreaterThan(0);
    expect(lines.slice(0, up)).toEqual([
      expect.stringMatching(/^skipped: plugin throws failed in \d+ ms: the throws fixture threw on purpose$/u),
      'skipped: presets.router reads OPENROUTER_API_KEY, which the daemon\'s environment does not have',
    ]);
    // The record carries them too, which is how the same lines reach a restart.
    expect(record.skipped).toHaveLength(2);
  }, 40000);

  it('prints a problem that is two lines as one line, and keeps the whole of it', async () => {
    const began = await cli([
      'start', '--port', '0', '--plugin', BACKEND, '--plugin', MULTILINE,
      '--sessions', 'memory', '--automations', 'memory', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const record = JSON.parse(readFileSync(join(home, 'ahpd', 'daemon.json'), 'utf8')) as { pid: number; skipped?: string[] };
    spawned.push(record.pid);

    // One line, both halves of it: a reader takes the `skipped: ` lines off the
    // announcement by line, and the second half of a thrown stack would be the
    // one line nothing knows what to do with.
    expect(record.skipped).toHaveLength(1);
    expect(began.stdout).toContain('skipped: plugin multiline failed in');
    expect(began.stdout).toContain('the multiline fixture threw: and this is the second line\n');
  }, 40000);

  it('takes AHPD_DETACHED out of a started daemon\'s environment, so a session\'s shell never has it', async () => {
    const began = await cli(['start', '--port', '0', '--plugin', BACKEND, '--plugin', ENV, '--sessions', 'memory', '--automations', 'memory', '--no-update-check']);
    expect(began.code).toBe(0);
    spawned.push(recordOf().pid);
    const log = readFileSync(join(home, 'ahpd', 'daemon.log'), 'utf8');
    expect(log).toContain('AHPD_DETACHED unset');
  }, 40000);

  it('forwards a value typed before start, port and all', async () => {
    const began = await cli(['--port', '0', 'start', '--plugin', BACKEND, '--no-update-check']);
    expect(began.code).toBe(0);
    const record = recordOf();
    spawned.push(record.pid);

    expect(record.url.startsWith('ws://127.0.0.1:')).toBe(true);
    expect(record.url).not.toBe('ws://127.0.0.1:9187');
  }, 40000);

  it('takes the start that is the word, not one that is a value', async () => {
    const began = await cli([
      '--path', 'start', 'start', '--port', '0', '--plugin', BACKEND, '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const record = recordOf();
    spawned.push(record.pid);

    // A daemon announces itself once, so one line is one daemon.
    const log = readFileSync(join(home, 'ahpd', 'daemon.log'), 'utf8');
    expect(log.match(/ahpd on ws:\/\//gu)).toHaveLength(1);

    const status = await cli(['status']);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain(`(pid ${String(record.pid)})`);

    const stopped = await cli(['stop']);
    expect(stopped.code).toBe(0);
    await gone(record.pid);
    expect(alive(record.pid)).toBe(false);
  }, 40000);

  it('reports a live record without the token it holds', async () => {
    writeFileSync(join(home, 'ahpd', 'daemon.json'), JSON.stringify({
      pid: process.pid,
      url: 'ws://127.0.0.1:9187',
      connectUrl: 'ws://127.0.0.1:9187/?tkn=secret',
      paths: ['/x'],
      automations: 'in /c, schedules fire',
      startedAt: '2026-09-18T12:00:00.000Z',
    }));
    const said = await cli(['status', '--no-update-check']);
    expect(said.code).toBe(0);
    expect(said.stdout).toBe(
      `ahpd on ws://127.0.0.1:9187 (pid ${String(process.pid)}), started 2026-09-18T12:00:00.000Z\n`
      + 'sessions in /x\n'
      + 'automations in /c, schedules fire\n',
    );
    expect(said.stdout).not.toContain('secret');
  });

  it('turns the update check off from the flag and from the configuration', async () => {
    writeFileSync(join(home, 'ahpd', 'daemon.json'), JSON.stringify({
      pid: process.pid, url: 'ws://127.0.0.1:9187', paths: [], startedAt: '2026-09-18T12:00:00.000Z',
    }));
    writeFileSync(join(home, 'ahpd', 'update.json'), JSON.stringify({ name: '@ahpd/server', latest: '9.9.9', checkedAt: '2026-09-18T12:00:00Z' }));
    const unset = ['CI', 'NO_UPDATE_NOTIFIER'];
    const on = await cli(['status'], { unset });
    expect(on.stdout.split('\n')).toHaveLength(3);
    expect(on.stdout).toContain('update:');
    const without = await cli(['status', '--no-update-check'], { unset });
    expect(without.stdout.split('\n')).toHaveLength(2);
    expect(without.stdout).not.toContain('update:');
    writeFileSync(join(home, 'ahpd', 'config.json'), '{ "updateCheck": false }\n');
    const fromFile = await cli(['status'], { unset });
    expect(fromFile.stdout.split('\n')).toHaveLength(2);
    expect(fromFile.stdout).not.toContain('update:');
  });

  it('starts the daemon under the node flags the parent was given', async () => {
    // The dev runner puts its loader on node's own argv rather than in
    // `NODE_OPTIONS`, so `cli()` cannot reproduce it: its child inherits the
    // environment whatever `start` passes on. This spawns the runner's shape.
    const child = spawn(
      process.execPath,
      ['--conditions', 'development', '--import', './scripts/dev.mjs', MAIN, 'start', '--port', '0', '--plugin', BACKEND, '--no-update-check'],
      { cwd: REPO, env: daemonEnv({}, ['NODE_OPTIONS']), stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let err = '';
    child.stderr.on('data', (chunk: Buffer) => { err += String(chunk); });
    child.stdout.on('data', () => { /* drained, so a full pipe cannot block it */ });
    child.stdin.end();
    const code = await new Promise<number | null>((done) => { child.on('exit', (one) => done(one)); });
    expect({ code, err }).toEqual({ code: 0, err: '' });

    const record = recordOf();
    spawned.push(record.pid);
    const status = await cli(['status']);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain(record.url);
    const stopped = await cli(['stop']);
    expect(stopped.code).toBe(0);
  }, 40000);
});
