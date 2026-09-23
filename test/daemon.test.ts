/*
 * The daemon record.
 *
 * What a detached daemon writes about itself, and what every reader may print.
 * The origin is token-free and the ready URL carries the secret, so the tests
 * that matter are the ones that hold the two apart: `url` for the verbs, and
 * `connectUrl` for the person copying it out of the 0600 file.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readyUrl, recordOf, running, statusLine } from '../packages/server/src/daemon.js';
import { isIdentifier, personalUrl, signInIdentifier } from '../packages/server/src/config.js';
import type { Running } from '../packages/server/src/daemon.js';

const ANNOUNCED = 'ahpd on ws://127.0.0.1:9187 (node), sessions in /a, /b\nautomations in /c, schedules fire\n';

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

  it('prints the token-free origin through statusLine', () => {
    const line = statusLine({ pid: 42, url: 'ws://127.0.0.1:9187', connectUrl: 'ws://127.0.0.1:9187/?tkn=secret', paths: [], startedAt: '2026-09-19T00:00:00.000Z' });
    expect(line).toBe('ahpd on ws://127.0.0.1:9187 (pid 42), started 2026-09-19T00:00:00.000Z');
    expect(line).not.toContain('secret');
    expect(line).not.toContain('connectUrl');
  });

  it('keeps the origin free of the token the connect URL carries', () => {
    put({ pid: process.pid, url: 'ws://127.0.0.1:9187', connectUrl: 'ws://127.0.0.1:9187/?tkn=secret', paths: [], startedAt: '2026-09-19T00:00:00.000Z' });
    const found = running();
    expect(found?.url).not.toContain('secret');
    expect(found?.connectUrl).toBe('ws://127.0.0.1:9187/?tkn=secret');
  });
});
