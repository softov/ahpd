/*
 * What `ahpd` does at the command line, pinned before it is declared.
 *
 * Every flag and every verb, as a process: `main.ts` runs the daemon on import
 * and the exit code is half of what a script reads. Nothing here names a
 * function inside `main.ts`, only what a person can see, so the same cases hold
 * when the hand-written parser is replaced by the declarations under
 * `packages/server/src/commands/` - which is the whole point of pinning them
 * first.
 *
 * The configuration directory is a temporary one, so a case can write the file
 * the verb under test reads without touching the machine it runs on.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { version } from '../src/version.js';

const REPO = join(import.meta.dirname, '../../..');
const MAIN = 'packages/server/src/main.ts';
/** A plugin that contributes a backend, which is what lets a run get to its announcement. */
const BACKEND = './packages/server/test/fixtures/plugin-echo';
/** A directory holding an `npm` that says one line and leaves the code `FAKE_NPM_EXIT` names. */
const FAKE_NPM = join(import.meta.dirname, 'fixtures', 'npm-fake');
const fakeNpm = (code: number): Record<string, string> => ({
  PATH: `${FAKE_NPM}:${process.env['PATH'] ?? ''}`,
  FAKE_NPM_EXIT: String(code),
});

interface Said {
  code: number | null;
  stdout: string;
  stderr: string;
}

let home: string;
let config: string;
let users: string;
let wire: string;
/** Pids a `start` case left behind, killed when the case ends. */
const spawned: number[] = [];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-cli-'));
  mkdirSync(join(home, 'ahpd'), { recursive: true });
  config = join(home, 'config.json');
  users = join(home, 'users.json');
  wire = join(home, 'wire.jsonl');
  writeFileSync(config, '{}\n');
});
afterEach(() => {
  for (const pid of [...spawned.splice(0), ...announced()]) {
    try { process.kill(pid, 'SIGKILL'); }
    catch { /* it was already gone, which is what was wanted */ }
  }
  rmSync(home, { recursive: true, force: true });
});

/**
 * The pids the case's daemon log names in a `(pid N)` announcement.
 *
 * The log is the detached daemon's output, so a pid named there is one a
 * `start` inside that daemon spawned, which `daemon.json` may not record.
 */
const announced = (): number[] => {
  let log = '';
  try { log = readFileSync(join(home, 'ahpd', 'daemon.log'), 'utf8'); }
  catch { return []; }
  return [...log.matchAll(/\(pid (\d+)\)/gu)]
    .map((match) => Number(match[1]))
    .filter((pid) => pid !== process.pid);
};

/** Whether the OS still holds that process. */
const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
};

/** Wait, briefly, for a stopped daemon to leave. */
const gone = async (pid: number): Promise<void> => {
  const until = Date.now() + 5000;
  while (alive(pid) && Date.now() < until) await new Promise((wait) => setTimeout(wait, 50));
};

const put = (value: unknown): void => {
  writeFileSync(config, typeof value === 'string' ? value : JSON.stringify(value));
};

/**
 * The environment the daemon runs in.
 *
 * The loader is on the environment rather than on argv because `start` runs
 * this program again for the daemon, and a child inherits the environment
 * rather than this process's argv.
 */
const daemonEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_CONFIG_HOME: home,
    CI: '1',
    NODE_OPTIONS: '--conditions development --import ./scripts/dev.mjs',
  };
  delete env.NO_UPDATE_NOTIFIER;
  return Object.assign(env, extra);
};

/** The daemon as a process: argv in, what it said and the code it left, out. */
const cli = (args: string[], options: { config?: unknown; env?: Record<string, string> } = {}): Promise<Said> => {
  if (options.config !== undefined) put(options.config);
  const child = spawn(
    process.execPath,
    [MAIN, ...args],
    { cwd: REPO, env: daemonEnv(options.env ?? {}), stdio: ['pipe', 'pipe', 'pipe'] },
  );
  // The peer's end of the pipe, closed at once: a stdio host serves until the
  // client goes away, and a case that starts one has nothing to say to it.
  child.stdin.end();
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk); });
  return new Promise((done) => {
    // A run that does start and somehow sat on the pipe fails on the cases
    // below rather than on the suite's own timeout.
    const timer = setTimeout(() => { child.kill(); }, 15000);
    child.on('exit', (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
  });
};

/**
 * A foreground daemon, as the origin it announced.
 *
 * Killed as soon as it says where it is: the case is the announcement, and a
 * socket left open past it is a port the next case cannot have.
 */
const foreground = (args: string[]): Promise<string> => new Promise((resolve, reject) => {
  const child = spawn(
    process.execPath,
    [MAIN, ...args],
    { cwd: REPO, env: daemonEnv(), stdio: ['pipe', 'pipe', 'pipe'] },
  );
  child.stdin.end();
  let stdout = '';
  let stderr = '';
  let bound: string | undefined;
  let done = false;
  const finish = (error?: Error): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (error !== undefined) reject(error);
    else if (bound !== undefined) resolve(bound);
    else reject(new Error(`the daemon never announced itself:\n${stdout}\n${stderr}`));
  };
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    finish(new Error(`the daemon never announced itself:\n${stdout}\n${stderr}`));
  }, 25000);
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += String(chunk);
    bound ??= /ahpd on (ws:\/\/[^\s,]+)/u.exec(stdout)?.[1];
    if (bound !== undefined) child.kill('SIGTERM');
  });
  child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk); });
  child.once('exit', () => { finish(); });
});

/** Whether a socket opens, or the message it was turned away with. */
const knock = (url: string): Promise<string> => new Promise((resolve) => {
  const socket = new WebSocket(url);
  socket.on('open', () => { socket.close(); resolve('open'); });
  socket.on('error', (error: Error) => { resolve(error.message); });
});

const recordOf = (): { pid: number; url: string; connectUrl?: string } =>
  JSON.parse(readFileSync(join(home, 'ahpd', 'daemon.json'), 'utf8')) as { pid: number; url: string };

describe('what a person types first', () => {
  it('answers --help and -h with the usage and a zero', async () => {
    for (const flag of ['--help', '-h']) {
      const said = await cli([flag]);
      expect(said.code).toBe(0);
      expect(said.stdout).toContain('ahpd');
      expect(said.stdout).toContain('--port');
      expect(said.stdout).toContain('container');
      expect(said.stdout).toContain('trust decision');
      expect(said.stdout).toContain('without the dashes');
      expect(said.stdout).toContain('?tkn=');
      expect(said.stdout).toContain('Authorization: Bearer');
      expect(said.stdout).not.toContain('ahpd run');
      expect(said.stdout.match(/Global options:/gu)).toHaveLength(1);
    }
  });

  it('prints the manifest version for --version and -v', async () => {
    for (const flag of ['--version', '-v']) {
      const said = await cli([flag]);
      expect(said.code).toBe(0);
      expect(said.stdout.trim()).toBe(version());
    }
  });

  it('refuses an option it does not know, with two', async () => {
    const said = await cli(['--nope']);
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('Unknown option --nope');
  });

  it('refuses a word that is not a command, with two', async () => {
    const said = await cli(['frobnicate']);
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('frobnicate');
  });
});

describe('completion and values', () => {
  it('completes the foreground run flags', async () => {
    const said = await cli(['__complete', '--', '--po']);
    expect(said.code).toBe(0);
    expect(said.stdout).toContain('--port');
  });

  it('offers --plugin and never --plugins', async () => {
    const said = await cli(['__complete', '--', 'start', '--plu']);
    expect(said.code).toBe(0);
    expect(said.stdout).toContain('--plugin');
    expect(said.stdout).not.toContain('--plugins');
  });

  it('a value spelled -v is a value', async () => {
    const said = await cli(['--stdio', '--connection-token', '-v', '--plugin', BACKEND, '--config-file', config, '--no-update-check']);
    expect(said.code).toBe(0);
    expect(said.stderr).toContain('token: from --connection-token');
  }, 20000);
});

/*
 * One run carries almost every flag the daemon takes, because the interesting
 * fact about each is that it is read at all and the announcement is the one
 * place they are visible at once. What is left out is what contradicts another
 * flag, which the cases below take one at a time.
 */
describe('the flags of a run', () => {
  it('takes every daemon flag and announces what each decided', async () => {
    const said = await cli([
      '--stdio', '--config-file', config,
      '--port', '0', '--host', '127.0.0.1', '--path', home,
      '--connection-token', 'secret1234',
      '--resource', 'https://ahpd.test/',
      '--issuer', 'github',
      '--trust-token', '--advanced-tools',
      '--automations', 'memory', '--sessions', 'memory',
      '--wire', wire,
      '--plugin', BACKEND,
      '--no-update-check',
    ]);
    expect(said.code).toBe(0);
    expect(said.stderr).toContain('ahpd over stdio');
    expect(said.stderr).toContain(`sessions in ${home}`);
    expect(said.stderr).toContain('automations in memory, schedules do not fire');
    expect(said.stderr).toContain('plugins echo-plugin');
    expect(said.stderr).toContain('token: from --connection-token');
    expect(said.stderr).toContain('advanced tools: offered to every session');
    expect(said.stderr).toContain(`wire to ${wire}`);
    // The capture is opened as the run starts, so a `--wire` that was read is
    // a file that is there.
    expect(readFileSync(wire, 'utf8')).toBe('');
  }, 20000);

  it('writes nothing to stdout over --stdio but the frames', async () => {
    const said = await cli(['--stdio', '--plugin', BACKEND, '--config-file', config, '--no-update-check']);
    expect(said.code).toBe(0);
    expect(said.stdout).toBe('');
  }, 20000);

  it('takes --without-connection-token, and says so instead of a secret', async () => {
    const said = await cli(['--stdio', '--without-connection-token', '--plugin', BACKEND, '--config-file', config, '--no-update-check']);
    expect(said.code).toBe(0);
    expect(said.stderr).toContain('no token: any connection is accepted');
  }, 20000);

  it('reads --connection-token-file and says where the secret came from', async () => {
    const at = join(home, 'token');
    writeFileSync(at, 'held-in-a-file\n');
    const said = await cli(['--stdio', '--connection-token-file', at, '--plugin', BACKEND, '--config-file', config, '--no-update-check']);
    expect(said.code).toBe(0);
    expect(said.stderr).toContain(`token: read from ${at}`);
  }, 20000);

  it('refuses --no-plugins beside a --plugin', async () => {
    const said = await cli(['--stdio', '--no-plugins', '--plugin', BACKEND, '--config-file', config]);
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('--no-plugins contradicts');
  });

  it('refuses --plugins, which is not another spelling of --no-plugins', async () => {
    const said = await cli(['--plugins', '--stdio', '--config-file', config]);
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('Unknown option --plugins');
  });

  it('refuses an --automations it does not have', async () => {
    const said = await cli(['--stdio', '--automations', 'potato', '--config-file', config]);
    expect(said.code).toBe(2);
  });

  it('refuses a --sessions it does not have', async () => {
    const said = await cli(['--stdio', '--sessions', 'potato', '--config-file', config]);
    expect(said.code).toBe(2);
  });

  it('refuses an --issuer that is neither github nor a URL it may reach', async () => {
    const said = await cli(['--stdio', '--issuer', 'not-an-issuer', '--config-file', config]);
    expect(said.code).toBe(2);
  });

  it('refuses a bind address that exposes it with no token', async () => {
    const said = await cli(['--stdio', '--host', '0.0.0.0', '--config-file', config]);
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('exposes this host');
  });

  it('refuses a --resource that is not the identifier the record wants', async () => {
    writeFileSync(users, '{ "users": [] }\n');
    const said = await cli(['--stdio', '--users', users, '--resource', 'http://ahpd.test/', '--plugin', BACKEND, '--config-file', config]);
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('--resource must be an https URL');
  }, 20000);

  it('refuses an http.host that names no address', async () => {
    const said = await cli(['--config-file', config, '--connection-token', 't'], { config: { http: { port: 0, host: '' } } });
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('http.host must name an address, not ""');
  }, 20000);

  it('refuses an http.host with space around the address', async () => {
    const said = await cli(['--config-file', config, '--connection-token', 't'], { config: { http: { port: 0, host: ' 127.0.0.1 ' } } });
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('http.host must name an address, not " 127.0.0.1 "');
  }, 20000);
});

describe('reaching a daemon elsewhere', () => {
  /*
   * The address is one this machine keeps to itself but is not one of the three
   * names `ON_MACHINE` knows, so the scheme is what the warning turns on and a
   * refused connection ends the case at once rather than after a timeout.
   */
  it('refuses a blank token as no token, before anything is fetched', async () => {
    const blankFile = join(home, 'blank-token');
    writeFileSync(blankFile, '  \n');
    for (const [args, env] of [
      [['--token='], {}],
      [['--token', '  '], {}],
      [['--token-file', blankFile], {}],
      [[], { AHPD_TOKEN: '  ' }],
    ] as [string[], Record<string, string>][]) {
      const said = await cli(['--remote', 'http://127.0.0.1:9', ...args, 'status'], { env });
      expect(said.code).toBe(2);
      expect(said.stderr).toBe('ahpd: http://127.0.0.1:9 needs a token: pass --token, --token-file or AHPD_TOKEN.\n');
    }
  }, 40000);

  it('warns about a cleartext token for a scheme in either case', async () => {
    const said = await cli(['--remote', 'HTTP://127.0.0.2:9', '--token', 'abc12345', 'status']);
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('the token travels in cleartext');
  }, 20000);
});

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

  it('takes --no-update-check from the configuration as well as the flag', async () => {
    writeFileSync(join(home, 'ahpd', 'daemon.json'), JSON.stringify({
      pid: process.pid, url: 'ws://127.0.0.1:9187', paths: [], startedAt: '2026-09-18T12:00:00.000Z',
    }));
    writeFileSync(join(home, 'ahpd', 'update.json'), JSON.stringify({ name: '@ahpd/server', latest: '9.9.9', checkedAt: '2026-09-18T12:00:00Z' }));
    const without = await cli(['status', '--no-update-check']);
    expect(without.stdout.split('\n')).toHaveLength(2);
    writeFileSync(join(home, 'ahpd', 'config.json'), '{ "updateCheck": false }\n');
    const fromFile = await cli(['status']);
    expect(fromFile.stdout.split('\n')).toHaveLength(2);
  });
});

describe('a daemon that binds a port', () => {
  it('binds the port and host a person passed', async () => {
    const url = await foreground(['--port', '0', '--host', 'localhost', '--plugin', BACKEND, '--no-update-check']);
    expect(url.startsWith('ws://localhost:')).toBe(true);
    expect(url).not.toBe('ws://localhost:9187');
  }, 30000);

  it('binds the port and host the configuration names', async () => {
    writeFileSync(join(home, 'ahpd', 'config.json'), JSON.stringify({ port: 0, host: 'localhost', plugins: [BACKEND] }));
    const url = await foreground([]);
    expect(url.startsWith('ws://localhost:')).toBe(true);
    expect(url).not.toBe('ws://localhost:9187');
  }, 30000);

  it('starts, reports and stops the daemon the record names', async () => {
    const began = await cli(['start', '--port', '0', '--plugin', BACKEND, '--automations', 'memory', '--sessions', 'memory', '--no-update-check']);
    expect(began.code).toBe(0);
    expect(began.stdout).toContain('ahpd on ws://127.0.0.1:');
    const record = JSON.parse(readFileSync(join(home, 'ahpd', 'daemon.json'), 'utf8')) as { pid: number; url: string };
    spawned.push(record.pid);

    const status = await cli(['status']);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain(record.url);

    const stopped = await cli(['stop']);
    expect(stopped.code).toBe(0);
    expect(stopped.stdout).toContain('Stopped');
    await gone(record.pid);

    const after = await cli(['status']);
    expect(after.code).toBe(1);
  }, 40000);
});

describe('config', () => {
  it('prints the file it read and what it says', async () => {
    put({ port: 1234, host: '0.0.0.0' });
    const said = await cli(['config', '--config-file', config]);
    expect(said.code).toBe(0);
    expect(said.stdout).toBe(`${config}\n  port: 1234\n  host: "0.0.0.0"\n`);
  });

  it('says nothing is set when the file is empty', async () => {
    const said = await cli(['config']);
    expect(said.code).toBe(0);
    expect(said.stdout).toBe(`${join(home, 'ahpd', 'config.json')}\n  (nothing set)\n`);
  });
});

describe('user', () => {
  it('says the file holds nobody', async () => {
    const said = await cli(['user', 'list', '--users', users]);
    expect(said.code).toBe(0);
    expect(said.stdout).toBe(`no users in ${users}\n`);
  });

  it('adds, lists, mints for and removes a person', async () => {
    const added = await cli(['user', 'add', 'ada', '--users', users, '--role', 'admin']);
    expect(added.code).toBe(0);
    expect(added.stdout).toContain('Added ada (admin)');

    const listed = await cli(['user', 'list', '--users', users]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain('ada (admin)');

    const minted = await cli(['user', 'token', 'ada', '--users', users]);
    expect(minted.code).toBe(0);
    expect(minted.stdout.trim()).toMatch(/^[\w-]{20,}$/u);
    expect(minted.stderr).toContain('Shown once');

    const removed = await cli(['user', 'rm', 'ada', '--users', users]);
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain('Removed ada.');

    const again = await cli(['user', 'rm', 'ada', '--users', users]);
    expect(again.code).toBe(1);
    expect(again.stderr).toBe('ahpd: No user called ada.\n');
  }, 20000);

  it('names the sub-commands of a bare verb and of one it does not have', async () => {
    for (const args of [['user'], ['user', 'toy', '--users', users], ['--json', 'user']]) {
      const said = await cli(args);
      expect(said.code).toBe(2);
      expect(said.stderr).toBe('ahpd: user takes list, add, rm or token.\n');
      expect(said.stdout).toBe('');
    }
  });

  it('refuses add and rm without an id', async () => {
    for (const sub of ['add', 'rm', 'token']) {
      const said = await cli(['user', sub, '--users', users]);
      expect(said.code).toBe(2);
    }
  });
});

describe('plugin', () => {
  it('says none is named, and says when --no-plugins turned them all off', async () => {
    const none = await cli(['plugin', 'list', '--config-file', config]);
    expect(none.code).toBe(0);
    expect(none.stdout).toBe('plugins: none named\n');

    const off = await cli(['plugin', 'list', '--no-plugins', '--config-file', config]);
    expect(off.code).toBe(0);
    expect(off.stdout).toBe('plugins: --no-plugins, so nothing is listed\n');
  }, 20000);

  it('describes a --plugin without loading it', async () => {
    const said = await cli(['plugin', 'list', '--plugin', BACKEND, '--config-file', config]);
    expect(said.code).toBe(0);
    expect(said.stdout).toContain('plugin-echo');
    // Nothing was imported: a listing is resolve and manifest, and no more.
    expect(said.stderr).not.toContain('plugin-echo from');
  }, 20000);

  it('refuses install and remove with nothing named', async () => {
    for (const sub of ['install', 'remove']) {
      const said = await cli(['plugin', sub, '--config-file', config]);
      expect(said.code).toBe(2);
    }
  });

  it('refuses plugin install with a flag it does not take', async () => {
    const said = await cli(['plugin', 'install', '--bogus', 'some-package', '--config-file', config]);
    expect(said.code).toBe(2);
  });

  it('names the sub-commands of a bare verb and of one it does not have', async () => {
    for (const args of [['plugin'], ['plugin', 'toy', '--config-file', config], ['--json', 'plugin']]) {
      const said = await cli(args);
      expect(said.code).toBe(2);
      expect(said.stderr).toBe('ahpd: plugin takes list, install or remove.\n');
      expect(said.stdout).toBe('');
    }
  });

  it('still answers --help for a group', async () => {
    const said = await cli(['plugin', '--help']);
    expect(said.code).toBe(0);
    expect(said.stdout).toContain('plugin');
  });

  it('remove says the configuration changed before npm fails', async () => {
    put({ plugins: ['some-plugin'] });
    const said = await cli(['plugin', 'remove', 'some-plugin', '--config-file', config], { env: fakeNpm(1) });
    expect(said.code).toBe(2);
    expect(said.stdout).toContain('plugins -= some-plugin');
    expect(readFileSync(config, 'utf8')).not.toContain('some-plugin');
  });

  it('install --json writes only JSON', async () => {
    const said = await cli(
      ['plugin', 'install', 'some-plugin', '--no-enable', '--json', '--config-file', config],
      { env: fakeNpm(0) },
    );
    expect(said.code).toBe(0);
    expect(() => JSON.parse(said.stdout) as unknown).not.toThrow();
    expect(said.stderr).toContain('npm noise');
  }, 20000);
});
