/*
 * One line of the daemon's log: VS Code's time, spdlog's level word, and colour
 * only where the stream and the environment allow it.
 */

import { PassThrough } from 'node:stream';
import { WriteStream } from 'node:tty';
import { afterEach, expect, it, vi } from 'vitest';
import { logLine, timeOf, written } from '../src/logline.js';

/** A stream that is not a terminal, as `daemon.log` is. */
const file = new PassThrough();

/** A stream that says it is a terminal, as `ahpd` run in one writes to. */
const terminal = Object.assign(new PassThrough(), {
  isTTY: true,
  // A real terminal's answers, which read NO_COLOR and FORCE_COLOR.
  hasColors: WriteStream.prototype.hasColors,
  getColorDepth: WriteStream.prototype.getColorDepth,
});

const AT = new Date(2026, 10, 9, 14, 2, 11, 123);
const ESCAPE = '\u001b[';

afterEach(() => { vi.unstubAllEnvs(); });

it('reads the time on the local clock, and on UTC with a Z', () => {
  expect(timeOf(AT, 'local')).toBe('2026-11-09 14:02:11.123');
  expect(timeOf(new Date(Date.UTC(2026, 10, 9, 18, 2, 11, 4)), 'utc')).toBe('2026-11-09 18:02:11.004Z');
});

it('names each level by spdlog\'s word, as VS Code\'s log files do', () => {
  expect(logLine('one', 'trace', 'local', file, AT)).toBe('2026-11-09 14:02:11.123 [trace] one');
  expect(logLine('one', 'debug', 'local', file, AT)).toBe('2026-11-09 14:02:11.123 [debug] one');
  expect(logLine('one', 'info', 'local', file, AT)).toBe('2026-11-09 14:02:11.123 [info] one');
  expect(logLine('one', 'warn', 'local', file, AT)).toBe('2026-11-09 14:02:11.123 [warning] one');
  expect(logLine('one', 'error', 'local', file, AT)).toBe('2026-11-09 14:02:11.123 [error] one');
});

it('writes no escape codes to a stream that is not a terminal', () => {
  vi.stubEnv('FORCE_COLOR', undefined);
  vi.stubEnv('NO_COLOR', undefined);
  expect(logLine('broken', 'error', 'local', file, AT)).not.toContain(ESCAPE);
});

it('colours the level on a terminal, and an error\'s whole line', () => {
  vi.stubEnv('NO_COLOR', undefined);
  vi.stubEnv('FORCE_COLOR', '1');
  const warning = logLine('careful', 'warn', 'local', terminal, AT);
  expect(warning).toContain(`${ESCAPE}33m[warning]`);
  expect(warning.endsWith(' careful')).toBe(true);
  expect(logLine('broken', 'error', 'local', terminal, AT)).toContain(`${ESCAPE}31mbroken`);
  expect(logLine('fine', 'info', 'local', terminal, AT)).toBe('2026-11-09 14:02:11.123 [info] fine');
});

it('writes no colour under NO_COLOR', () => {
  vi.stubEnv('FORCE_COLOR', undefined);
  vi.stubEnv('NO_COLOR', '1');
  expect(logLine('careful', 'warn', 'local', terminal, AT)).not.toContain(ESCAPE);
});

it('writes a line at or above the level asked for, and none under off', () => {
  expect(written('warn', 'info')).toBe(true);
  expect(written('info', 'info')).toBe(true);
  expect(written('debug', 'info')).toBe(false);
  expect(written('error', 'warn')).toBe(true);
  expect(written('error', 'off')).toBe(false);
});
