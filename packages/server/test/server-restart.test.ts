/*
 * `ahpd restart`, served and at the terminal.
 *
 * Nothing here spawns or signals a process: the served command is called with a
 * Request against a daemon's facts written by hand, the terminal's signal and
 * the daemon's log are fakes, and the restart itself is driven with a fake
 * close, start and exit, so no case can stop the process running the suite or
 * leave a daemon behind. The one host built here is in this process, over a
 * backend that answers without a CLI.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileUsers } from '@ahpd/sdk';
import { createHost } from '../../sdk/src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import { conflict, type Options } from '../src/commands/options.js';
import {
  FORCED_SIGNAL, RESTARTING, RESTART_SIGNAL, answerRestartSignal, checkedRestart, lifecycle, restartAtTerminal, restartInPlace,
} from '../src/commands/restart.js';
import type { InPlace, LifecycleSteps } from '../src/commands/restart.js';
import { apiOrigins } from '../src/commands/run.js';
import { servedRegistry, type ServedFacts } from '../src/commands/served.js';
import type { Running } from '../src/daemon.js';
import { apiHandler } from '../src/http.js';

const AUTHORITY = '127.0.0.1:9350';
const ARGV = ['--port', '9350', '--path', '/x', '--http'];

let home: string;
let had: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-restart-'));
  had = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  mkdirSync(join(home, 'ahpd'), { recursive: true });
});
afterEach(() => {
  if (had === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = had;
  rmSync(home, { recursive: true, force: true });
});

/** The record `ahpd start` would have written for this process; `null` is an older daemon's, with no line. */
const started = (over: Partial<Running> = {}, argv: string[] | null = ARGV): void => {
  const record: Running = {
    pid: process.pid, url: `ws://${AUTHORITY}`, connectUrl: `ws://${AUTHORITY}/`,
    paths: ['/x'], startedAt: '2026-09-30T00:00:00.000Z', ...(argv === null ? {} : { argv }), ...over,
  };
  writeFileSync(join(home, 'ahpd', 'daemon.json'), JSON.stringify(record));
};

/** A daemon's API, with the sessions it says are turning and the restarts it was asked for. */
const served = async (turning: string[] = [], refuse?: string): Promise<{
  post: (body: unknown, token?: string) => Promise<Response>;
  restarts: string[][];
  person: string;
}> => {
  const usersFile = join(home, 'users.json');
  writeFileSync(usersFile, JSON.stringify({ roles: {}, users: [] }));
  const users = fileUsers({ path: usersFile });
  await users.add('ada', ['admin']);
  const person = await users.mint('ada');
  const restarts: string[][] = [];
  const facts: ServedFacts = {
    options: {} as Options,
    configFile: join(home, 'config.json'),
    users,
    running: () => ({ pid: process.pid, url: `ws://${AUTHORITY}`, host: '127.0.0.1', port: 9350, paths: ['/x'], startedAt: '' }),
    turning: () => turning,
    restart: (argv) => {
      if (refuse !== undefined) conflict(refuse);
      restarts.push(argv);
    },
  };
  const handler = apiHandler({
    registry: servedRegistry(facts),
    token: 'root-secret',
    users,
    program: { name: 'ahpd', version: '0.0.0' },
    origins: () => apiOrigins('127.0.0.1', undefined, 9350),
  });
  const post = (body: unknown, token = 'root-secret'): Promise<Response> => handler(new Request(`http://${AUTHORITY}/api/restart`, {
    method: 'POST',
    headers: { host: AUTHORITY, 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }));
  return { post, restarts, person };
};

describe('POST /api/restart', () => {
  it('refuses a daemon running in the foreground, and says where to restart it', async () => {
    const api = await served();
    const answered = await api.post({});
    expect(answered.status).toBe(409);
    expect((await answered.json() as { message: string }).message).toContain('runs in the foreground');
    expect(api.restarts).toEqual([]);
  });

  it('refuses when the record names another process, and says which', async () => {
    // The parent, because a record naming a process that is gone is cleared as stale.
    started({ pid: process.ppid });
    const api = await served();
    const refused = await api.post({});
    expect(refused.status).toBe(409);
    expect((await refused.json() as { message: string }).message)
      .toBe(`The record names pid ${String(process.ppid)}, not this daemon; restart this one where it runs.`);
    expect(api.restarts).toEqual([]);
  });

  it('refuses a second restart while the first runs', async () => {
    started();
    const api = await served([], 'A restart is already under way.');
    const refused = await api.post({});
    expect(refused.status).toBe(409);
    expect((await refused.json() as { message: string }).message).toBe('A restart is already under way.');
  });

  it('answers a started daemon, then restarts it with the line it was started with', async () => {
    started();
    const api = await served();
    const answered = await api.post({});
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ restarting: true, pid: process.pid });
    expect(api.restarts).toEqual([ARGV]);
  });

  it('refuses while a turn runs, naming the sessions, and restarts with force', async () => {
    started();
    const api = await served(['ahp-session:/a', 'ahp-session:/b']);
    const refused = await api.post({});
    expect(refused.status).toBe(409);
    const message = (await refused.json() as { message: string }).message;
    expect(message).toContain('ahp-session:/a, ahp-session:/b');
    expect(message).toContain('--force');
    expect(api.restarts).toEqual([]);

    const forced = await api.post({ force: true });
    expect(forced.status).toBe(200);
    expect(api.restarts).toEqual([ARGV]);
  });

  it('refuses a record an older daemon wrote, which has no line to start again', async () => {
    started({}, null);
    const api = await served();
    const refused = await api.post({});
    expect(refused.status).toBe(409);
    expect((await refused.json() as { message: string }).message).toContain('ahpd stop');
    expect(api.restarts).toEqual([]);
  });

  it('is the deployment token\'s alone', async () => {
    started();
    const api = await served();
    const refused = await api.post({}, api.person);
    expect(refused.status).toBe(403);
    expect((await refused.json() as { message: string }).message)
      .toBe('ada may not restart the daemon here; only the deployment token may');
    expect(api.restarts).toEqual([]);
  });
});

describe('restartInPlace', () => {
  const record = (pid: number): Running => ({
    pid, url: 'ws://127.0.0.1:9351', connectUrl: 'ws://127.0.0.1:9351/', paths: ['/x'], startedAt: '', argv: ARGV,
  });

  /** The steps, each saying itself; `stopAt` is where a stop arrives, if one does. */
  const stepsFor = (said: string[], over: Partial<InPlace> & { stopAt?: 'close' | 'start' } = {}): InPlace => {
    let stopped = false;
    return {
      close: async () => { said.push('close'); if (over.stopAt === 'close') stopped = true; },
      stopped: () => stopped,
      start: async (argv) => { said.push(`start ${argv.join(' ')}`); if (over.stopAt === 'start') stopped = true; return record(7); },
      stop: (successor) => { said.push(`stop ${String(successor.pid)}`); },
      forget: () => { said.push('forget'); },
      log: (line) => { said.push(line); },
      exit: (code) => { said.push(`exit ${String(code)}`); },
      ...over,
    };
  };

  it('closes, starts with the line in its place, and exits, leaving the record to the successor', async () => {
    const said: string[] = [];
    await restartInPlace(ARGV, stepsFor(said));
    expect(said).toEqual([
      'close', 'restart: starting the successor', `start ${ARGV.join(' ')}`,
      'restarted as ws://127.0.0.1:9351 (pid 7)', 'exit 0',
    ]);
  });

  it('says why a new daemon did not start, forgets itself, and exits with 1', async () => {
    const said: string[] = [];
    await restartInPlace(ARGV, stepsFor(said, { start: async () => { throw new Error('it exited with 1'); } }));
    expect(said).toEqual(['close', 'restart: starting the successor', 'Could not restart it: it exited with 1', 'forget', 'exit 1']);
  });

  it('logs and exits with 1 when its way down fails, rather than staying up with nothing listening', async () => {
    const said: string[] = [];
    await restartInPlace(ARGV, stepsFor(said, { close: () => Promise.reject(new Error('the listener would not close')) }));
    expect(said).toEqual(['Could not restart it: the listener would not close', 'exit 1']);
  });

  it('logs and exits with 1 when forgetting its record throws, and nothing escapes', async () => {
    const said: string[] = [];
    await restartInPlace(ARGV, stepsFor(said, { stopAt: 'close', forget: () => { throw new Error('EACCES: permission denied, unlink daemon.json'); } }));
    expect(said).toEqual(['close', 'Could not restart it: EACCES: permission denied, unlink daemon.json', 'exit 1']);
    const failed: string[] = [];
    await restartInPlace(ARGV, stepsFor(failed, {
      start: async () => { throw new Error('it exited with 1'); },
      forget: () => { throw new Error('EACCES: permission denied, unlink daemon.json'); },
    }));
    expect(failed).toEqual([
      'close', 'restart: starting the successor', 'Could not restart it: it exited with 1',
      'Could not restart it: EACCES: permission denied, unlink daemon.json', 'exit 1',
    ]);
    const stopping: string[] = [];
    await restartInPlace(ARGV, stepsFor(stopping, { stopAt: 'start', stop: () => { throw new Error('EACCES: permission denied, unlink daemon.json'); } }));
    expect(stopping.slice(-2)).toEqual(['Could not restart it: EACCES: permission denied, unlink daemon.json', 'exit 1']);
  });

  it('gives way to a stop that arrived while it closed, and starts nothing', async () => {
    const said: string[] = [];
    await restartInPlace(ARGV, stepsFor(said, { stopAt: 'close' }));
    expect(said).toEqual(['close', 'forget', 'Could not restart it: it was stopped first, so none was started.', 'exit 0']);
  });

  it('stops the successor when a stop arrived while it started', async () => {
    const said: string[] = [];
    await restartInPlace(ARGV, stepsFor(said, { stopAt: 'start' }));
    expect(said).toEqual([
      'close', 'restart: starting the successor', `start ${ARGV.join(' ')}`, 'stop 7',
      'Could not restart it: it was stopped while pid 7 started, so that one was stopped too.', 'exit 0',
    ]);
  });
});

describe('lifecycle', () => {
  /** A daemon whose way down waits on `release`, so a second call lands while the first runs. */
  const daemon = () => {
    const said: string[] = [];
    let release = (): void => {};
    const steps: LifecycleSteps = {
      down: () => { said.push('down'); return new Promise<void>((done) => { release = done; }); },
      start: async (argv, token) => { said.push(`start ${argv.join(' ')}${token === undefined ? '' : ` token ${token}`}`); return { pid: 7, url: 'ws://127.0.0.1:9351', connectUrl: '', paths: [], startedAt: '' }; },
      stop: (successor) => { said.push(`stop ${String(successor.pid)}`); },
      forget: () => { said.push('forget'); },
      log: (line) => { said.push(line); },
      exit: (code) => { said.push(`exit ${String(code)}`); },
      later: (step) => { step(); },
    };
    return { said, way: lifecycle(steps), release: () => { release(); } };
  };
  const settle = (): Promise<void> => new Promise((done) => { setTimeout(done, 0); });

  it('logs and exits with 1 when a stop\'s way down fails', async () => {
    const said: string[] = [];
    const way = lifecycle({
      down: () => Promise.reject(new Error('the listener would not close')),
      start: async () => ({ pid: 7, url: '', connectUrl: '', paths: [], startedAt: '' }),
      stop: () => {},
      forget: () => {},
      log: (line) => { said.push(line); },
      exit: (code) => { said.push(`exit ${String(code)}`); },
      later: (step) => { step(); },
    });
    way.shutdown();
    await settle();
    expect(said).toEqual(['Could not stop cleanly: the listener would not close', 'exit 1']);
  });

  it('starts the successor with the token it was handed', async () => {
    const { said, way, release } = daemon();
    way.restart(ARGV, 'xyz');
    release();
    await settle();
    expect(said).toContain(`start ${ARGV.join(' ')} token xyz`);
  });

  it('refuses a second restart while the first runs, and starts one successor', async () => {
    const { said, way, release } = daemon();
    way.restart(ARGV);
    expect(() => { way.restart(ARGV); }).toThrow('A restart is already under way.');
    release();
    await settle();
    expect(said.filter((one) => one.startsWith('start'))).toHaveLength(1);
    expect(said.at(-1)).toBe('exit 0');
  });

  it('refuses a restart once a stop has begun', async () => {
    const { said, way, release } = daemon();
    way.shutdown();
    expect(() => { way.restart(ARGV); }).toThrow('It is stopping.');
    release();
    await settle();
    expect(said).toEqual(['down', 'exit 0']);
  });

  it('goes down once for two stops', async () => {
    const { said, way, release } = daemon();
    way.shutdown();
    way.shutdown();
    release();
    await settle();
    expect(said).toEqual(['down', 'exit 0']);
  });

  it('lets a stop during a restart win: no successor is started', async () => {
    const { said, way, release } = daemon();
    way.restart(ARGV);
    way.shutdown();
    release();
    await settle();
    expect(said).toEqual(['down', 'forget', 'Could not restart it: it was stopped first, so none was started.', 'exit 0']);
  });
});

/** A record naming `pid`, with or without the line it was started with. */
const recordFor = (pid: number, argv: string[] | null = ARGV): Running => ({
  pid, url: `ws://127.0.0.1:${String(9000 + pid)}`, connectUrl: `ws://127.0.0.1:${String(9000 + pid)}/`,
  paths: ['/x'], startedAt: '', ...(argv === null ? {} : { argv }),
});

describe('the daemon, told to restart by a signal', () => {
  const answer = async (forced: boolean, over: { recorded?: Running | undefined; turning?: string[] } = {}) => {
    const said: string[] = [];
    const restarts: string[][] = [];
    await answerRestartSignal(forced, {
      self: 7,
      recorded: () => ('recorded' in over ? over.recorded : recordFor(7)),
      turning: () => over.turning ?? [],
      log: (line) => { said.push(line); },
      restart: (argv) => { restarts.push(argv); },
    });
    return { said, restarts };
  };

  it('restarts with its recorded line when no turn runs, and writes its receipt', async () => {
    expect(await answer(false)).toEqual({ said: ['restart: stopping (SIGHUP)'], restarts: [ARGV] });
  });

  it('writes one refusal naming the sessions and the signal while a turn runs, and keeps running', async () => {
    const { said, restarts } = await answer(false, { turning: ['ahp-session:/a', 'ahp-session:/b'] });
    expect(restarts).toEqual([]);
    expect(said).toEqual(['restart refused (SIGHUP): A turn is running in ahp-session:/a, ahp-session:/b; pass --force to restart anyway.']);
  });

  it('restarts anyway when forced, and names that signal in its receipt', async () => {
    expect(await answer(true, { turning: ['ahp-session:/a'] })).toEqual({ said: ['restart: stopping (SIGUSR2)'], restarts: [ARGV] });
  });

  it('refuses when the record is not its own, or holds no line', async () => {
    const another = await answer(true, { recorded: recordFor(8) });
    expect(another.restarts).toEqual([]);
    expect(another.said).toEqual(['restart refused (SIGUSR2): The record names pid 8, not this daemon; restart this one where it runs.']);
    expect((await answer(true, { recorded: undefined })).said)
      .toEqual(['restart refused (SIGUSR2): This daemon runs in the foreground, not from ahpd start; restart it where it runs.']);
    const older = await answer(true, { recorded: recordFor(7, null) });
    expect(older.restarts).toEqual([]);
    expect(older.said[0]).toContain('ahpd stop');
  });

  it('writes a refusal, rather than throwing, when a restart is already under way', async () => {
    const said: string[] = [];
    await answerRestartSignal(false, {
      self: 7,
      recorded: () => recordFor(7),
      turning: () => [],
      log: (line) => { said.push(line); },
      restart: () => { throw new Error('A restart is already under way.'); },
    });
    expect(said).toEqual(['restart refused (SIGHUP): A restart is already under way.']);
  });

  it('writes a refusal, and no receipt, when its line cannot run now', async () => {
    const said: string[] = [];
    const restarts: [string[], string | undefined][] = [];
    await answerRestartSignal(false, {
      self: 7,
      recorded: () => recordFor(7),
      turning: () => [],
      log: (line) => { said.push(line); },
      restart: checkedRestart(async () => { throw new Error('config.json is not JSON'); }, () => [], { restart: (argv, token) => { restarts.push([argv, token]); } }, () => {}),
    });
    expect(restarts).toEqual([]);
    expect(said).toEqual(['restart refused (SIGHUP): Its line cannot run now, so it was not stopped: config.json is not JSON']);
  });
});

describe('checkedRestart', () => {
  it('reads the line before the lifecycle is asked, and hands it the token read', async () => {
    const asked: [string[], string | undefined][] = [];
    const read: string[][] = [];
    const held: (string | undefined)[] = [];
    const restart = checkedRestart(async (argv) => { read.push(argv); expect(asked).toEqual([]); return 'xyz'; }, () => [], {
      restart: (argv, token) => { asked.push([argv, token]); },
    }, (why) => { held.push(why); });
    await restart(ARGV, false);
    expect(read).toEqual([ARGV]);
    expect(asked).toEqual([[ARGV, 'xyz']]);
    // Held before the line was read, and left held: this restart is going.
    expect(held).toEqual([RESTARTING]);
  });

  it('refuses with why, and never asks the lifecycle, when the line or its token cannot be read', async () => {
    const asked: string[][] = [];
    const held: (string | undefined)[] = [];
    const restart = checkedRestart(async () => { throw new Error('connectionTokenFile /nope cannot be read'); }, () => [], {
      restart: (argv) => { asked.push(argv); },
    }, (why) => { held.push(why); });
    await expect(restart(ARGV, false)).rejects.toThrow('Its line cannot run now, so it was not stopped: connectionTokenFile /nope cannot be read');
    expect(asked).toEqual([]);
    // Taken, then let go: this daemon runs on and takes turns again.
    expect(held).toEqual([RESTARTING, undefined]);
  });
});

describe('a turn that starts while the line is read', () => {
  it('refuses the signal that was not forced, and the forced one restarts', async () => {
    const said: string[] = [];
    let turning: string[] = [];
    let reading = (): void => {};
    const way = lifecycle({
      down: async () => { said.push('down'); },
      start: async () => ({ pid: 8, url: 'ws://127.0.0.1:9008', connectUrl: '', paths: [], startedAt: '' }),
      stop: () => {},
      forget: () => {},
      log: (line) => { said.push(line); },
      exit: (code) => { said.push(`exit ${String(code)}`); },
      later: (step) => { setTimeout(step, 0); },
    });
    const facts = {
      self: 7,
      recorded: () => recordFor(7),
      turning: () => turning,
      log: (line: string) => { said.push(line); },
      // The read waits for the test, and a turn begins meanwhile.
      restart: checkedRestart(() => new Promise<string | undefined>((done) => { reading = () => { done(undefined); }; }), () => turning, way, () => {}),
    };
    const first = answerRestartSignal(false, facts);
    await new Promise((wait) => { setTimeout(wait, 0); });
    turning = ['ahp-session:/a'];
    reading();
    await first;
    expect(said).toEqual(['restart refused (SIGHUP): A turn is running in ahp-session:/a; pass --force to restart anyway.']);

    const second = answerRestartSignal(true, facts);
    await new Promise((wait) => { setTimeout(wait, 0); });
    reading();
    await second;
    await new Promise((wait) => { setTimeout(wait, 0); });
    expect(said.slice(1)).toEqual([
      'restart: stopping (SIGUSR2)', 'down', 'restart: starting the successor', 'restarted as ws://127.0.0.1:9008 (pid 8)', 'exit 0',
    ]);
  });
});

describe('restartAtTerminal', () => {
  interface Daemon { record: Running | undefined; log: string; alive: boolean; waits: number; signals: string[] }
  /**
   * A daemon that is only a record and a log: `then` is what it does when it
   * is signalled, and `each` what it does at each of the terminal's waits,
   * which are a second each on the clock.
   */
  const faked = (
    record: Running | undefined,
    then: (signal: string, state: Daemon) => void = () => {},
    each: (state: Daemon) => void = () => {},
    alive?: (state: Daemon) => boolean,
  ) => {
    const state: Daemon = { record, log: 'earlier lines\n', signals: [], alive: true, waits: 0 };
    const clock = { at: 0 };
    const steps = {
      running: () => state.record,
      signal: (pid: number, signal: string) => { state.signals.push(`${String(pid)} ${signal}`); then(signal, state); },
      alive: () => (alive === undefined ? state.alive : alive(state)),
      mark: () => state.log.length,
      read: (from: number) => state.log.slice(from),
      wait: async () => { state.waits += 1; clock.at += 1000; each(state); },
      receiptMs: 3000,
      timeoutMs: 5000,
      now: () => clock.at,
    };
    return { state, steps };
  };
  /** The daemon taking the signal and finishing at once, as the one at `pid`. */
  const restarted = (pid: number) => (signal: string, state: Daemon): void => {
    state.record = recordFor(pid);
    state.log += `2026-09-30T00:00:00.000Z restart: stopping (${signal})\nrestart: starting the successor\nrestarted as ws://127.0.0.1:${String(9000 + pid)} (pid ${String(pid)})\n`;
  };

  it('says none is running, and where a foreground one is restarted', async () => {
    const { steps } = faked(undefined);
    await expect(restartAtTerminal(false, steps)).rejects.toThrow('None running in the background');
  });

  it('refuses a record an older daemon wrote, and sends nothing', async () => {
    const { state, steps } = faked(recordFor(7, null));
    await expect(restartAtTerminal(false, steps)).rejects.toThrow('ahpd stop');
    expect(state.signals).toEqual([]);
  });

  it('says in words that the recorded pid is gone, or why the signal was not sent', async () => {
    const failing = (code: string) => ({
      ...faked(recordFor(7)).steps,
      signal: () => { throw Object.assign(new Error(`kill ${code}`), { code }); },
    });
    await expect(restartAtTerminal(false, failing('ESRCH'))).rejects.toThrow('pid 7, which the record names, is gone; nothing was restarted.');
    await expect(restartAtTerminal(false, failing('EINVAL'))).rejects.toThrow('Could not signal pid 7: kill EINVAL');
  });

  it('sends the restart signal, and answers the new daemon\'s record', async () => {
    const { state, steps } = faked(recordFor(7), restarted(8));
    const begun = await restartAtTerminal(false, steps);
    expect(state.signals).toEqual([`7 ${RESTART_SIGNAL}`]);
    expect(begun.pid).toBe(8);
    expect(begun.url).toBe('ws://127.0.0.1:9008');
  });

  it('sends the forced signal with --force', async () => {
    const { state, steps } = faked(recordFor(7), restarted(8));
    await restartAtTerminal(true, steps);
    expect(state.signals).toEqual([`7 ${FORCED_SIGNAL}`]);
  });

  it('answers the daemon\'s refusal, which names the sessions', async () => {
    const { steps } = faked(recordFor(7), (_signal, state) => {
      state.log += '2026-09-30T00:00:00.000Z restart refused (SIGHUP): A turn is running in ahp-session:/a; pass --force to restart anyway.\n';
    });
    await expect(restartAtTerminal(false, steps)).rejects.toThrow('A turn is running in ahp-session:/a; pass --force to restart anyway.');
  });

  it('answers a new daemon that did not start', async () => {
    const { steps } = faked(recordFor(7), (signal, state) => {
      state.log += `restart: stopping (${signal})\nrestart: starting the successor\nCould not restart it: it exited with 1. See daemon.log\n`;
    });
    await expect(restartAtTerminal(false, steps)).rejects.toThrow('Could not restart it: it exited with 1');
  });

  it('waits for as long as the old daemon is stopping, then answers the successor', async () => {
    const { state, steps } = faked(recordFor(7), (signal, daemon) => { daemon.log += `restart: stopping (${signal})\n`; }, (daemon) => {
      // A minute of stopping handlers, far past the successor's own wait.
      if (daemon.waits === 60) daemon.log += 'restart: starting the successor\n';
      if (daemon.waits === 63) {
        daemon.record = recordFor(8);
        daemon.log += 'restarted as ws://127.0.0.1:9008 (pid 8)\n';
      }
    });
    expect((await restartAtTerminal(false, steps)).pid).toBe(8);
    expect(state.waits).toBe(63);
  });

  it('gives the successor its wait from the starting line, then answers the log\'s last lines', async () => {
    const { state, steps } = faked(recordFor(7), (signal, daemon) => { daemon.log += `restart: stopping (${signal})\n`; }, (daemon) => {
      if (daemon.waits === 30) daemon.log += 'restart: starting the successor\nplugin echo loading\n';
    });
    await expect(restartAtTerminal(false, steps)).rejects.toThrow(/never said it had restarted[\s\S]*plugin echo loading/u);
    expect(state.waits).toBe(36);
  });

  it('gives up when the daemon does not answer the signal, bounded rather than for ever', async () => {
    const { state, steps } = faked(recordFor(7), (_signal, daemon) => { daemon.log += 'something else\n'; });
    await expect(restartAtTerminal(false, steps)).rejects.toThrow(/did not answer the signal within 3 seconds, and may still take it; run ahpd status[\s\S]*something else/u);
    expect(state.waits).toBe(4);
  });

  it('answers a refusal that comes after a while', async () => {
    const { steps } = faked(recordFor(7), () => {}, (daemon) => {
      if (daemon.waits === 2) daemon.log += 'restart refused (SIGHUP): A restart is already under way.\n';
    });
    await expect(restartAtTerminal(false, steps)).rejects.toThrow('A restart is already under way.');
  });

  it('does not take another terminal\'s refusal, of the other kind or after its own receipt, as its answer', async () => {
    const { steps } = faked(recordFor(7), (signal, daemon) => {
      daemon.log += 'restart refused (SIGUSR2): A restart is already under way.\n';
      daemon.log += `restart: stopping (${signal})\n`;
      daemon.log += 'restart refused (SIGHUP): A restart is already under way.\n';
    }, (daemon) => {
      if (daemon.waits === 2) {
        daemon.record = recordFor(8);
        daemon.log += 'restart: starting the successor\nrestarted as ws://127.0.0.1:9008 (pid 8)\n';
      }
    });
    expect((await restartAtTerminal(false, steps)).pid).toBe(8);
  });

  it('stops waiting when the old daemon went without an answer', async () => {
    const { state, steps } = faked(recordFor(7), (_signal, daemon) => { daemon.alive = false; daemon.log += 'Killed\n'; });
    await expect(restartAtTerminal(false, steps)).rejects.toThrow(/never said it had restarted[\s\S]*Killed/u);
    expect(state.waits).toBe(0);
  });

  it('says the successor is not running when it went right after the daemon named it', async () => {
    const { steps } = faked(recordFor(7), (signal, daemon) => {
      daemon.log += `restart: stopping (${signal})\nrestart: starting the successor\nrestarted as ws://127.0.0.1:9008 (pid 8)\n`;
      daemon.alive = false;
    });
    await expect(restartAtTerminal(false, steps)).rejects.toThrow(/It restarted as pid 8, which is not running now\.[\s\S]*restarted as/u);
  });

  it('reads the log again when the daemon went, and takes an answer written just before', async () => {
    // The answer lands between the terminal's read and its check of the pid.
    const { steps } = faked(recordFor(7), (signal, daemon) => { daemon.log += `restart: stopping (${signal})\n`; }, () => {}, (daemon) => {
      daemon.record = recordFor(8);
      daemon.log += 'restart: starting the successor\nrestarted as ws://127.0.0.1:9008 (pid 8)\n';
      return false;
    });
    expect((await restartAtTerminal(false, steps)).pid).toBe(8);
  });
});

describe('a turn and a restart that is stopping the daemon', () => {
  /** A client that keeps what the host sent it. */
  const peer = (): Peer & { notes: { method: string; params: unknown }[] } => {
    const notes: { method: string; params: unknown }[] = [];
    return {
      notes,
      send: () => {},
      notify: (method, params) => notes.push({ method, params }),
      request: async () => ({}),
      answered: () => {},
      close: () => {},
    };
  };

  const settle = async (times = 8): Promise<void> => {
    for (let i = 0; i < times; i++) await new Promise((wake) => { setTimeout(wake, 0); });
  };

  /*
   * A daemon's host, in this process.
   *
   * The backend is the echo example, which answers without a CLI, so a turn
   * costs a few ticks rather than a process - and `pace` is how long one is held
   * open, which is how a case has a turn running when it needs one.
   */
  const live = async (pace = 0) => {
    const where = join(home, 'work');
    const host = createHost({ path: where, agents: [echo({ path: where, pace })] });
    const said = peer();
    const client = host.accept(said);
    await client.handle({
      method: 'initialize',
      params: { clientId: 'restarting', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
    });
    const uri = 'ahp-session:/restarting';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
    const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    };
    const chat = opened.snapshot.state.defaultChat;
    await client.handle({ method: 'subscribe', params: { channel: chat } });
    return { host, client, said, uri, chat };
  };

  type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

  /** What the host last said about an action on a chat: the action, or the refusal of it. */
  const answeredOn = (said: { notes: { method: string; params: unknown }[] }, chat: string) => said.notes
    .filter((note) => note.method === 'action')
    .map((note) => note.params as { channel: string; action: { type: string }; rejectionReason?: string })
    .filter((one) => one.channel === chat)
    .at(-1);

  /** A client saying something on a chat now. */
  const say = async (client: Client, chat: string, text: string, turnId: string): Promise<void> => {
    await client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/turnStarted', turnId, message: { text } } },
    });
    await settle();
  };

  it('refuses a turn started while it stops, rather than having the close end one', async () => {
    const { host, client, said, chat } = await live();
    const log: string[] = [];
    let release = (): void => {};
    const held = new Promise<void>((done) => { release = done; });
    let finished = (): void => {};
    const over = new Promise<void>((done) => { finished = done; });

    const way = lifecycle({
      /*
       * A plugin's `stopping` handler holds the way down open, and the host
       * closes after it - the same order the daemon's own down goes in.
       */
      down: async () => { await held; await host.close(); },
      start: async () => recordFor(8),
      stop: () => {},
      forget: () => {},
      log: (line) => { log.push(line); },
      exit: (code) => { log.push(`exit ${String(code)}`); finished(); },
      later: (step) => { step(); },
    });
    const restart = checkedRestart(
      async () => 'xyz',
      () => host.turning(),
      way,
      (why) => { host.refuseTurns(why); },
    );
    await restart(ARGV, false);

    // On its way down, with the host still answering: the window a turn can
    // start in, and be ended by the close at the end of this restart.
    await say(client, chat, 'hello', 't1');
    expect(answeredOn(said, chat)?.rejectionReason).toBe('The daemon is restarting');

    release();
    await over;
    expect(log).toContain('exit 0');
  });

  it('takes turns again when a running one refuses the restart', async () => {
    const { host, client, said, chat } = await live(50);
    await say(client, chat, 'busy', 't1');
    // As the host spells it, which is the name a refusal names it by.
    const running = host.turning();
    expect(running).toHaveLength(1);

    const asked: string[][] = [];
    const restart = checkedRestart(
      async () => 'xyz',
      () => host.turning(),
      { restart: (argv) => { asked.push(argv); } },
      (why) => { host.refuseTurns(why); },
    );
    await expect(restart(ARGV, false)).rejects.toThrow(`A turn is running in ${String(running[0])}; pass --force to restart anyway.`);
    expect(asked).toEqual([]);

    // The daemon ran on, so the next thing somebody says is theirs again.
    await say(client, chat, 'still here', 't2');
    expect(answeredOn(said, chat)?.rejectionReason).toBeUndefined();
    await host.close();
  });

  it('takes turns again when its line cannot run, or a restart is already under way', async () => {
    const { host, client, said, chat } = await live();
    const asked: string[][] = [];
    const holding = (why: string | undefined): void => { host.refuseTurns(why); };

    const unrunnable = checkedRestart(
      async () => { throw new Error('config.json is not JSON'); },
      () => host.turning(),
      { restart: (argv) => { asked.push(argv); } },
      holding,
    );
    await expect(unrunnable(ARGV, false)).rejects.toThrow('Its line cannot run now, so it was not stopped: config.json is not JSON');
    await say(client, chat, 'hello', 't1');
    expect(answeredOn(said, chat)?.rejectionReason).toBeUndefined();

    const underWay = checkedRestart(
      async () => 'xyz',
      () => host.turning(),
      { restart: () => { conflict('A restart is already under way.'); } },
      holding,
    );
    await expect(underWay(ARGV, false)).rejects.toThrow('A restart is already under way.');
    await say(client, chat, 'and again', 't2');
    expect(answeredOn(said, chat)?.rejectionReason).toBeUndefined();
    expect(asked).toEqual([]);
    await host.close();
  });
});
