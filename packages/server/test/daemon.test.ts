/*
 * The daemon record.
 *
 * What a detached daemon writes about itself, and what every reader may print.
 * The origin is token-free and the ready URL carries the secret, so the tests
 * that matter are the ones that hold the two apart: `url` for the verbs, and
 * `connectUrl` for the person copying it out of the 0600 file.
 */

import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  announcementOf, claim, configuredMs, CONTAINER_STOP, controlFor, deliver, forget, logSince, READY_TIMEOUT_MS, readyUrl, recordOf, rewritePaths,
  running, serviceIn, start, statusLine, stop, STOP_WAIT_MS,
} from '../src/daemon.js';
import { automationStatePath, isIdentifier, hostId, namedIssuer, personalUrl, policiesPath, signInIdentifier, vaultPath } from '../src/config.js';
import type { Control, Running } from '../src/daemon.js';
import type { Held, Manager } from '../src/service.js';
import { posix } from '../../../tools/posix.ts';

const REPO = join(import.meta.dirname, '../../..');
const MAIN = 'packages/server/src/main.ts';

const ANNOUNCED = 'ahpd on ws://127.0.0.1:9187 (node), sessions in /a, /b\nautomations in /c, schedules fire\n';

describe('announcementOf', () => {
  const block = (port: number, pid: number): string =>
    `ahpd on ws://127.0.0.1:${String(port)} (node), sessions in /p${String(pid)}\npid ${String(pid)}\nautomations in /c, schedules fire\n`;

  it('takes the announcement holding that pid, whatever another daemon wrote around it', () => {
    const log = `2026-09-30T00:00:00.000Z restart: starting the successor\n${block(9001, 11)}some line\n${block(9002, 12)}`;
    expect(recordOf(announcementOf(log, 12) as string, 12).url).toBe('ws://127.0.0.1:9002');
    expect(recordOf(announcementOf(log, 11) as string, 11).paths).toEqual(['/p11']);
    expect(announcementOf(log, 13)).toBeUndefined();
  });

  it('answers nothing for an announcement with no pid line, such as another daemon\'s', () => {
    expect(announcementOf(ANNOUNCED, 42)).toBeUndefined();
  });
});

describe('signInIdentifier', () => {
  it('is the identifier an operator named', () => {
    expect(signInIdentifier({ resource: 'https://ahpd.example.com/', host: '127.0.0.1', port: 9187 }, 'box'))
      .toBe('https://ahpd.example.com/');
  });
  it('derives an https identifier from where the daemon listens', () => {
    expect(signInIdentifier({ host: '127.0.0.1', port: 9187 }, 'box')).toBe('https://127.0.0.1:9187/');
  });
  it('stands the machine name in for a wildcard address', () => {
    // 0.0.0.0 is every interface and names nothing a client can be told.
    expect(signInIdentifier({ host: '0.0.0.0', port: 9187 }, 'box')).toBe('https://box:9187/');
    expect(signInIdentifier({ host: '', port: 9187 }, 'box')).toBe('https://box:9187/');
  });
  it('leaves out a port the OS was asked to choose', () => {
    expect(signInIdentifier({ host: '127.0.0.1', port: 0 }, 'box')).toBe('https://127.0.0.1/');
  });
  it('accepts only what the record requires: https and no fragment', () => {
    expect(isIdentifier('https://ahpd.example.com/')).toBe(true);
    expect(isIdentifier('https://ahpd.example.com/prefix')).toBe(true);
    expect(isIdentifier('http://ahpd.example.com/')).toBe(false);
    expect(isIdentifier('ahpd://users')).toBe(false);
    expect(isIdentifier('https://ahpd.example.com/#a')).toBe(false);
  });
});

describe('readyUrl', () => {
  it('puts the token in the query', () => {
    expect(readyUrl('ws://127.0.0.1:9187', 'abc')).toBe('ws://127.0.0.1:9187/?tkn=abc');
  });
  it('is the bare origin when no token was given', () => {
    expect(readyUrl('ws://127.0.0.1:9187', undefined)).toBe('ws://127.0.0.1:9187/');
  });
});

describe('namedIssuer', () => {
  it('is the GitHub preset', () => {
    expect(namedIssuer('github')).toEqual({ kind: 'github' });
  });
  it('is an OpenID Connect issuer when an https URL is named', () => {
    expect(namedIssuer('https://idp.test')).toEqual({ kind: 'oidc', issuer: 'https://idp.test' });
  });
  it('is one on loopback over plain http too, which is where a local issuer lives', () => {
    expect(namedIssuer('http://127.0.0.1:9310')).toEqual({ kind: 'oidc', issuer: 'http://127.0.0.1:9310' });
    expect(namedIssuer('http://localhost:9310')).toEqual({ kind: 'oidc', issuer: 'http://localhost:9310' });
  });
  it('answers nothing for anything else, so the daemon refuses the start', () => {
    expect(namedIssuer('GitHub')).toBeUndefined();
    expect(namedIssuer('http://idp.test')).toBeUndefined();
    expect(namedIssuer('http://192.168.1.5:9310')).toBeUndefined();
    expect(namedIssuer('idp.test')).toBeUndefined();
    expect(namedIssuer('https://idp.test/#fragment')).toBeUndefined();
  });
});

describe('personalUrl', () => {
  it('carries the secret in the query, which is what a client pastes', () => {
    expect(personalUrl('abc', '127.0.0.1', 9187, 'box')).toBe('ws://127.0.0.1:9187/?tkn=abc');
  });
  it('encodes a secret so that a URL does not break it', () => {
    expect(personalUrl('a/b+c=', '127.0.0.1', 9187, 'box')).toBe('ws://127.0.0.1:9187/?tkn=a%2Fb%2Bc%3D');
  });
  it('stands the machine name in for a wildcard address', () => {
    expect(personalUrl('abc', '0.0.0.0', 9187, 'box')).toBe('ws://box:9187/?tkn=abc');
  });
  it('brackets an IPv6 host so a URL parser reads it back', () => {
    expect(personalUrl('abc', '::1', 9187, 'box')).toBe('ws://[::1]:9187/?tkn=abc');
    expect(new URL(personalUrl('abc', '::1', 9187, 'box')).hostname).toBe('[::1]');
  });
});

describe('serviceIn', () => {
  it('reads the container kind beside the two managers, and nothing for a name it does not know', () => {
    expect(serviceIn('container')).toBe('container');
    expect(serviceIn('systemd')).toBe('systemd');
    expect(serviceIn('launchd')).toBe('launchd');
    // A name from a newer ahpd leaves a daemon that runs as any other, rather
    // than one that will not start under its own unit.
    expect(serviceIn('docker')).toBeUndefined();
    expect(serviceIn(undefined)).toBeUndefined();
  });
});

describe('recordOf', () => {
  it('splits the announcement into the record', () => {
    const record = recordOf(ANNOUNCED, 42, 'abc');
    expect(record.pid).toBe(42);
    expect(record.url).toBe('ws://127.0.0.1:9187');
    expect(record.connectUrl).toBe('ws://127.0.0.1:9187/?tkn=abc');
    expect(record.paths).toEqual(['/a', '/b']);
    expect(record.automations).toBe('in /c, schedules fire');
  });

  it('keeps the arguments the child was given', () => {
    const argv = ['--path', '/x', '--plugin-option', 'a.b=1'];
    expect(recordOf(ANNOUNCED, 42, 'abc', argv).argv).toEqual(argv);
  });

  it('names a container, and holds no name, which only a manager installed under one gives', () => {
    const record = recordOf(ANNOUNCED, 42, 'abc', undefined, undefined, 'container');
    expect(record.service).toBe('container');
    expect(record.serviceName).toBeUndefined();
  });

  it('keeps what the child said it skipped, and no field when it said nothing', () => {
    // The line each one starts with, because a problem may begin with any word
    // at all and this announcement is the only place the two are told apart.
    const said = `${ANNOUNCED}skipped: plugin throws failed in 3 ms: it threw\nskipped: presets.router reads OPENROUTER_API_KEY\nplugins echo-plugin\n`;
    expect(recordOf(said, 42, 'abc').skipped).toEqual([
      'plugin throws failed in 3 ms: it threw',
      'presets.router reads OPENROUTER_API_KEY',
    ]);
    expect(recordOf(ANNOUNCED, 42, 'abc').skipped).toBeUndefined();
  });

  it('carries the control it is given, and no field when it is given none', () => {
    const control: Control = { pipe: '\\\\.\\pipe\\ahpd-abc', connectionToken: 'def' };
    expect(recordOf(ANNOUNCED, 42, 'abc', undefined, control).control).toEqual(control);
    expect(recordOf(ANNOUNCED, 42, 'abc').control).toBeUndefined();
  });

  it('reads the API origin off the announcement, without the path its routes hang off', () => {
    // The line `run.ts` writes when there is an API: the origin a caller needs,
    // and the prefix its routes are under, which is not part of the origin.
    const said = `${ANNOUNCED}http on http://127.0.0.1:9187/api\n`;
    expect(recordOf(said, 42, 'abc').api).toBe('http://127.0.0.1:9187');
  });

  it('carries no api for a daemon that serves none', () => {
    expect(recordOf(ANNOUNCED, 42, 'abc').api).toBeUndefined();
  });

  it('reads the start folder off the announcement, and no field without the line', () => {
    const said = `${ANNOUNCED}start folder /a\n`;
    expect(recordOf(said, 42, 'abc').startFolder).toBe('/a');
    expect(recordOf(ANNOUNCED, 42, 'abc').startFolder).toBeUndefined();
  });

  it('keeps the connectionToken out of every field a verb prints', () => {
    const control = controlFor('win32') as Control;
    const record = recordOf(ANNOUNCED, 42, 'abc', undefined, control);
    // What `ahpd start` and `ahpd status` render from, and the one line status
    // builds. The token belongs in the 0600 record and on no line.
    expect(control.connectionToken).toMatch(/^[0-9a-f]{64}$/u);
    const printed = [record.url, record.connectUrl, statusLine(record), ...record.paths, record.automations as string];
    for (const said of printed) expect(said).not.toContain(control.connectionToken);
    expect(JSON.stringify({ url: record.url, paths: record.paths })).not.toContain(control.connectionToken);
  });
});

describe('controlFor', () => {
  it('makes a named pipe and a connectionToken on win32, and nothing elsewhere', () => {
    expect(controlFor('linux')).toBeUndefined();
    expect(controlFor('darwin')).toBeUndefined();
    const control = controlFor('win32') as Control;
    // The application's name and a random UUID under the pipe namespace, as VS
    // Code's CLI names its pipe (cli/src/async_pipe.rs L179-L188 at 6b68d3fe),
    // and a token of 32 bytes as hex under VS Code's name for the token its
    // local endpoint requires (LOCAL_ENDPOINT.md L75 at 6b68d3fe).
    expect(control.pipe).toMatch(/^\\\\\.\\pipe\\ahpd-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(control.connectionToken).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('makes a new pipe and a new connectionToken each time, so no other process can take one', () => {
    const one = controlFor('win32') as Control;
    const two = controlFor('win32') as Control;
    expect(one.pipe).not.toBe(two.pipe);
    expect(one.connectionToken).toMatch(/^[0-9a-f]{64}$/u);
    expect(one.connectionToken).not.toBe(two.connectionToken);
  });

  it('takes the pipe name it is given, which is how a case here holds the other end', () => {
    // The control path is `node:net` on both platforms, so a Linux case drives
    // it over a unix socket path rather than a named pipe.
    const control = controlFor('win32', '/tmp/ahpd-control.sock') as Control;
    expect(control.pipe).toBe('/tmp/ahpd-control.sock');
    expect(control.connectionToken).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe('the record on disk', () => {
  let home: string;
  let had: string | undefined;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ahpd-daemon-'));
    had = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = home;
    mkdirSync(join(home, 'ahpd'), { recursive: true });
  });
  afterEach(() => {
    if (had === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = had;
    rmSync(home, { recursive: true, force: true });
  });
  const put = (record: Running): void => {
    writeFileSync(join(home, 'ahpd', 'daemon.json'), `${JSON.stringify(record)}\n`);
  };

  it('reads a live record back with both URLs', () => {
    put({ pid: process.pid, url: 'ws://127.0.0.1:9187', connectUrl: 'ws://127.0.0.1:9187/?tkn=abc', paths: [], startedAt: '2026-09-19T00:00:00.000Z' });
    const found = running();
    expect(found?.url).toBe('ws://127.0.0.1:9187');
    expect(found?.connectUrl).toBe('ws://127.0.0.1:9187/?tkn=abc');
  });

  it('reads a record an older daemon wrote, which has no argv', () => {
    put({ pid: process.pid, url: 'ws://127.0.0.1:9187', connectUrl: 'ws://127.0.0.1:9187/', paths: ['/a'], startedAt: '2026-09-19T00:00:00.000Z' });
    const found = running();
    expect(found?.paths).toEqual(['/a']);
    expect(found?.argv).toBeUndefined();
  });

  // The stop's wait is VS Code's CLI's five seconds before a forced kill
  // (cli/src/tunnels/agent_host.rs L736-L752 at 6b68d3fe), the start's
  // upstream's minute, each the configuration's to say otherwise.
  it('reads the start\'s and the stop\'s waits from the configuration, a minute and five seconds when it names neither', () => {
    expect(configuredMs('stopWaitMs', STOP_WAIT_MS)).toBe(5_000);
    expect(configuredMs('readyTimeoutMs', READY_TIMEOUT_MS)).toBe(60_000);
    writeFileSync(join(home, 'ahpd', 'config.json'), JSON.stringify({ stopWaitMs: 2500, readyTimeoutMs: 0 }));
    expect(configuredMs('stopWaitMs', STOP_WAIT_MS)).toBe(2500);
    expect(configuredMs('readyTimeoutMs', READY_TIMEOUT_MS)).toBe(0);
  });

  // daemonRecord schemaVersion: VS Code's CLI ignores a registry entry of
  // another schemaVersion (cli/src/tunnels/agent_host_registry.rs L36-L42,
  // L217-L228 at 6b68d3fe).
  it('writes its schemaVersion, and under daemonRecord schemaVersion ignores a record of another and leaves it', () => {
    expect(recordOf('ahpd on ws://127.0.0.1:9187', process.pid).schemaVersion).toBe(1);
    put({ pid: process.pid, url: 'ws://127.0.0.1:9187', connectUrl: 'ws://127.0.0.1:9187/', paths: [], startedAt: '2026-09-19T00:00:00.000Z' });
    expect(running('schemaVersion')).toBeUndefined();
    expect(running('fields')?.pid).toBe(process.pid);
    writeFileSync(join(home, 'ahpd', 'config.json'), JSON.stringify({ daemonRecord: 'schemaVersion' }));
    expect(running()).toBeUndefined();
    expect(existsSync(join(home, 'ahpd', 'daemon.json'))).toBe(true);
    put({ schemaVersion: 1, pid: process.pid, url: 'ws://127.0.0.1:9187', connectUrl: 'ws://127.0.0.1:9187/', paths: [], startedAt: '2026-09-19T00:00:00.000Z' });
    expect(running()?.pid).toBe(process.pid);
  });

  it('prints the token-free origin through statusLine', () => {
    const record: Running = { pid: 42, url: 'ws://127.0.0.1:9187', connectUrl: 'ws://127.0.0.1:9187/?tkn=secret', paths: [], startedAt: '2026-09-19T00:00:00.000Z' };
    const line = statusLine(record);
    expect(line).toBe('ahpd on ws://127.0.0.1:9187 (pid 42), started 2026-09-19T00:00:00.000Z');
    expect(line).not.toContain('secret');
    expect(line).not.toContain('connectUrl');
  });

  it('names the service manager holding it, and says nothing where none does', () => {
    const record: Running = { pid: 42, url: 'ws://127.0.0.1:9187', connectUrl: '', paths: [], startedAt: '2026-09-19T00:00:00.000Z', service: 'launchd' };
    expect(statusLine(record)).toBe('ahpd on ws://127.0.0.1:9187 (pid 42), started 2026-09-19T00:00:00.000Z, under launchd');
    // A daemon from `ahpd start` is held by nobody, and its line is what it was.
    expect(statusLine({ pid: 42, url: 'ws://127.0.0.1:9187', startedAt: '2026-09-19T00:00:00.000Z' }))
      .toBe('ahpd on ws://127.0.0.1:9187 (pid 42), started 2026-09-19T00:00:00.000Z');
  });

  /** A record naming `pid`, alive for as long as that process is, held by `service` when one does. */
  const naming = (pid: number, service?: Held): Running => ({
    pid, url: `ws://127.0.0.1:${String(pid % 60000)}`, connectUrl: '', paths: [], startedAt: '',
    ...(service === undefined ? {} : { service }),
  });
  /**
   * The manager of a machine a case does not need one for: no record written
   * below names a service unless the case says so. It throws rather than doing
   * nothing, because a call to it is a case that went the wrong way.
   */
  const noManager: Manager = {
    stop: () => Promise.reject(new Error('no service manager holds this record')),
    restart: () => Promise.reject(new Error('no service manager holds this record')),
  };
  const onDisk = (): number | undefined => (existsSync(join(home, 'ahpd', 'daemon.json'))
    ? (JSON.parse(readFileSync(join(home, 'ahpd', 'daemon.json'), 'utf8')) as Running).pid
    : undefined);

  /*
   * A restart that a person ran `ahpd stop` and `ahpd start` in the middle of:
   * this process is the restarting daemon, and the parent is the daemon the
   * new start made, which is alive for the whole case.
   */
  it('lets a stop and a start in the middle of a restart keep the new daemon\'s record', () => {
    const restarting = process.pid;
    const started = process.ppid;
    const successor = naming(999_999);
    put(naming(started));
    // The restarting daemon's successor does not take the record from the new one.
    expect(claim(successor, restarting)?.pid).toBe(started);
    expect(onDisk()).toBe(started);
    // Forgetting itself, or its successor, leaves the new daemon's record where it is.
    forget([restarting]);
    forget([successor.pid]);
    expect(onDisk()).toBe(started);
  });

  it('writes the successor\'s record over the restarting daemon\'s, or where none is left', () => {
    put(naming(process.pid));
    expect(claim(naming(process.ppid), process.pid)).toBeUndefined();
    expect(onDisk()).toBe(process.ppid);
    forget([process.ppid]);
    expect(onDisk()).toBeUndefined();
    expect(claim(naming(process.ppid), process.pid)).toBeUndefined();
    expect(onDisk()).toBe(process.ppid);
  });

  // A stop delivered as a SIGTERM; on Windows a stop goes over the control pipe, which control.test drives.
  it.skipIf(!posix)('leaves a record a successor claimed while a stop was signalling the daemon it read', async () => {
    const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    const pid = sleeper.pid as number;
    put(naming(pid));
    const kill = process.kill.bind(process);
    const spy = vi.spyOn(process, 'kill').mockImplementation((target, signal) => {
      // The successor writes its record between the stop's read and its forget.
      if (target === pid && signal === 'SIGTERM') put(naming(process.ppid));
      return kill(target, signal);
    });
    try {
      expect((await stop())?.record.pid).toBe(pid);
      expect(onDisk()).toBe(process.ppid);
    }
    finally {
      spy.mockRestore();
      sleeper.kill('SIGKILL');
    }
  });

  /** A pid no process can have: above 2^22, the highest `pid_max` Linux allows. */
  const NEVER = 2 ** 22 + 1;

  /*
   * A child that holds: a process the stop request does not end.
   *
   * It says when its handler is on, because a signal that arrives while node is
   * still starting is one no handler is on for, and would end it like any other.
   */
  const stuck = async (): Promise<{ pid: number; held: ReturnType<typeof spawn> }> => {
    const held = spawn(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('holding\\n'); setInterval(() => {}, 1000)"],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    await new Promise<void>((done) => { held.stdout?.once('data', () => { done(); }); });
    return { pid: held.pid as number, held };
  };

  // A stop delivered as a SIGTERM, which only POSIX has.
  it.skipIf(!posix)('waits for the process to go, and forgets the record after it is gone', async () => {
    const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
    const pid = sleeper.pid as number;
    put(naming(pid));
    /** What the record was, each time the process was looked at. */
    const seen: (number | undefined)[] = [];
    try {
      const answer = await stop({
        signal: (record) => deliver(record, 'SIGTERM'),
        kill: () => { throw new Error('a process that goes is not killed'); },
        alive: (one) => {
          try { process.kill(one, 0); seen.push(onDisk()); return true; }
          catch { seen.push(onDisk()); return false; }
        },
        wait: () => new Promise((done) => { setTimeout(done, 10); }),
        waitMs: 10_000,
        now: () => Date.now(),
        manager: noManager,
      });
      // It went, so no kill: and its record was on disk at every look while it was there.
      expect(answer).toEqual({ record: expect.objectContaining({ pid }), killed: false });
      expect(seen.length).toBeGreaterThan(1);
      expect(seen.slice(0, -1).every((held) => held === pid)).toBe(true);
      expect(onDisk()).toBeUndefined();
    }
    finally { sleeper.kill('SIGKILL'); }
  }, 15000);

  // A child that ignores a SIGTERM, which only POSIX can.
  it.skipIf(!posix)('kills a process that never answered the request, and forgets its record', async () => {
    const { pid, held } = await stuck();
    put(naming(pid));
    try {
      // The real process table and a real SIGKILL, with a limit a case outlasts:
      // the request is a signal this child ignores.
      const answer = await stop({
        signal: (record) => deliver(record, 'SIGTERM'),
        kill: (one) => { process.kill(one, 'SIGKILL'); },
        alive: (one) => {
          try { process.kill(one, 0); return true; }
          catch { return false; }
        },
        wait: () => new Promise((done) => { setTimeout(done, 10); }),
        waitMs: 300,
        now: () => Date.now(),
        manager: noManager,
      });
      expect(answer).toEqual({ record: expect.objectContaining({ pid }), killed: true });
      expect(onDisk()).toBeUndefined();
    }
    finally { held.kill('SIGKILL'); }
  }, 15000);

  it('kills without waiting past the limit, which the clock and not the process ends', async () => {
    // This process, so the record is one `running` reads: the steps below touch
    // no process at all, and the clock is what ends the wait.
    put(naming(process.pid));
    let killed = false;
    const answer = await stop({
      signal: () => Promise.resolve(),
      kill: (one) => { expect(one).toBe(process.pid); killed = true; },
      // The process is there until the kill, and gone after it.
      alive: () => !killed,
      wait: () => { throw new Error('the wait went past the limit'); },
      waitMs: 0,
      now: () => 0,
      manager: noManager,
    });
    expect(answer).toEqual({ record: expect.objectContaining({ pid: process.pid }), killed: true });
    expect(onDisk()).toBeUndefined();
  });

  it('does not wait for a process that went between the read and the request', async () => {
    put(naming(process.pid));
    const answer = await stop({
      signal: () => Promise.reject(Object.assign(new Error('no such process'), { code: 'ESRCH' })),
      kill: () => { throw new Error('nothing is left to kill'); },
      alive: () => false,
      wait: () => { throw new Error('nothing is left to wait for'); },
      waitMs: 10_000,
      now: () => 0,
      manager: noManager,
    });
    expect(answer).toEqual({ record: expect.objectContaining({ pid: process.pid }), killed: false });
    expect(onDisk()).toBeUndefined();
  });

  it('keeps the record of a process still there when its pipe did not answer', async () => {
    put(naming(process.pid));
    await expect(stop({
      signal: () => Promise.reject(Object.assign(new Error('connect ENOENT'), { code: 'ESRCH' })),
      kill: () => { throw new Error('a stop that was never asked kills nothing'); },
      alive: () => true,
      wait: () => { throw new Error('a stop that was never asked waits for nothing'); },
      waitMs: 10_000,
      now: () => 0,
      manager: noManager,
    })).rejects.toThrow('did not answer the stop request');
    expect(onDisk()).toBe(process.pid);
  });

  /*
   * A daemon a service manager holds is the manager's to stop: a signal to it
   * would be a crash the manager answers by starting it again, and a SIGKILL
   * under a unit that restarts on failure is a stop that reads as a restart.
   */
  it('stops a supervised daemon through its manager, and sends it no signal', async () => {
    put(naming(process.pid, 'systemd'));
    /** What the manager was asked, in order. */
    const asked: string[] = [];
    // The manager is what stops it, so the process goes with that call and not
    // with anything this case does.
    let there = true;
    const answer = await stop({
      signal: () => { throw new Error('a supervised daemon is never signalled'); },
      kill: () => { throw new Error('a supervised daemon is never killed'); },
      alive: () => there,
      wait: () => { there = false; return Promise.resolve(); },
      waitMs: 10_000,
      now: () => 0,
      manager: {
        stop: (service) => { asked.push(`stop ${service}`); return Promise.resolve(); },
        restart: () => Promise.reject(new Error('a stop does not restart')),
      },
    });
    expect(asked).toEqual(['stop systemd']);
    expect(answer).toEqual({ record: expect.objectContaining({ pid: process.pid }), killed: false });
    expect(onDisk()).toBeUndefined();
  });

  it('stops a daemon a named service holds by asking for that service', async () => {
    put({ ...naming(process.pid, 'launchd'), serviceName: 'two' });
    const asked: string[] = [];
    let there = true;
    await stop({
      signal: () => { throw new Error('a supervised daemon is never signalled'); },
      kill: () => { throw new Error('a supervised daemon is never killed'); },
      alive: () => there,
      wait: () => { there = false; return Promise.resolve(); },
      waitMs: 10_000,
      now: () => 0,
      manager: {
        stop: (service, name) => { asked.push(`stop ${service} ${String(name)}`); return Promise.resolve(); },
        restart: () => Promise.reject(new Error('a stop does not restart')),
      },
    });
    expect(asked).toEqual(['stop launchd two']);
  });

  it('says what the manager has not done yet, rather than forcing a daemon it holds', async () => {
    put(naming(process.pid, 'launchd'));
    await expect(stop({
      signal: () => { throw new Error('a supervised daemon is never signalled'); },
      kill: () => { throw new Error('a supervised daemon is never killed'); },
      alive: () => true,
      wait: () => Promise.resolve(),
      waitMs: 0,
      now: () => 0,
      manager: { stop: () => Promise.resolve(), restart: () => Promise.reject(new Error('a stop does not restart')) },
    })).rejects.toThrow(`launchd did not stop pid ${String(process.pid)} within 0 seconds.`);
    // It is still running, so its record is still the one thing saying where.
    expect(onDisk()).toBe(process.pid);
  });

  /*
   * A daemon in a container is not this process's to stop: the restart policy
   * starts again what leaves, so the container is what stops it.
   */
  it('refuses to stop a container daemon, and sends it nothing', async () => {
    put(naming(process.pid, 'container'));
    await expect(stop({
      signal: () => { throw new Error('a container daemon is never signalled'); },
      kill: () => { throw new Error('a container daemon is never killed'); },
      alive: () => true,
      wait: () => { throw new Error('a container daemon is never waited for'); },
      waitMs: 10_000,
      now: () => 0,
      manager: noManager,
    })).rejects.toThrow(CONTAINER_STOP);
    // It is still running, so its record is still the one thing saying where.
    expect(onDisk()).toBe(process.pid);
  });

  /*
   * The daemon a service manager starts.
   *
   * `ahpd start` writes the record of the daemon it spawned, because the child
   * cannot: the parent is the one that waits for the announcement. A unit or an
   * agent spawns the daemon itself and knows nothing about records, so a
   * supervised daemon writes its own, with the manager that holds it named.
   */
  const BACKEND = join(import.meta.dirname, 'fixtures', 'plugin-echo');
  const ENV_PLUGIN = join(import.meta.dirname, 'fixtures', 'plugin-env', 'index.ts');

  /** Wait, briefly, for something a process that was just spawned writes. */
  const until = async (ready: () => boolean): Promise<void> => {
    const limit = Date.now() + 20000;
    while (!ready() && Date.now() < limit) await new Promise((wait) => { setTimeout(wait, 50); });
  };

  /**
   * A daemon as a service manager would start it: in the foreground, with the
   * variable such a manager sets, and up until the case kills it - because the
   * record it wrote is its own, and the next reader clears the record of a
   * process that has gone.
   */
  const supervised = (argv: readonly string[] = [], env: Record<string, string> = {}): {
    pid: number;
    said: () => string;
    ended: Promise<number | null>;
    kill: () => void;
  } => {
    const child = spawn(
      process.execPath,
      [MAIN, '--port', '0', '--plugin', BACKEND, '--sessions', 'memory', '--automations', 'memory', '--no-update-check', ...argv],
      {
        cwd: REPO,
        env: {
          ...process.env,
          XDG_CONFIG_HOME: home,
          CI: '1',
          NODE_OPTIONS: '--conditions development --import ./scripts/dev.mjs',
          AHPD_SERVICE: 'systemd',
          ...env,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    child.stdin.end();
    let said = '';
    child.stdout.on('data', (chunk: Buffer) => { said += String(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { said += String(chunk); });
    return {
      pid: child.pid as number,
      said: () => said,
      ended: new Promise((done) => { child.on('exit', (code) => { done(code); }); }),
      kill: () => { child.kill('SIGKILL'); },
    };
  };

  /** One verb as a process, over this case's configuration directory. */
  const verb = (args: readonly string[]): Promise<{ code: number | null; stdout: string; stderr: string }> => {
    const child = spawn(process.execPath, [MAIN, ...args], {
      cwd: REPO,
      env: { ...process.env, XDG_CONFIG_HOME: home, CI: '1', NODE_OPTIONS: '--conditions development --import ./scripts/dev.mjs' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end();
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk); });
    return new Promise((done) => {
      const timer = setTimeout(() => { child.kill(); }, 20000);
      child.on('exit', (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
    });
  };

  it('writes its own record when a service manager starts it, naming that manager', async () => {
    const daemon = supervised();
    try {
      await until(() => running() !== undefined);
      const found = running();
      // Its own pid, not the pid of anything that started it: there is nothing
      // else in the picture, which is the whole difference from `ahpd start`.
      expect(found?.pid).toBe(daemon.pid);
      expect(found?.service).toBe('systemd');
      expect(found?.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/u);
    }
    finally { daemon.kill(); }
  }, 30000);

  it('takes AHPD_SERVICE out of a supervised daemon, so a session\'s shell never has it', async () => {
    const daemon = supervised(['--plugin', ENV_PLUGIN]);
    try {
      await until(() => daemon.said().includes('AHPD_SERVICE '));
      expect(daemon.said()).toContain('AHPD_SERVICE unset');
    }
    finally { daemon.kill(); }
  }, 30000);

  it('stops with a conflict when another daemon already holds the record', async () => {
    const first = supervised();
    try {
      await until(() => running() !== undefined);
      const second = supervised();
      expect(await second.ended).toBe(1);
      expect(second.said()).toContain('Another daemon is already running');
      // The record is the first daemon's, and the one that refused wrote none.
      expect(running()?.pid).toBe(first.pid);
    }
    finally { first.kill(); }
  }, 30000);

  it('names the manager in `status --json`, and never the token', async () => {
    put({
      pid: process.pid,
      url: 'ws://127.0.0.1:9187',
      connectUrl: 'ws://127.0.0.1:9187/?tkn=secret',
      paths: [],
      startedAt: '2026-09-19T00:00:00.000Z',
      service: 'systemd',
    });
    const said = await verb(['status', '--json']);
    expect(said.code).toBe(0);
    expect(JSON.parse(said.stdout)).toEqual({
      pid: process.pid,
      url: 'ws://127.0.0.1:9187',
      paths: [],
      startedAt: '2026-09-19T00:00:00.000Z',
      service: 'systemd',
    });
  }, 30000);

  // Pid 1 answering EPERM, which is POSIX's way of saying another user holds it.
  it.skipIf(!posix)('clears the temp file a writer that is gone left, and keeps a live writer\'s and another user\'s', () => {
    const left = join(home, 'ahpd', `daemon.json.${String(NEVER)}.tmp`);
    const live = join(home, 'ahpd', `daemon.json.${String(process.ppid)}.tmp`);
    // Pid 1 answers `EPERM` to anybody but root, and is there either way.
    const other = join(home, 'ahpd', 'daemon.json.1.tmp');
    for (const file of [left, live, other]) writeFileSync(file, '{');
    expect(claim(naming(process.ppid))).toBeUndefined();
    expect(onDisk()).toBe(process.ppid);
    expect(existsSync(left)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(other)).toBe(true);
    expect(existsSync(join(home, 'ahpd', `daemon.json.${String(process.pid)}.tmp`))).toBe(false);
  });

  it('clears a file that holds no record, and claims over it, rather than throwing', () => {
    for (const text of ['null\n', '42\n', '"x"\n', '{"pid":"7"}\n', 'not json']) {
      writeFileSync(join(home, 'ahpd', 'daemon.json'), text);
      expect(running()).toBeUndefined();
      expect(existsSync(join(home, 'ahpd', 'daemon.json'))).toBe(false);
      writeFileSync(join(home, 'ahpd', 'daemon.json'), text);
      expect(claim(naming(process.ppid))).toBeUndefined();
      expect(onDisk()).toBe(process.ppid);
      forget([process.ppid]);
    }
  });

  /**
   * A child that says where it is and stays up, which is what a daemon does.
   *
   * And goes when it is asked to, over the control pipe where `start` handed it
   * one, as a daemon on Windows does: a signal does not reach it there, and a
   * child nobody can stop outlives the case.
   */
  const announcer = (): string => {
    const child = join(home, 'announce.mjs');
    writeFileSync(child, [
      "import { createServer } from 'node:net';",
      // The pipe first, as a daemon does: `start` returns on the announcement, and a stop may follow at once.
      "const say = () => { process.stdout.write(`ahpd on ws://127.0.0.1:1 (node), sessions in /x\\npid ${process.pid}\\n`); };",
      'const control = process.env.AHPD_CONTROL;',
      "if (control !== undefined) createServer((socket) => { socket.on('data', () => { process.exit(0); }); }).listen(JSON.parse(control).pipe, say);",
      'else say();',
      'setInterval(() => {}, 1000);',
      '',
    ].join('\n'));
    return child;
  };
  const logAt = (name: string): string => join(home, 'ahpd', name);

  it('moves a log over 5 MB aside, and starts a new one holding this start', async () => {
    writeFileSync(logAt('daemon.log'), Buffer.alloc(6 * 1024 * 1024, 'x'));
    const record = await start([], announcer());
    try {
      expect(statSync(logAt('daemon.log.1')).size).toBe(6 * 1024 * 1024);
      // The new log holds this start and no byte of the last one.
      expect(logSince(0)).toBe(`ahpd on ws://127.0.0.1:1 (node), sessions in /x\npid ${String(record.pid)}\n`);
    }
    finally { await stop(); }
  }, 15000);

  it('appends to a log under the limit, and leaves no .1', async () => {
    writeFileSync(logAt('daemon.log'), 'a line from the last daemon\n');
    const record = await start([], announcer());
    try {
      expect(existsSync(logAt('daemon.log.1'))).toBe(false);
      expect(readFileSync(logAt('daemon.log'), 'utf8')).toBe(`a line from the last daemon\nahpd on ws://127.0.0.1:1 (node), sessions in /x\npid ${String(record.pid)}\n`);
    }
    finally { await stop(); }
  }, 15000);

  it('replaces the .1 that a previous rotation left', async () => {
    writeFileSync(logAt('daemon.log'), Buffer.alloc(6 * 1024 * 1024, 'x'));
    writeFileSync(logAt('daemon.log.1'), 'the one before that\n');
    await start([], announcer());
    try {
      expect(statSync(logAt('daemon.log.1')).size).toBe(6 * 1024 * 1024);
    }
    finally { await stop(); }
  }, 15000);

  /*
   * Where the signals reach a daemon, nothing names a pipe: the record has no
   * `control`, and the child is handed no `AHPD_CONTROL` to read. POSIX only,
   * since that is where the signals reach it; the case below is Windows'.
   */
  it.skipIf(!posix)('records no control where the signals reach the daemon, and tells the child nothing', async () => {
    const child = join(home, 'announce-env.mjs');
    writeFileSync(child, "process.stdout.write(`ahpd on ws://127.0.0.1:1 (node), sessions in /x\\npid ${process.pid}\\ncontrol ${process.env.AHPD_CONTROL ?? 'none'}\\n`); setInterval(() => {}, 1000);\n");
    const record = await start([], child);
    try {
      expect(record.control).toBeUndefined();
      expect(readFileSync(logAt('daemon.log'), 'utf8')).toContain('control none');
    }
    finally { await stop(); }
  }, 15000);

  // Windows only: there a signal does not reach the daemon, and the pipe is how a stop does.
  it.skipIf(posix)('records the control on Windows, hands it to the child, and stops the child over it', async () => {
    const child = join(home, 'announce-pipe.mjs');
    writeFileSync(child, [
      "import { createServer } from 'node:net';",
      'const control = JSON.parse(process.env.AHPD_CONTROL);',
      "createServer((socket) => { socket.on('data', () => { process.exit(0); }); }).listen(control.pipe, () => {",
      "  process.stdout.write(`ahpd on ws://127.0.0.1:1 (node), sessions in /x\\npid ${process.pid}\\ncontrol ${control.pipe}\\n`);",
      '});',
      'setInterval(() => {}, 1000);',
      '',
    ].join('\n'));
    const record = await start([], child);
    expect(record.control?.pipe).toMatch(/^\\\\\.\\pipe\\/u);
    expect(readFileSync(logAt('daemon.log'), 'utf8')).toContain(`control ${record.control?.pipe ?? ''}`);
    expect((await stop())?.killed).toBe(false);
  }, 15000);

  it('stops the child it started when its record cannot be written', async () => {
    const child = join(home, 'announce.mjs');
    writeFileSync(child, "process.stdout.write(`ahpd on ws://127.0.0.1:1 (node), sessions in /x\\npid ${process.pid}\\n`); setInterval(() => {}, 1000);\n");
    // The temp this process writes the record to is a directory, so the write throws.
    mkdirSync(join(home, 'ahpd', `daemon.json.${String(process.pid)}.tmp`));
    await expect(start([], child)).rejects.toThrow(/EISDIR/u);
    const announced = /^pid (\d+)$/mu.exec(readFileSync(join(home, 'ahpd', 'daemon.log'), 'utf8'));
    const pid = Number(announced?.[1]);
    expect(pid).toBeGreaterThan(0);
    const until = Date.now() + 5000;
    const there = (): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
    while (there() && Date.now() < until) await new Promise((wait) => { setTimeout(wait, 25); });
    expect(there()).toBe(false);
    expect(existsSync(join(home, 'ahpd', 'daemon.json'))).toBe(false);
  }, 15000);

  it('keeps the origin free of the token the connect URL carries', () => {
    put({ pid: process.pid, url: 'ws://127.0.0.1:9187', connectUrl: 'ws://127.0.0.1:9187/?tkn=secret', paths: [], startedAt: '2026-09-19T00:00:00.000Z' });
    const found = running();
    expect(found?.url).not.toContain('secret');
    expect(found?.connectUrl).toBe('ws://127.0.0.1:9187/?tkn=secret');
  });

  /** The record on disk, as the reader beside this case writes and reads it. */
  const file = (): string => join(home, 'ahpd', 'daemon.json');

  it('rewrites the folders a daemon serves, keeping every other field and the mode', () => {
    put({
      pid: process.pid,
      url: 'ws://127.0.0.1:9187',
      connectUrl: 'ws://127.0.0.1:9187/?tkn=abc',
      paths: ['/a'],
      startedAt: '2026-09-19T00:00:00.000Z',
      automations: 'in /c, schedules fire',
      api: 'http://127.0.0.1:9187',
    });
    rewritePaths(process.pid, ['/a', '/b']);
    // The folders are the change; everything else a daemon recorded about
    // itself is what a later reader needs and is left where it was.
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual({
      pid: process.pid,
      url: 'ws://127.0.0.1:9187',
      connectUrl: 'ws://127.0.0.1:9187/?tkn=abc',
      paths: ['/a', '/b'],
      startedAt: '2026-09-19T00:00:00.000Z',
      automations: 'in /c, schedules fire',
      api: 'http://127.0.0.1:9187',
    });
    // It holds the connect URL, which is the origin with the token in it, so it
    // is owner-only where it is written again: a POSIX mode, which Windows has none of.
    if (posix) expect(statSync(file()).mode & 0o777).toBe(0o600);
  });

  it('leaves the record of another daemon alone', () => {
    put(naming(NEVER));
    const before = readFileSync(file(), 'utf8');
    rewritePaths(process.pid, ['/a', '/b']);
    expect(readFileSync(file(), 'utf8')).toBe(before);
  });
});

/*
 * The daemon's own id.
 *
 * What a machine is labelled with, so a daemon restarting can tell a leftover
 * of its own from one a daemon that has been and gone left behind. It cannot be
 * the process id, which changes every run, and it cannot be a name a person
 * chose, which two daemons on one Docker may share.
 */
describe('hostId', () => {
  let home: string;
  let had: string | undefined;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ahpd-host-id-'));
    had = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = home;
  });
  afterEach(() => {
    if (had === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = had;
    rmSync(home, { recursive: true, force: true });
  });

  it('makes an id on the first start and reads it back after', () => {
    const first = hostId();
    expect(first).not.toBe('');
    expect(readFileSync(join(home, 'ahpd', 'host-id'), 'utf8').trim()).toBe(first);
    // The same value on the next start, which is the whole point: a label
    // written by the run before this one has to match this one.
    expect(hostId()).toBe(first);
  });

  // A POSIX mode, which Windows has none of.
  it.skipIf(!posix)('keeps the file to the person who owns this configuration', () => {
    hostId();
    expect(statSync(join(home, 'ahpd', 'host-id')).mode & 0o777).toBe(0o600);
  });

  it('reads an id a daemon before it wrote, rather than replacing it', () => {
    mkdirSync(join(home, 'ahpd'), { recursive: true });
    const said = randomUUID();
    writeFileSync(join(home, 'ahpd', 'host-id'), `${said}\n`);
    expect(hostId()).toBe(said);
  });

  /*
   * Nothing is ever written over that file. A machine is found by the id of
   * the daemon that made it, so a new id is the same as saying every machine
   * this daemon made belongs to nobody.
   */
  // A file made unreadable by its mode, which Windows does not honour.
  it.skipIf(!posix)('refuses a file it cannot read rather than writing a new id over it', () => {
    mkdirSync(join(home, 'ahpd'), { recursive: true });
    const file = join(home, 'ahpd', 'host-id');
    const said = randomUUID();
    writeFileSync(file, `${said}\n`, { mode: 0o600 });
    chmodSync(file, 0o000);
    try {
      // Read as missing, before, and a new id was written over a daemon that
      // had made machines. That is this daemon orphaning its own.
      expect(() => hostId()).toThrow(file);
    }
    finally {
      // The person running this needs the file back to delete it.
      chmodSync(file, 0o600);
    }
    // Which is the point: the id is the one that was in there.
    expect(hostId()).toBe(said);
  });

  it('refuses a file holding something that is not an id', () => {
    mkdirSync(join(home, 'ahpd'), { recursive: true });
    const file = join(home, 'ahpd', 'host-id');
    writeFileSync(file, 'garbage, with\nnewline\n');
    expect(() => hostId()).toThrow(file);
    // Still the same file, still the same bytes: this daemon did not become a
    // different one because it could not read who it was.
    expect(readFileSync(file, 'utf8')).toBe('garbage, with\nnewline\n');
  });

  it('keeps one id when two daemons start at once', async () => {
    mkdirSync(join(home, 'ahpd'), { recursive: true });
    const file = join(home, 'ahpd', 'host-id');
    const theirs = randomUUID();

    /*
     * The winner of that race is made real here: another daemon's id is written
     * into the file the moment this one is about to create it. Written beside
     * and renamed, this daemon would have put its own over the winner's and
     * gone on running with an id nothing on disk said; created with `wx`, it
     * finds the file taken, reads the winner's id and uses that.
     */
    vi.resetModules();
    vi.doMock('node:fs', async (importOriginal) => {
      const real = await importOriginal<typeof import('node:fs')>();
      return {
        ...real,
        writeFileSync: (at: string, what: unknown, options?: unknown): void => {
          if (at === file) real.writeFileSync(file, `${theirs}\n`);
          (real.writeFileSync as (a: unknown, b: unknown, c?: unknown) => void)(at, what, options);
        },
      };
    });
    try {
      const { hostId: raced } = await import('../src/config.js');
      expect(raced()).toBe(theirs);
      expect(readFileSync(file, 'utf8').trim()).toBe(theirs);
    }
    finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });
});

/*
 * The scratch files a writer that died left behind.
 *
 * Every file this daemon writes whole goes to `<file>.<pid>.tmp` and is renamed
 * over the real one, so a process killed between the write and the rename leaves
 * its half-written scratch beside it - and one of those files is the users file,
 * which holds token hashes. As a process, because what is under test is the
 * daemon's own start and the only thing that can see it from outside is the
 * configuration directory it was given.
 */
describe('the temp files beside what the daemon writes whole', () => {
  let home: string;
  let had: string | undefined;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ahpd-sweep-'));
    had = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = home;
    mkdirSync(join(home, 'ahpd'), { recursive: true });
  });
  afterEach(() => {
    if (had === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = had;
    rmSync(home, { recursive: true, force: true });
  });

  /** A pid no process can have: above 2^22, the highest `pid_max` Linux allows. */
  const NEVER = 2 ** 22 + 1;

  /** One daemon over stdio, let go of at once, and the code it left with. */
  const oneShot = (argv: string[]): Promise<number | null> => {
    // A host with no backend refuses to start, and the backend is not what this
    // case is about: an echo backend is the least that lets a daemon reach its
    // own startup.
    const config = join(home, 'config.json');
    writeFileSync(config, `${JSON.stringify({ plugins: [join(import.meta.dirname, 'fixtures', 'plugin-echo')] })}\n`);
    const child = spawn(process.execPath, [MAIN, '--stdio', '--no-update-check', '--config-file', config, ...argv], {
      cwd: REPO,
      env: { ...process.env, XDG_CONFIG_HOME: home, CI: '1', NODE_OPTIONS: '--conditions development --import ./scripts/dev.mjs' },
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    // A stdio host serves until its client goes away, and this case is what the
    // daemon did before it left rather than the socket it would then hold open.
    child.stdin.end();
    return new Promise((done) => {
      const timer = setTimeout(() => { child.kill(); }, 20000);
      child.on('exit', (code) => { clearTimeout(timer); done(code); });
    });
  };

  it('clears the scratch of a writer that is gone, beside every file the daemon writes whole', async () => {
    const users = join(home, 'users.json');
    const whole = [policiesPath(), automationStatePath(), join(home, 'ahpd', 'computers.json'), vaultPath()];
    const gone = [...whole, users].map((path) => `${path}.${String(NEVER)}.tmp`);
    // A pid alive for the whole case is a writer still in the middle of its own.
    const live = `${policiesPath()}.${String(process.ppid)}.tmp`;
    // Neither a pid, nor one of the files the daemon writes whole.
    const bare = join(home, 'ahpd', 'users.json.tmp');
    const stranger = join(home, 'ahpd', 'notes.json.7.tmp');
    for (const path of [...gone, live, bare, stranger]) writeFileSync(path, '{');
    writeFileSync(users, '{"people":[]}\n');

    expect(await oneShot([`--users=${users}`])).toBe(0);

    for (const path of gone) expect(existsSync(path)).toBe(false);
    for (const path of [live, bare, stranger]) expect(existsSync(path)).toBe(true);
  }, 30000);
});
