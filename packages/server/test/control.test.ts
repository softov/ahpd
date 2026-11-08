/*
 * The pipe a daemon on Windows takes a stop and a restart on.
 *
 * The request path is `node:net` on both platforms, and the pipe name is a
 * parameter, so every case here drives it over a unix socket path where there
 * is one, and over the named pipe a start would make on Windows, which cannot
 * listen on a path in a folder.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { controlFor, deliver, requestLine } from '../src/daemon.js';
import type { Control, ControlledSignal, Running } from '../src/daemon.js';
import { controlIn, controlServer } from '../src/control.js';
import type { ControlHandlers } from '../src/control.js';
import { answerRestartSignal, restartAtTerminal } from '../src/commands/restart.js';
import type { RestartOutcome } from '../src/commands/restart.js';

let home: string;
let socket: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-control-'));
  socket = join(home, 'control.sock');
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

/** A control this machine can listen on: a unix socket path, or on Windows a pipe of the kind a start makes. */
const here = (): Control => controlFor('win32', process.platform === 'win32' ? undefined : socket) as Control;

/** One line to the control, and the daemon closing the connection after it. */
const send = (control: Control, line: string): Promise<void> => new Promise((done, fail) => {
  const client = connect(control.pipe);
  client.on('connect', () => { client.end(line); });
  client.on('close', () => { done(); });
  client.on('error', (error: Error) => { fail(error); });
});

/** The request line for that key and signal. */
const request = (key: string, signal: string): string => `${JSON.stringify({ key, signal })}\n`;

/** A record naming pid 7, with the control a start would have recorded. */
const recordOf = (control?: Control): Running => ({
  pid: 7, url: 'ws://127.0.0.1:9007', connectUrl: '', paths: [], startedAt: '', argv: ['--port', '0'],
  ...(control === undefined ? {} : { control }),
});

/** A key of the same length as `own` and certainly another one. */
const wrongKey = (own: string): string => `${own.startsWith('a') ? 'b' : 'a'}${own.slice(1)}`;

/** Handlers that run nothing, for a case about what does not happen. */
const quiet = (): ControlHandlers => ({ SIGTERM: vi.fn(), SIGHUP: vi.fn(), SIGUSR2: vi.fn() });

describe('controlIn', () => {
  it('reads the pipe and key a start handed the child', () => {
    const control: Control = { pipe: '\\\\.\\pipe\\ahpd-1', key: 'ab' };
    expect(controlIn(JSON.stringify(control))).toEqual(control);
  });

  it('answers nothing for a value that is not a control, so the daemon still serves', () => {
    for (const said of ['', 'not json', 'null', '42', '"x"', '{}', '{"pipe":""}', '{"key":"ab"}', '{"pipe":"/tmp/x","key":""}']) {
      expect(controlIn(said)).toBeUndefined();
    }
    expect(controlIn(undefined)).toBeUndefined();
  });
});

describe('the control server', () => {
  it('runs the handler a SIGTERM with the right key names, once', async () => {
    const control = here();
    const handlers = quiet();
    const server = controlServer(control, handlers, () => {});
    await server.listening;
    try {
      await send(control, request(control.key, 'SIGTERM'));
      expect(handlers.SIGTERM).toHaveBeenCalledTimes(1);
      expect(handlers.SIGHUP).not.toHaveBeenCalled();
      expect(handlers.SIGUSR2).not.toHaveBeenCalled();
    }
    finally { await server.close(); }
  });

  it('runs nothing for a wrong key, and the log line holds no key', async () => {
    const control = here();
    const handlers = quiet();
    const said: string[] = [];
    const server = controlServer(control, handlers, (line) => { said.push(line); });
    await server.listening;
    try {
      // One of the same length, which is the compare, and one of another, which
      // is not: `timingSafeEqual` throws on two buffers of different lengths.
      await send(control, request(wrongKey(control.key), 'SIGTERM'));
      await send(control, request('short', 'SIGTERM'));
      expect(handlers.SIGTERM).not.toHaveBeenCalled();
      expect(said).toEqual([
        'control: refused a request with a wrong key',
        'control: refused a request with a wrong key',
      ]);
      expect(JSON.stringify(said)).not.toContain(control.key);
    }
    finally { await server.close(); }
  });

  it('runs nothing for a signal this daemon does not take, and names it in one line', async () => {
    const control = here();
    const handlers = quiet();
    const said: string[] = [];
    const server = controlServer(control, handlers, (line) => { said.push(line); });
    await server.listening;
    try {
      await send(control, request(control.key, 'SIGKILL'));
      // A name with a newline in it is still one line of the log: the log is
      // read line by line, and a line a request wrote is a line it made up.
      await send(control, request(control.key, 'SIGTERM\nrestart: stopping (SIGHUP)'));
      expect(handlers.SIGTERM).not.toHaveBeenCalled();
      expect(handlers.SIGHUP).not.toHaveBeenCalled();
      expect(handlers.SIGUSR2).not.toHaveBeenCalled();
      expect(said).toEqual([
        'control: refused a request naming SIGKILL',
        'control: refused a request naming SIGTERM restart: stopping (SIGHUP)',
      ]);
    }
    finally { await server.close(); }
  });

  it('runs nothing for a line that is not a request', async () => {
    const control = here();
    const handlers = quiet();
    const said: string[] = [];
    const server = controlServer(control, handlers, (line) => { said.push(line); });
    await server.listening;
    try {
      for (const line of ['not json\n', 'null\n', '{"signal":"SIGTERM"}\n', '{"key":"ab"}\n', '{"key":42,"signal":"SIGTERM"}\n']) {
        await send(control, line);
      }
      expect(handlers.SIGTERM).not.toHaveBeenCalled();
      expect(said).toEqual(Array.from({ length: 5 }, () => 'control: refused a request that is not a JSON line with a key and a signal'));
    }
    finally { await server.close(); }
  });

  it('answers a SIGTERM with the handler whatever else the server was given', async () => {
    const control = here();
    const shutdown = vi.fn();
    const server = controlServer(control, { SIGTERM: shutdown, SIGHUP: vi.fn(), SIGUSR2: vi.fn() }, () => {});
    await server.listening;
    try {
      await send(control, request(control.key, 'SIGTERM'));
      await send(control, request(control.key, 'SIGTERM'));
      expect(shutdown).toHaveBeenCalledTimes(2);
    }
    finally { await server.close(); }
  });
});

describe('deliver', () => {
  it('sends the request over the pipe on win32, and the handler runs', async () => {
    const control = here();
    const shutdown = vi.fn();
    /** Told once the daemon has run the handler, which is after `deliver` is done. */
    let handled: () => void = () => {};
    const ran = new Promise<void>((done) => { handled = done; });
    const server = controlServer(control, { SIGTERM: () => { shutdown(); handled(); }, SIGHUP: vi.fn(), SIGUSR2: vi.fn() }, () => {});
    await server.listening;
    try {
      await deliver(recordOf(control), 'SIGTERM', 'win32');
      await ran;
      expect(shutdown).toHaveBeenCalledTimes(1);
    }
    finally { await server.close(); }
  });

  it('writes the one line the daemon reads, key and signal together', () => {
    // The same line the cases above send by hand: there is no second format,
    // and the key is the one the record holds.
    const control = here();
    expect(requestLine(control, 'SIGHUP')).toBe(request(control.key, 'SIGHUP'));
    expect(requestLine(control, 'SIGUSR2')).toBe(`${JSON.stringify({ key: control.key, signal: 'SIGUSR2' })}\n`);
  });

  it('sends the signal on a platform whose signals reach the daemon, control or not', async () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      await deliver(recordOf({ pipe: '/tmp/ahpd-none.sock', key: 'ab' }), 'SIGTERM', 'linux');
      expect(kill).toHaveBeenCalledWith(7, 'SIGTERM');
    }
    finally { kill.mockRestore(); }
  });

  it('answers ESRCH, which is the words for a daemon that is gone, when the pipe is not there', async () => {
    // Nothing is listening on this path: on Windows, nothing holds that pipe.
    await expect(deliver(recordOf(here()), 'SIGTERM', 'win32')).rejects.toMatchObject({ code: 'ESRCH' });
  });

  it('refuses, in words, a record on win32 that an older ahpd wrote', async () => {
    await expect(deliver(recordOf(), 'SIGTERM', 'win32')).rejects.toThrow('This daemon was started by an older ahpd, which recorded no pipe. Stop pid 7 by hand.');
  });

  it('gives the terminal the words for a gone daemon when its pipe is not there', async () => {
    const record = recordOf(here());
    const steps = {
      running: () => record,
      signal: (one: Running, signal: ControlledSignal) => deliver(one, signal, 'win32'),
      alive: () => true,
      mark: () => 0,
      read: () => '',
      wait: async () => {},
      receiptMs: 1000,
      timeoutMs: 1000,
      now: () => 0,
      piped: true,
      // The record names no service, so no manager is asked on this path.
      manager: {
        stop: () => Promise.reject(new Error('no service manager holds this record')),
        restart: () => Promise.reject(new Error('no service manager holds this record')),
      },
    };
    await expect(restartAtTerminal(false, steps)).rejects
      .toThrow('pid 7, which the record names, is gone; nothing was restarted.');
  });
});

describe('a restart reached over the control', () => {
  /**
   * The daemon's own facts, faked as `server-restart.test.ts` fakes them: the
   * restart parks while a turn runs unless forced, as `checkedRestart` does.
   */
  const facts = (turning: string[], said: string[], restarted: string[][]) => ({
    self: 7,
    recorded: () => recordOf(),
    log: (line: string) => { said.push(line); },
    restart: (argv: string[], force: boolean): RestartOutcome => {
      if (turning.length > 0 && !force) return { parked: turning };
      restarted.push(argv);
      return { restartDelayMs: 3000 };
    },
  });

  /** The three handlers `run.ts` binds the control to, over those facts, each said to come through the pipe. */
  const handlersFor = (said: string[], restarted: string[][], turning: string[], shutdown: () => void): ControlHandlers => ({
    SIGTERM: shutdown,
    SIGHUP: () => { void answerRestartSignal(false, facts(turning, said, restarted), true); },
    SIGUSR2: () => { void answerRestartSignal(true, facts(turning, said, restarted), true); },
  });

  it('logs a SIGHUP request parked while a turn runs, naming the pipe, and a SIGUSR2 request restarts', async () => {
    const control = here();
    const said: string[] = [];
    const restarted: string[][] = [];
    const server = controlServer(control, handlersFor(said, restarted, ['ahp-session:/a'], vi.fn()), (line) => { said.push(line); });
    await server.listening;
    try {
      await send(control, request(control.key, 'SIGHUP'));
      expect(said).toEqual(['restart parked (control pipe): A turn is running in ahp-session:/a; it restarts once the turns end, or at once with --force.']);
      expect(restarted).toEqual([]);

      // The same turn, forced: the restart runs, and its receipt names the pipe and the force.
      await send(control, request(control.key, 'SIGUSR2'));
      expect(restarted).toEqual([['--port', '0']]);
      expect(said).toContain('restart: stopping (control pipe, forced)');
    }
    finally { await server.close(); }
  });

  it('restarts with a SIGHUP once no turn runs', async () => {
    const control = here();
    const said: string[] = [];
    const restarted: string[][] = [];
    const server = controlServer(control, handlersFor(said, restarted, [], vi.fn()), (line) => { said.push(line); });
    await server.listening;
    try {
      await send(control, request(control.key, 'SIGHUP'));
      expect(restarted).toEqual([['--port', '0']]);
      expect(said).toEqual(['restart: stopping (control pipe)']);
    }
    finally { await server.close(); }
  });

  it('shuts down on a SIGTERM with the right key', async () => {
    const control = here();
    const shutdown = vi.fn();
    const said: string[] = [];
    const server = controlServer(control, handlersFor(said, [], [], shutdown), (line) => { said.push(line); });
    await server.listening;
    try {
      await send(control, request(control.key, 'SIGTERM'));
      expect(shutdown).toHaveBeenCalledTimes(1);
      expect(said).toEqual([]);
    }
    finally { await server.close(); }
  });
});
