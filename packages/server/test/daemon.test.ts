/*
 * The daemon record.
 *
 * What a detached daemon writes about itself, and what every reader may print.
 * The origin is token-free and the ready URL carries the secret, so the tests
 * that matter are the ones that hold the two apart: `url` for the verbs, and
 * `connectUrl` for the person copying it out of the 0600 file.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announcementOf, claim, forget, logSince, readyUrl, recordOf, running, start, statusLine, stop } from '../src/daemon.js';
import { isIdentifier, namedIssuer, personalUrl, signInIdentifier } from '../src/config.js';
import type { Running } from '../src/daemon.js';

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

  it('prints the token-free origin through statusLine', () => {
    const record: Running = { pid: 42, url: 'ws://127.0.0.1:9187', connectUrl: 'ws://127.0.0.1:9187/?tkn=secret', paths: [], startedAt: '2026-09-19T00:00:00.000Z' };
    const line = statusLine(record);
    expect(line).toBe('ahpd on ws://127.0.0.1:9187 (pid 42), started 2026-09-19T00:00:00.000Z');
    expect(line).not.toContain('secret');
    expect(line).not.toContain('connectUrl');
  });

  /** A record naming `pid`, alive for as long as that process is. */
  const naming = (pid: number): Running => ({ pid, url: `ws://127.0.0.1:${String(pid % 60000)}`, connectUrl: '', paths: [], startedAt: '' });
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

  it('leaves a record a successor claimed while a stop was signalling the daemon it read', () => {
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
      expect(stop()?.pid).toBe(pid);
      expect(onDisk()).toBe(process.ppid);
    }
    finally {
      spy.mockRestore();
      sleeper.kill('SIGKILL');
    }
  });

  /** A pid no process can have: above 2^22, the highest `pid_max` Linux allows. */
  const NEVER = 2 ** 22 + 1;

  it('clears the temp file a writer that is gone left, and keeps a live writer\'s and another user\'s', () => {
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

  /** A child that says where it is and stays up, which is what a daemon does. */
  const announcer = (): string => {
    const child = join(home, 'announce.mjs');
    writeFileSync(child, "process.stdout.write(`ahpd on ws://127.0.0.1:1 (node), sessions in /x\\npid ${process.pid}\\n`); setInterval(() => {}, 1000);\n");
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
    finally { stop(); }
  }, 15000);

  it('appends to a log under the limit, and leaves no .1', async () => {
    writeFileSync(logAt('daemon.log'), 'a line from the last daemon\n');
    const record = await start([], announcer());
    try {
      expect(existsSync(logAt('daemon.log.1'))).toBe(false);
      expect(readFileSync(logAt('daemon.log'), 'utf8')).toBe(`a line from the last daemon\nahpd on ws://127.0.0.1:1 (node), sessions in /x\npid ${String(record.pid)}\n`);
    }
    finally { stop(); }
  }, 15000);

  it('replaces the .1 that a previous rotation left', async () => {
    writeFileSync(logAt('daemon.log'), Buffer.alloc(6 * 1024 * 1024, 'x'));
    writeFileSync(logAt('daemon.log.1'), 'the one before that\n');
    await start([], announcer());
    try {
      expect(statSync(logAt('daemon.log.1')).size).toBe(6 * 1024 * 1024);
    }
    finally { stop(); }
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
});
