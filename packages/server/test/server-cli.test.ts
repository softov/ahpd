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
import { createServer, type AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { version } from '../src/version.js';

const REPO = join(import.meta.dirname, '../../..');
const MAIN = 'packages/server/src/main.ts';
/** A plugin that contributes a backend, which is what lets a run get to its announcement. */
const BACKEND = join(import.meta.dirname, 'fixtures', 'plugin-echo');
/** A directory holding an `npm` that says one line and leaves the code `FAKE_NPM_EXIT` names. */
const FAKE_NPM = join(import.meta.dirname, 'fixtures', 'npm-fake');
/** A registry nothing listens on, so an install's manifest check is left to the fake npm. */
const NO_REGISTRY = 'http://127.0.0.1:1';
const fakeNpm = (code: number): Record<string, string> => ({
  PATH: `${FAKE_NPM}:${process.env['PATH'] ?? ''}`,
  npm_config_registry: NO_REGISTRY,
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
const daemonEnv = (extra: Record<string, string> = {}, unset: readonly string[] = []): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_CONFIG_HOME: home,
    CI: '1',
    NODE_OPTIONS: '--conditions development --import ./scripts/dev.mjs',
  };
  delete env.NO_UPDATE_NOTIFIER;
  Object.assign(env, extra);
  for (const name of unset) delete env[name];
  return env;
};

/**
 * The daemon as a process: argv in, what it said and the code it left, out.
 *
 * `unset` names variables taken out of the environment, which is how a case
 * runs without the `CI` every other case is silenced by.
 */
const cli = (
  args: string[],
  options: { config?: unknown; env?: Record<string, string>; unset?: readonly string[] } = {},
): Promise<Said> => {
  if (options.config !== undefined) put(options.config);
  const child = spawn(
    process.execPath,
    [MAIN, ...args],
    { cwd: REPO, env: daemonEnv(options.env ?? {}, options.unset ?? []), stdio: ['pipe', 'pipe', 'pipe'] },
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

const recordOf = (): { pid: number; url: string; connectUrl?: string; argv?: string[] } =>
  JSON.parse(readFileSync(join(home, 'ahpd', 'daemon.json'), 'utf8')) as { pid: number; url: string };

/** A backend whose catalogue is a file under the daemon's path, so it survives a restart. */
const KEPT = join(import.meta.dirname, 'fixtures', 'plugin-kept', 'index.ts');
/** A plugin whose `stopping` handler waits for the file `AHPD_RELEASE` names. */
const SLOW_STOP = join(import.meta.dirname, 'fixtures', 'plugin-slow-stop', 'index.ts');
/** A plugin that says whether the daemon's environment holds `AHPD_DETACHED`. */
const ENV = join(import.meta.dirname, 'fixtures', 'plugin-env', 'index.ts');
/** A plugin whose `apply` throws, which costs it and not the daemon. */
const THROWS = join(import.meta.dirname, 'fixtures', 'plugin-throws', 'index.ts');
/** A plugin that drops one of its own items and says which. */
const SKIPS = join(import.meta.dirname, 'fixtures', 'plugin-skips', 'index.ts');
/** A plugin whose `apply` throws an error of two lines. */
const MULTILINE = join(import.meta.dirname, 'fixtures', 'plugin-multiline.ts');

/** A port nothing is listening on as this returns. */
const freePort = (): Promise<number> => new Promise((done, fail) => {
  const probe = createServer();
  probe.once('error', fail);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as AddressInfo;
    probe.close(() => { done(port); });
  });
});

/** Requests sent one after another on one socket, and the results they were answered with. */
const rpc = (url: string, calls: readonly { method: string; params: unknown }[]): Promise<unknown[]> => new Promise((done, fail) => {
  const socket = new WebSocket(url);
  const results: unknown[] = [];
  const next = (): void => {
    const call = calls[results.length];
    if (call === undefined) { socket.close(); done(results); return; }
    socket.send(JSON.stringify({ jsonrpc: '2.0', id: results.length + 1, ...call }));
  };
  socket.on('open', next);
  socket.on('error', fail);
  socket.on('message', (raw: Buffer) => {
    const frame = JSON.parse(String(raw)) as { id?: number; result?: unknown; error?: { message: string } };
    if (frame.id !== results.length + 1) return;
    if (frame.error !== undefined) { socket.close(); fail(new Error(frame.error.message)); return; }
    results.push(frame.result);
    next();
  });
});
const INITIALIZE = { method: 'initialize', params: { clientId: 'restart-test', protocolVersions: ['0.9.0'] } };

/** A foreground daemon sent `signal` once it has announced itself, and the signal it ended on. */
const signalled = (signal: NodeJS.Signals): Promise<NodeJS.Signals | null> => new Promise((done) => {
  const child = spawn(
    process.execPath,
    [MAIN, '--port', '0', '--plugin', BACKEND, '--sessions', 'memory', '--automations', 'memory', '--no-update-check'],
    { cwd: REPO, env: daemonEnv(), stdio: ['pipe', 'pipe', 'pipe'] },
  );
  child.stdin.end();
  let stdout = '';
  let sent = false;
  const timer = setTimeout(() => { child.kill('SIGKILL'); }, 25000);
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += String(chunk);
    if (!sent && stdout.includes('ahpd on ws://')) { sent = true; child.kill(signal); }
  });
  child.once('exit', (_code, ended) => { clearTimeout(timer); done(ended); });
});

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

  it('serves only what is named under --no-cwd, and refuses when nothing is', async () => {
    writeFileSync(config, JSON.stringify({ plugins: [BACKEND], sessions: 'memory', automations: 'memory' }));
    const refused = await cli(['--stdio', '--no-cwd', '--plugin', BACKEND, '--config-file', config]);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('--no-cwd serves only');
    // A refusal that did not say what to do instead is a sentence over.
    expect(refused.stderr).toContain('--path');
    expect(refused.stderr).toContain('ahpd configure');

    writeFileSync(config, JSON.stringify({ paths: [home], plugins: [BACKEND], sessions: 'memory', automations: 'memory' }));
    const serving = await cli(['--stdio', '--no-cwd', '--plugin', BACKEND, '--config-file', config]);
    expect(serving.code).toBe(0);
    expect(serving.stderr).toContain(`sessions in ${home}`);
    // On a pipe, so nothing was asked about the folder it was started in.
    expect(serving.stderr).not.toContain('Serve ');
  }, 20000);

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
    expect(said.stderr).toContain(`${config}: http.host must be text matching ^\\S+$`);
  }, 20000);

  it('refuses an http.host with space around the address', async () => {
    const said = await cli(['--config-file', config, '--connection-token', 't'], { config: { http: { port: 0, host: ' 127.0.0.1 ' } } });
    expect(said.code).toBe(2);
    expect(said.stderr).toContain(`${config}: http.host must be text matching ^\\S+$`);
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

  it('takes space around the token from --token and AHPD_TOKEN as it does from a file', async () => {
    // The API on, so `--remote` has a manifest and a route to reach.
    put({ http: true, plugins: [BACKEND] });
    const began = await cli([
      'start', '--config-file', config, '--port', '0', '--connection-token', 'abc', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const record = recordOf();
    spawned.push(record.pid);
    // Only the port is read back: the announcement names the loopback host.
    const url = `http://127.0.0.1:${new URL(record.url).port}`;
    // The client's own cache, so nothing lands in the machine's real one.
    const env = { XDG_CACHE_HOME: join(home, 'cache') };

    const inline = await cli(['--remote', url, '--token', ' abc ', 'status'], { env });
    expect(inline.code).toBe(0);
    expect(inline.stdout).toContain(String(record.pid));

    const inherited = await cli(['--remote', url, 'status'], { env: { ...env, AHPD_TOKEN: ' abc\n' } });
    expect(inherited.code).toBe(0);
    expect(inherited.stdout).toContain(String(record.pid));
  }, 40000);
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

  it('records the line the child was given, and not the parent\'s globals', async () => {
    const began = await cli([
      '--no-color', 'start', '--port', '0', '--path', home, '--plugin', BACKEND, '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const record = JSON.parse(readFileSync(join(home, 'ahpd', 'daemon.json'), 'utf8')) as { pid: number; argv?: string[] };
    spawned.push(record.pid);
    expect(record.argv).toEqual(['--port', '0', '--path', home, '--plugin', BACKEND, '--no-update-check']);
  }, 40000);

  it('restarts a started daemon over HTTP with the line it was started with', async () => {
    put({ http: true, plugins: [BACKEND] });
    const began = await cli([
      'start', '--config-file', config, '--port', '0', '--connection-token', 'abc',
      '--sessions', 'memory', '--automations', 'memory', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const before = recordOf() as { pid: number; url: string; argv?: string[] };
    spawned.push(before.pid);
    const api = `http://127.0.0.1:${new URL(before.url).port}/api/restart`;
    const answered = await fetch(api, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer abc' },
      body: '{}',
    });
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ restarting: true, pid: before.pid });

    await gone(before.pid);
    expect(alive(before.pid)).toBe(false);
    // The successor writes its record once it has announced itself.
    const until = Date.now() + 20000;
    let after: { pid: number; argv?: string[]; connectUrl?: string } | undefined;
    while (Date.now() < until) {
      try { after = recordOf() as typeof after; }
      catch { after = undefined; }
      if (after !== undefined && after.pid !== before.pid) break;
      await new Promise((wait) => setTimeout(wait, 100));
    }
    expect(after?.pid).not.toBe(before.pid);
    if (after !== undefined) spawned.push(after.pid);
    expect(after?.argv).toEqual(before.argv);
    expect(await knock(String(after?.connectUrl))).toBe('open');
  }, 60000);

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

  it('prints the successor\'s skips when it restarts from the terminal', async () => {
    const began = await cli([
      'start', '--port', '0', '--plugin', BACKEND, '--plugin', SKIPS,
      '--sessions', 'memory', '--automations', 'memory', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const before = recordOf() as { pid: number };
    spawned.push(before.pid);

    const again = await cli(['restart']);
    const after = recordOf() as { pid: number; url: string };
    spawned.push(after.pid);
    expect({ code: again.code, stderr: again.stderr }).toEqual({ code: 0, stderr: '' });
    expect(again.stdout).toBe([
      'skipped: presets.router reads OPENROUTER_API_KEY, which the daemon\'s environment does not have',
      `ahpd on ${after.url} (pid ${String(after.pid)}), restarted from pid ${String(before.pid)}`,
      '',
    ].join('\n'));

    // And the daemon announced them between its own two lines, which is what
    // the terminal reads them out of.
    const log = readFileSync(join(home, 'ahpd', 'daemon.log'), 'utf8');
    expect(log.indexOf('restart: starting the successor')).toBeLessThan(log.lastIndexOf('skipped: presets.router'));
    expect(log.lastIndexOf('skipped: presets.router')).toBeLessThan(log.lastIndexOf('restarted as'));
  }, 90000);

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

  it('restarts a started daemon from the terminal with the line it was started with', async () => {
    const began = await cli([
      'start', '--port', '0', '--plugin', BACKEND, '--sessions', 'memory', '--automations', 'memory', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const before = recordOf() as { pid: number; argv?: string[] };
    spawned.push(before.pid);

    const again = await cli(['restart']);
    const after = recordOf() as { pid: number; url: string; argv?: string[] };
    spawned.push(after.pid);
    expect({ code: again.code, stderr: again.stderr }).toEqual({ code: 0, stderr: '' });
    expect(again.stdout).toBe(`ahpd on ${after.url} (pid ${String(after.pid)}), restarted from pid ${String(before.pid)}\n`);
    expect(after.pid).not.toBe(before.pid);
    expect(after.argv).toEqual(before.argv);
    await gone(before.pid);
    expect(alive(before.pid)).toBe(false);

    const forced = await cli(['restart', '--force']);
    const last = recordOf() as { pid: number };
    spawned.push(last.pid);
    expect(forced.code).toBe(0);
    expect(last.pid).not.toBe(after.pid);
  }, 90000);

  it('restarts from the terminal, and the successor carries the token its line reads now', async () => {
    put({ plugins: [BACKEND], connectionToken: 'abc' });
    const began = await cli([
      'start', '--config-file', config, '--port', '0', '--sessions', 'memory', '--automations', 'memory', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const before = recordOf();
    spawned.push(before.pid);
    expect(before.connectUrl).toContain('tkn=abc');

    put({ plugins: [BACKEND], connectionToken: 'xyz' });
    const again = await cli(['restart']);
    const after = recordOf();
    spawned.push(after.pid);
    expect({ code: again.code, stderr: again.stderr }).toEqual({ code: 0, stderr: '' });
    expect(after.pid).not.toBe(before.pid);
    expect(after.connectUrl).toContain('tkn=xyz');
    expect(await knock(String(after.connectUrl))).toBe('open');
  }, 90000);

  it('refuses a restart whose line cannot run over the file as it is now, and the daemon runs on', async () => {
    put({ plugins: [BACKEND] });
    const began = await cli([
      'start', '--config-file', config, '--port', '0', '--sessions', 'memory', '--automations', 'memory', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const before = recordOf();
    spawned.push(before.pid);

    put('{ "plugins": [');
    const again = await cli(['restart']);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain('Its line cannot run now, so it was not stopped:');
    expect(alive(before.pid)).toBe(true);
    expect(recordOf().pid).toBe(before.pid);
    expect(await knock(before.connectUrl as string)).toBe('open');
  }, 60000);

  it('refuses a restart whose recorded line this code does not take, and the daemon runs on', async () => {
    const began = await cli([
      'start', '--port', '0', '--plugin', BACKEND, '--sessions', 'memory', '--automations', 'memory', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const before = recordOf();
    spawned.push(before.pid);

    /*
     * A line written by an ahpd that had a flag this one does not, which is
     * what an update under a running daemon leaves in the record: the old
     * daemon carries on holding a line only the new code can read.
     */
    const written = join(home, 'ahpd', 'daemon.json');
    const record = JSON.parse(readFileSync(written, 'utf8')) as Record<string, unknown>;
    writeFileSync(written, JSON.stringify({ ...record, argv: [...(record['argv'] as string[]), '--frobnicate'] }));

    // The refusal carries the successor's own words, because they are what it
    // would have died of, with the daemon that holds the line still up.
    const again = await cli(['restart']);
    expect(again.code).toBe(1);
    expect(again.stderr).toBe('ahpd: Its line cannot run now, so it was not stopped: Unknown option --frobnicate.\n');
    expect(alive(before.pid)).toBe(true);
    expect(recordOf().pid).toBe(before.pid);
    expect(await knock(before.connectUrl as string)).toBe('open');
  }, 60000);

  it('restarts on a fixed port at the same URL, and a session made before is listed after', async () => {
    const port = await freePort();
    const began = await cli([
      'start', '--port', String(port), '--path', home, '--plugin', KEPT, '--automations', 'memory', '--no-update-check',
    ]);
    expect(began.code).toBe(0);
    const before = recordOf();
    spawned.push(before.pid);
    expect(before.url).toBe(`ws://127.0.0.1:${String(port)}`);
    await rpc(`${before.url}/`, [INITIALIZE, { method: 'createSession', params: { channel: 'ahp-session:/kept-1', provider: 'kept' } }]);

    const again = await cli(['restart']);
    const after = recordOf();
    spawned.push(after.pid);
    expect({ code: again.code, stderr: again.stderr }).toEqual({ code: 0, stderr: '' });
    expect(after.pid).not.toBe(before.pid);
    expect(after.url).toBe(before.url);

    const [, listed] = await rpc(`${after.url}/`, [INITIALIZE, { method: 'listSessions', params: {} }]) as [unknown, { items: { resource: string }[] }];
    expect(listed.items.map((row) => row.resource)).toContain('kept:/kept-1');
  }, 90000);

  it('lets a stop sent while a restart is stopping win, and leaves no daemon running', async () => {
    const release = join(home, 'release');
    const began = await cli([
      'start', '--port', '0', '--plugin', BACKEND, '--plugin', SLOW_STOP, '--sessions', 'memory', '--automations', 'memory', '--no-update-check',
    ], { env: { AHPD_RELEASE: release } });
    expect(began.code).toBe(0);
    const before = recordOf();
    spawned.push(before.pid);

    const restarting = cli(['restart']);
    // The receipt is written before the `stopping` handler, which holds until the file exists.
    const log = join(home, 'ahpd', 'daemon.log');
    const until = Date.now() + 10000;
    while (!readFileSync(log, 'utf8').includes('restart: stopping (SIGHUP)') && Date.now() < until) {
      await new Promise((wait) => setTimeout(wait, 25));
    }
    expect(readFileSync(log, 'utf8')).toContain('restart: stopping (SIGHUP)');
    const stopped = await cli(['stop']);
    expect(stopped.code).toBe(0);
    writeFileSync(release, '');

    const restarted = await restarting;
    expect(restarted.code).toBe(1);
    expect(restarted.stderr).toContain('stopped first');
    await gone(before.pid);
    expect(alive(before.pid)).toBe(false);
    expect(existsSync(join(home, 'ahpd', 'daemon.json'))).toBe(false);
    expect(announced().filter(alive)).toEqual([]);
  }, 60000);

  it('takes AHPD_DETACHED out of a started daemon\'s environment, so a session\'s shell never has it', async () => {
    const began = await cli(['start', '--port', '0', '--plugin', BACKEND, '--plugin', ENV, '--sessions', 'memory', '--automations', 'memory', '--no-update-check']);
    expect(began.code).toBe(0);
    spawned.push(recordOf().pid);
    const log = readFileSync(join(home, 'ahpd', 'daemon.log'), 'utf8');
    expect(log).toContain('AHPD_DETACHED unset');
  }, 40000);

  it('leaves a foreground daemon to the default for either restart signal, which ends it', async () => {
    expect(await signalled('SIGHUP')).toBe('SIGHUP');
    expect(await signalled('SIGUSR2')).toBe('SIGUSR2');
  }, 60000);

  it('says none is running to restart', async () => {
    const said = await cli(['restart']);
    expect(said.code).toBe(1);
    expect(said.stderr).toContain('None running in the background');
  });

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

describe('plugin config', () => {
  it('sets with three words, shows with two, and unsets with the word unset', async () => {
    const secret = join(import.meta.dirname, 'fixtures', 'plugin-secret', 'index.ts');
    put({ plugins: [secret] });
    const set = await cli(['plugin', 'config', secret, 'retries', '2', '--config-file', config]);
    expect(set.code).toBe(0);
    expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({ plugins: [{ name: secret, options: { retries: 2 } }] });

    const shown = await cli(['plugin', 'config', secret, '--config-file', config]);
    expect(shown.code).toBe(0);
    expect(shown.stdout).toBe(`${secret}\n  retries: 2\n`);

    const removed = await cli(['plugin', 'config', 'unset', secret, 'retries', '--config-file', config]);
    expect(removed.code).toBe(0);
    expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({ plugins: [{ name: secret }] });
  }, 20000);
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

    const removed = await cli(['user', 'rm', 'ada', '--users', users, '--yes']);
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain('Removed ada.');

    const again = await cli(['user', 'rm', 'ada', '--users', users, '--yes']);
    expect(again.code).toBe(1);
    expect(again.stderr).toBe('ahpd: No user called ada.\n');
  }, 20000);

  it('asks before taking a person out, and runs with --yes where there is no terminal', async () => {
    await cli(['user', 'add', 'bob', '--users', users]);
    const asked = await cli(['user', 'rm', 'bob', '--users', users]);
    expect(asked.code).toBe(2);
    expect(asked.stdout).toBe('');
    expect(asked.stderr).toBe('ahpd: user rm removes user bob; pass --yes to run it without a terminal\n');
    // Nothing ran: the question was not answered.
    expect((await cli(['user', 'list', '--users', users])).stdout).toContain('bob');

    const removed = await cli(['user', 'rm', 'bob', '--users', users, '--yes']);
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain('Removed bob.');
    expect((await cli(['user', 'list', '--users', users])).stdout).not.toContain('bob');
  }, 30000);

  it('names the sub-commands of a bare verb and of one it does not have', async () => {
    for (const args of [['user'], ['user', 'toy', '--users', users], ['--json', 'user']]) {
      const said = await cli(args);
      expect(said.code).toBe(2);
      expect(said.stderr).toBe('ahpd: user takes list, add, rm, token, member or primary.\n');
      expect(said.stdout).toBe('');
    }
  });

  it('refuses add and rm without an id', async () => {
    for (const sub of ['add', 'rm', 'token']) {
      const said = await cli(['user', sub, '--users', users]);
      expect(said.code).toBe(2);
    }
  });

  it('refuses a flag the verb reads by nothing, naming it', async () => {
    await cli(['user', 'add', 'ada', '--users', users, '--role', 'admin']);
    const refused = await cli(['user', 'rm', 'ada', '--role', 'admin', '--users', users]);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('Unknown option --role');
    // Nothing ran, so the person is still in the file.
    expect((await cli(['user', 'list', '--users', users])).stdout).toContain('ada');
  }, 20000);

  it('takes --host and --port on the verb that prints an address, and on no other', async () => {
    await cli(['user', 'add', 'ada', '--users', users]);
    const printed = await cli(['user', 'token', 'ada', '--url', '--users', users, '--host', '10.0.0.5', '--port', '9310']);
    expect(printed.code).toBe(0);
    expect(printed.stdout.trim()).toMatch(/^ws:\/\/10\.0\.0\.5:9310\/\?tkn=/u);

    // `--url` is the one place the address is read, so every other verb refuses
    // it rather than accepting a port that would mean nothing.
    for (const args of [
      ['user', 'list', '--users', users, '--port', '9310'],
      ['user', 'rm', 'ada', '--users', users, '--host', '10.0.0.5'],
    ]) {
      const refused = await cli(args);
      expect(refused.code).toBe(2);
      expect(refused.stderr).toMatch(/Unknown option --(port|host)/u);
    }
  }, 20000);

  it('takes --url on the verb that prints one, and on no other', async () => {
    await cli(['user', 'add', 'ada', '--users', users]);
    const printed = await cli(['user', 'token', 'ada', '--url', '--users', users]);
    expect(printed.code).toBe(0);
    expect(printed.stdout.trim()).toMatch(/^ws:\/\/[^/]+\/\?tkn=/u);

    const refused = await cli(['user', 'rm', 'ada', '--url', '--users', users]);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('Unknown option --url');
  }, 20000);
});

describe('team and project', () => {
  it('takes --title on the verb that names one, and refuses it where it is read by nothing', async () => {
    const named = await cli(['team', 'add', 'backend', '--title', 'Backend', '--users', users]);
    expect(named.code).toBe(0);
    expect(named.stdout).toContain('Named team backend (Backend).');

    const refused = await cli(['team', 'rm', 'backend', '--title', 'Backend', '--users', users]);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('Unknown option --title');
    // Nothing ran, so the team is still named.
    expect((await cli(['team', 'list', '--users', users])).stdout).toBe('backend  Backend\n');
  }, 20000);
});

describe('vault', () => {
  it('takes the configuration it reads and refuses the daemon flags it does not', async () => {
    put({ plugins: [{ name: 'orders', options: { apiKey: { $secret: 'host:orders' } } }] });
    const listed = await cli(['vault', 'list', '--config-file', config]);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toBe('host:orders  not set, named at plugins[0].options.apiKey\n');

    const refused = await cli(['vault', 'delete', 'host:orders', '--port', '9310']);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain('Unknown option --port');

    // And the configuration is `vault list`'s alone: the two that write reach
    // the vault beside the one this run reads, so a flag naming another would
    // keep a secret in a store nothing else opens.
    for (const args of [
      ['vault', 'set', 'host:orders', '--config-file', config],
      ['vault', 'delete', 'host:orders', '--config-file', config],
    ]) {
      const said = await cli(args);
      expect(said.code).toBe(2);
      expect(said.stderr).toContain('Unknown option --config-file');
    }
  }, 20000);
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

  it('refuses install, remove and update with nothing named', async () => {
    for (const sub of ['install', 'remove', 'update']) {
      const said = await cli(['plugin', sub, '--config-file', config]);
      expect(said.code).toBe(2);
    }
    // What is missing is the name, and it is named: the words reach the
    // declaration and are one argument short, rather than reaching nothing.
    for (const sub of ['install', 'remove']) {
      const said = await cli(['plugin', sub, '--config-file', config]);
      expect(said.stderr).toBe(`ahpd: "plugin ${sub}" needs name.\nUsage: ahpd plugin ${sub} <name...>\n`);
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
      expect(said.stderr).toBe('ahpd: plugin takes list, update, config, install, remove, enable or disable.\n');
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
    const said = await cli(['plugin', 'remove', 'some-plugin', '--config-file', config, '--yes'], { env: fakeNpm(1) });
    expect(said.code).toBe(2);
    expect(said.stdout).toContain('plugins -= some-plugin');
    expect(readFileSync(config, 'utf8')).not.toContain('some-plugin');
  });

  it('a failed npm says what failed at the terminal, and npm\'s error only as npm said it', async () => {
    writeFileSync(join(home, 'ahpd', 'package.json'), JSON.stringify({ dependencies: { 'some-plugin': '^1.0.0' } }));
    put({ plugins: ['some-plugin'] });
    const env = { ...fakeNpm(1), FAKE_NPM_STDERR: 'npm error code E404' };
    const runs: [string, string[]][] = [
      ['npm could not install some-plugin', ['plugin', 'install', 'some-plugin', '--config-file', config]],
      ['npm could not update some-plugin', ['plugin', 'update', 'all']],
      ['npm could not uninstall some-plugin', ['plugin', 'remove', 'some-plugin', '--config-file', config, '--yes']],
    ];
    for (const [failed, args] of runs) {
      const said = await cli(args, { env });
      expect(said.code).toBe(2);
      expect(said.stderr).toContain(failed);
      expect(said.stderr.split('npm error code E404')).toHaveLength(2);
    }
  }, 30000);

  it('asks for a restart when an update moved only the sdk', async () => {
    // Every update installs the daemon's own sdk beside the plugins, so a
    // daemon upgraded before its plugins moves the sdk on a call that moves no
    // plugin: the loaded plugins are on the old one until the daemon restarts.
    const dir = join(home, 'ahpd');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'some-plugin': '^1.0.0' } }));
    const there: [string, string][] = [['some-plugin', '1.0.0'], ['@ahpd/sdk', '0.0.1']];
    for (const [name, version] of there) {
      mkdirSync(join(dir, 'node_modules', name), { recursive: true });
      writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
    }
    // A record of a daemon that is up, which is what at the terminal decides
    // whether a restart is asked for.
    writeFileSync(join(dir, 'daemon.json'), JSON.stringify({
      pid: process.pid, url: 'ws://127.0.0.1:9187', connectUrl: 'ws://127.0.0.1:9187/', paths: [], startedAt: '',
    }));
    const said = await cli(['plugin', 'update', 'all', '--json'], { env: { ...fakeNpm(0), FAKE_NPM_LANDS: '@ahpd/sdk 9.9.9' } });
    expect(said.code).toBe(0);
    expect(JSON.parse(said.stdout) as unknown).toEqual({
      plugins: [{ name: '@ahpd/sdk', from: '0.0.1', to: '9.9.9' }],
      restart: true,
    });
    expect(said.stderr).toContain('Restart the daemon to load the change: ahpd restart');
  }, 20000);

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
