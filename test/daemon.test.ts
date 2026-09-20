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
import type { Running } from '../packages/server/src/daemon.js';

const ANNOUNCED = 'ahpd on ws://127.0.0.1:9187 (node), sessions in /a, /b\nautomations in /c, schedules fire\n';

describe('readyUrl', () => {
  it('puts the token in the query', () => {
    expect(readyUrl('ws://127.0.0.1:9187', 'abc')).toBe('ws://127.0.0.1:9187/?tkn=abc');
  });
  it('is the bare origin when no token was given', () => {
    expect(readyUrl('ws://127.0.0.1:9187', undefined)).toBe('ws://127.0.0.1:9187/');
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
