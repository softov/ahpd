/*
 * A log line's level, from the call to where the line goes.
 *
 * The host's log is called as a function at info and by a method at any other
 * level, as VS Code's log service is. The level reaches the embedder's writer,
 * a plugin's `log` event and the OTLP record, whose severity decides which
 * `ahp-otlp://logs/{level}` subscriptions it reaches.
 */

import { expect, it } from 'vitest';
import { createTelemetry } from '../src/host/telemetry.js';
import { LOG_SEVERITY, levelIn, loggerOf } from '../src/log.js';
import type { HostContext } from '../src/host/context.js';
import type { LogEvent } from '../src/types/events.js';
import type { LogLevel } from '../src/log.js';

/** A host's log over a stub of what it reads: its options and one connection watching `channels`. */
const telemetry = (channels: string[]) => {
  const written: [string, LogLevel | undefined][] = [];
  const events: LogEvent[] = [];
  const sent: { channel: string; severity: number }[] = [];
  const connection = {
    activeSubscriptions: new Set(channels),
    peer: {
      notify: (_method: string, params: { channel: string; payload: { resourceLogs: { scopeLogs: { logRecords: { severityNumber: number }[] }[] }[] } }) => {
        sent.push({ channel: params.channel, severity: params.payload.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!.severityNumber });
      },
    },
  };
  const ctx = {
    options: {
      onEvent: (line: string, level?: LogLevel) => { written.push([line, level]); },
      events: { log: [{ by: 'test', handle: (event: LogEvent) => { events.push({ ...event }); }, context: {} }] },
    },
    connections: new Set([connection]),
  } as unknown as HostContext;
  return { log: createTelemetry(ctx).log, written, events, sent };
};

it('writes a plain call at info and a method call at its own level', () => {
  const { log, written } = telemetry([]);
  log('plain');
  log.warn('careful');
  log.error('broken');
  log.debug('detail');
  expect(written).toEqual([['plain', 'info'], ['careful', 'warn'], ['broken', 'error'], ['detail', 'debug']]);
});

it('hands a plugin the line with its level', async () => {
  const { log, events } = telemetry([]);
  log.warn('careful');
  await new Promise((done) => { setImmediate(done); });
  expect(events).toEqual([{ type: 'log', line: 'careful', level: 'warn' }]);
});

it('sends a record to the subscriptions whose band holds its severity, at VS Code\'s severity number', () => {
  const { log, sent } = telemetry(['ahp-otlp://logs/warn', 'ahp-otlp://logs/info', 'ahp-otlp://logs/error']);
  log('started');
  log.warn('careful');
  expect(sent).toEqual([
    { channel: 'ahp-otlp://logs/info', severity: LOG_SEVERITY.info },
    { channel: 'ahp-otlp://logs/warn', severity: LOG_SEVERITY.warn },
    { channel: 'ahp-otlp://logs/info', severity: LOG_SEVERITY.warn },
  ]);
});

it('sends every record to the logs channel that names no level', () => {
  const { log, sent } = telemetry(['ahp-otlp://logs']);
  log.trace('step');
  log.error('broken');
  expect(sent.map((one) => one.severity)).toEqual([LOG_SEVERITY.trace, LOG_SEVERITY.error]);
});

it('makes a logger of a plain writer, and keeps a logger as it is', () => {
  const lines: string[] = [];
  const plain = loggerOf((line: string) => { lines.push(line); });
  plain.warn('a');
  plain('b');
  expect(lines).toEqual(['a', 'b']);
  expect(loggerOf(plain)).toBe(plain);
});

/*
 * The level another program's line says it is: what an ACP server writes on its
 * stderr, read so the line keeps its level in this host's log.
 */
it('reads a Rust line\'s level, and drops the time the server put on it', () => {
  expect(levelIn('2026-11-09T16:18:54.636915Z  WARN chisel_agent::fd_binary: fd: managed install does not run; discarding it'))
    .toEqual({ level: 'warn', text: 'chisel_agent::fd_binary: fd: managed install does not run; discarding it' });
  expect(levelIn('2026-11-09T16:18:54.601709Z  INFO toolbox::tools::mcp: Connecting to MCP server \'tasker\'')?.level).toBe('info');
});

it('reads a level in brackets, a leading level word, logfmt and JSON', () => {
  expect(levelIn('[ERROR] the socket closed')).toEqual({ level: 'error', text: 'the socket closed' });
  expect(levelIn('2026-11-09 14:02:11.123 [warning] refused a request')).toEqual({ level: 'warn', text: 'refused a request' });
  expect(levelIn('WARNING:root:no config')?.level).toBe('warn');
  expect(levelIn('Error: Authentication required')).toEqual({ level: 'error', text: 'Authentication required' });
  expect(levelIn('time=2026-11-09T16:18:54Z level=debug msg="tick"')?.level).toBe('debug');
  expect(levelIn('{"level":40,"msg":"slow"}')?.level).toBe('warn');
  expect(levelIn('{"level":"error","msg":"down"}')?.level).toBe('error');
});

it('says nothing about a line that names no level', () => {
  expect(levelIn('Ripgrep is not available. Falling back to GrepTool.')).toBeUndefined();
  expect(levelIn('Skipping project agents due to untrusted folder.')).toBeUndefined();
  expect(levelIn('info about the folder')).toBeUndefined();
  expect(levelIn('MCP server tasker is ready')).toBeUndefined();
});
