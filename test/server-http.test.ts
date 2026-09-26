/*
 * The HTTP API, and the CLI that talks to it.
 *
 * The daemon is a real process, because half of what is being checked is the
 * wiring rather than a function: `http` in the configuration has to reach the
 * listener, the same port has to answer the WebSocket upgrade and the API
 * beside it, and `--remote` is a second process reading a manifest over the
 * wire. The configuration directory is temporary, so a case writes the file
 * the daemon reads without touching the machine it runs on.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileUsers } from '@ahpd/sdk';

const REPO = join(import.meta.dirname, '..');
const MAIN = 'packages/server/src/main.ts';
/** A plugin that contributes a backend, which is what lets a run get to its announcement. */
const BACKEND = './test/fixtures/plugin-echo';

interface Said {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface Daemon {
  child: ChildProcess;
  /** The port the WebSocket is on. */
  port: number;
  /** The port the API is on, when it has one of its own. */
  apiPort: number;
  stderr(): string;
}

let home: string;
let config: string;
let usersFile: string;
const started: Daemon[] = [];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-http-'));
  mkdirSync(join(home, 'ahpd'), { recursive: true });
  // The default path, and the one passed as `--config-file`, are the same file:
  // a served command reads the configuration without a flag, so a daemon on a
  // different file would answer about a configuration nobody wrote.
  config = join(home, 'ahpd', 'config.json');
  usersFile = join(home, 'users.json');
  writeFileSync(config, '{}\n');
});

afterEach(async () => {
  for (const one of started.splice(0)) {
    one.child.kill('SIGTERM');
    await new Promise<void>((done) => {
      if (one.child.exitCode !== null || one.child.signalCode !== null) { done(); return; }
      const timer = setTimeout(() => { one.child.kill('SIGKILL'); done(); }, 5000);
      one.child.once('exit', () => { clearTimeout(timer); done(); });
    });
  }
  rmSync(home, { recursive: true, force: true });
});

/**
 * The daemon as a process, started with one configuration.
 *
 * Resolved once the announcement names the WebSocket origin, which is the first
 * moment there is anything to ask; the API's own port is read off the `http on`
 * line when there is one, so `http.port: 0` works.
 */
const daemon = (value: unknown, args: string[] = []): Promise<Daemon> => new Promise((resolve, reject) => {
  writeFileSync(config, JSON.stringify(value));
  const child = spawn(
    process.execPath,
    [
      '--conditions', 'development', '--import', './scripts/dev.mjs', MAIN,
      '--config-file', config, '--port', '0', '--no-update-check', ...args,
    ],
    { cwd: REPO, env: { ...process.env, XDG_CONFIG_HOME: home, CI: '1' }, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    child.kill('SIGKILL');
    reject(new Error(`the daemon never announced itself:\n${stdout}\n${stderr}`));
  }, 25000);
  child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk); });
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += String(chunk);
    const ws = /ahpd on ws:\/\/127\.0\.0\.1:(\d+)/u.exec(stdout);
    if (ws === null) return;
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    const api = /http on http:\/\/127\.0\.0\.1:(\d+)\/api/u.exec(stdout);
    started.push({ child, port: Number(ws[1]), apiPort: api === null ? -1 : Number(api[1]), stderr: () => stderr });
    resolve({ child, port: Number(ws[1]), apiPort: api === null ? -1 : Number(api[1]), stderr: () => stderr });
  });
  child.once('exit', (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    reject(new Error(`the daemon exited with ${String(code)}:\n${stdout}\n${stderr}`));
  });
  child.stdin.end();
});

/** The client, as a process: argv in, what it said and the code it left, out. */
const cli = (args: string[]): Promise<Said> => new Promise((done) => {
  const child = spawn(
    process.execPath,
    ['--conditions', 'development', '--import', './scripts/dev.mjs', MAIN, ...args],
    { cwd: REPO, env: { ...process.env, XDG_CONFIG_HOME: home, CI: '1' }, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  child.stdin.end();
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk); });
  const timer = setTimeout(() => { child.kill('SIGKILL'); }, 20000);
  child.on('exit', (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
});

/** The record a detached daemon writes, so `status` has one to read. */
const recordFor = (one: Daemon): void => {
  writeFileSync(join(home, 'ahpd', 'daemon.json'), `${JSON.stringify({
    pid: one.child.pid,
    url: `ws://127.0.0.1:${String(one.port)}`,
    connectUrl: `ws://127.0.0.1:${String(one.port)}/`,
    paths: [REPO],
    startedAt: '2026-09-26T12:00:00.000Z',
  })}\n`);
};

const get = (url: string, token?: string): Promise<Response> =>
  fetch(url, token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } });

const post = (url: string, token: string | undefined, body: unknown): Promise<Response> =>
  fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });

describe('http in the configuration', () => {
  it('answers /api with 404 when it is off', async () => {
    const one = await daemon({ plugins: [BACKEND] });
    expect(one.apiPort).toBe(-1);
    const response = await get(`http://127.0.0.1:${String(one.port)}/api/status`);
    expect(response.status).toBe(404);
  });

  it('serves the manifest on the daemon port when http is true', async () => {
    const one = await daemon({ http: true, plugins: [BACKEND] });
    expect(one.apiPort).toBe(one.port);
    const response = await get(`http://127.0.0.1:${String(one.port)}/api/cli-manifest`);
    expect(response.status).toBe(200);
    const manifest = await response.json() as { program: { name: string }; commands: { id: string }[] };
    expect(manifest.program.name).toBe('ahpd');
    expect(manifest.commands.map((command) => command.id)).toContain('daemon.status');
  });

  it('moves the API to its own listener when http.port is set', async () => {
    const one = await daemon({ http: { port: 0 }, plugins: [BACKEND] });
    expect(one.apiPort).toBeGreaterThan(0);
    expect(one.apiPort).not.toBe(one.port);
    // The API's listener answers, and the daemon's own port says there is none.
    expect((await get(`http://127.0.0.1:${String(one.apiPort)}/api/cli-manifest`)).status).toBe(200);
    expect((await get(`http://127.0.0.1:${String(one.port)}/api/cli-manifest`)).status).toBe(404);
  }, 30000);
});

describe('a request signs in', () => {
  /** One daemon with a token and two people: ada may not write the configuration, root may. */
  const guarded = async (): Promise<{ one: Daemon; member: string; admin: string; token: string }> => {
    const directory = fileUsers({ path: usersFile });
    await directory.add('ada', ['member']);
    await directory.add('root', ['admin']);
    const member = await directory.mint('ada');
    const admin = await directory.mint('root');
    const token = 'root-secret';
    const one = await daemon({ http: true, users: usersFile, plugins: [BACKEND] }, ['--connection-token', token]);
    recordFor(one);
    return { one, member, admin, token };
  };

  it('refuses /api/status without a token and answers with the deployment one', async () => {
    const { one, token } = await guarded();
    const base = `http://127.0.0.1:${String(one.port)}/api/status`;
    expect((await get(base)).status).toBe(401);
    const answered = await get(base, token);
    expect(answered.status).toBe(200);
    expect((await answered.json() as { pid: number }).pid).toBe(one.child.pid);
  }, 30000);

  it('refuses a command the person has no grant for, with the WebSocket reason', async () => {
    const { one, member } = await guarded();
    const url = `http://127.0.0.1:${String(one.port)}/api/plugin/install`;
    const refused = await post(url, member, { name: ['left-pad'] });
    expect(refused.status).toBe(403);
    expect((await refused.json() as { message: string }).message).toBe('ada may not config:write here');
  }, 30000);

  it('answers a person who holds the grant', async () => {
    const { one, admin } = await guarded();
    const base = `http://127.0.0.1:${String(one.port)}/api/config`;
    expect((await get(base)).status).toBe(401);
    expect((await get(base, admin)).status).toBe(200);
  }, 30000);
});

describe('--remote', () => {
  it('runs status and plugin list against the daemon', async () => {
    const one = await daemon(
      { http: true, plugins: [BACKEND] },
      ['--connection-token', 'root-secret'],
    );
    recordFor(one);
    const url = `http://127.0.0.1:${String(one.port)}`;

    const status = await cli(['--remote', url, '--token', 'root-secret', 'status', '--no-update-check']);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain(`ws://127.0.0.1:${String(one.port)}`);

    const plugins = await cli(['--remote', url, '--token', 'root-secret', 'plugin', 'list', '--no-update-check']);
    expect(plugins.code).toBe(0);
    expect(plugins.stdout).toContain('plugin-echo');
  }, 40000);

  it('reads the token from AHPD_TOKEN too', async () => {
    const one = await daemon(
      { http: true, plugins: [BACKEND] },
      ['--connection-token', 'root-secret'],
    );
    recordFor(one);
    const url = `http://127.0.0.1:${String(one.port)}`;
    const said = await new Promise<Said>((done) => {
      const child = spawn(
        process.execPath,
        ['--conditions', 'development', '--import', './scripts/dev.mjs', MAIN, '--remote', url, 'status', '--no-update-check'],
        { cwd: REPO, env: { ...process.env, XDG_CONFIG_HOME: home, CI: '1', AHPD_TOKEN: 'root-secret' }, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      child.stdin.end();
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk); });
      child.on('exit', (code) => done({ code, stdout, stderr }));
    });
    expect(said.code).toBe(0);
    expect(said.stdout).toContain(`ws://127.0.0.1:${String(one.port)}`);
  }, 40000);
});
