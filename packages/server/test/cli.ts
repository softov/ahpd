/*
 * What the `server-cli` cases share: a temporary configuration directory per
 * case, the daemon run as a process, and the pids a case left behind.
 *
 * Importing this registers the hooks that make and remove that directory, so
 * each file that imports it gets them.
 */
import { spawn } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { WebSocket } from 'ws';

export const REPO = join(import.meta.dirname, '../../..');
export const MAIN = 'packages/server/src/main.ts';
/** A plugin that contributes a backend, which is what lets a run get to its announcement. */
export const BACKEND = join(import.meta.dirname, 'fixtures', 'plugin-echo');
/** A directory holding an `npm` that says one line and leaves the code `FAKE_NPM_EXIT` names. */
export const FAKE_NPM = join(import.meta.dirname, 'fixtures', 'npm-fake');
/** A registry nothing listens on, so an install's manifest check is left to the fake npm. */
export const NO_REGISTRY = 'http://127.0.0.1:1';
export const fakeNpm = (code: number): Record<string, string> => ({
  PATH: `${FAKE_NPM}:${process.env['PATH'] ?? ''}`,
  npm_config_registry: NO_REGISTRY,
  FAKE_NPM_EXIT: String(code),
});

export interface Said {
  code: number | null;
  stdout: string;
  stderr: string;
}

export let home: string;
export let config: string;
export let users: string;
export let wire: string;
/** Pids a `start` case left behind, killed when the case ends. */
export const spawned: number[] = [];

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
export const announced = (): number[] => {
  let log = '';
  try { log = readFileSync(join(home, 'ahpd', 'daemon.log'), 'utf8'); }
  catch { return []; }
  return [...log.matchAll(/\(pid (\d+)\)/gu)]
    .map((match) => Number(match[1]))
    .filter((pid) => pid !== process.pid);
};

/** Whether the OS still holds that process. */
export const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
};

/** Wait, briefly, for a stopped daemon to leave. */
export const gone = async (pid: number): Promise<void> => {
  const until = Date.now() + 5000;
  while (alive(pid) && Date.now() < until) await new Promise((wait) => setTimeout(wait, 50));
};

export const put = (value: unknown): void => {
  writeFileSync(config, typeof value === 'string' ? value : JSON.stringify(value));
};

/**
 * The environment the daemon runs in.
 *
 * The loader is on the environment rather than on argv because `start` runs
 * this program again for the daemon, and a child inherits the environment
 * rather than this process's argv.
 */
export const daemonEnv = (extra: Record<string, string> = {}, unset: readonly string[] = []): NodeJS.ProcessEnv => {
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
export const cli = (
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
export const foreground = (args: string[]): Promise<string> => new Promise((resolve, reject) => {
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
export const knock = (url: string): Promise<string> => new Promise((resolve) => {
  const socket = new WebSocket(url);
  socket.on('open', () => { socket.close(); resolve('open'); });
  socket.on('error', (error: Error) => { resolve(error.message); });
});

export const recordOf = (): { pid: number; url: string; connectUrl?: string; argv?: string[] } =>
  JSON.parse(readFileSync(join(home, 'ahpd', 'daemon.json'), 'utf8')) as { pid: number; url: string };

/** A backend whose catalogue is a file under the daemon's path, so it survives a restart. */
export const KEPT = join(import.meta.dirname, 'fixtures', 'plugin-kept', 'index.ts');
/** A plugin whose `stopping` handler waits for the file `AHPD_RELEASE` names. */
export const SLOW_STOP = join(import.meta.dirname, 'fixtures', 'plugin-slow-stop', 'index.ts');
/** A plugin that says whether the daemon's environment holds `AHPD_DETACHED`. */
export const ENV = join(import.meta.dirname, 'fixtures', 'plugin-env', 'index.ts');
/** A plugin whose `apply` throws, which costs it and not the daemon. */
export const THROWS = join(import.meta.dirname, 'fixtures', 'plugin-throws', 'index.ts');
/** A plugin that drops one of its own items and says which. */
export const SKIPS = join(import.meta.dirname, 'fixtures', 'plugin-skips', 'index.ts');
/** A plugin whose `apply` throws an error of two lines. */
export const MULTILINE = join(import.meta.dirname, 'fixtures', 'plugin-multiline.ts');

/** A port nothing is listening on as this returns. */
export const freePort = (): Promise<number> => new Promise((done, fail) => {
  const probe = createServer();
  probe.once('error', fail);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as AddressInfo;
    probe.close(() => { done(port); });
  });
});

/** Requests sent one after another on one socket, and the results they were answered with. */
export const rpc = (url: string, calls: readonly { method: string; params: unknown }[]): Promise<unknown[]> => new Promise((done, fail) => {
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
export const INITIALIZE = { method: 'initialize', params: { clientId: 'restart-test', protocolVersions: ['0.9.0'] } };

/** A foreground daemon sent `signal` once it has announced itself, and the signal it ended on. */
export const signalled = (signal: NodeJS.Signals): Promise<NodeJS.Signals | null> => new Promise((done) => {
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

