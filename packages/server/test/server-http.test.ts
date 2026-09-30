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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { fileUsers } from '@ahpd/sdk';
import type { Options } from '../src/commands/options.js';
import { apiOrigins } from '../src/commands/run.js';
import { servedRegistry, type ServedFacts } from '../src/commands/served.js';
import { apiHandler, withoutApi } from '../src/http.js';
import { version } from '../src/version.js';

const REPO = join(import.meta.dirname, '../../..');
const MAIN = 'packages/server/src/main.ts';
/** A plugin that contributes a backend, which is what lets a run get to its announcement. */
const BACKEND = join(import.meta.dirname, 'fixtures', 'plugin-echo');
/** A directory holding an `npm` that can wait before it answers. */
const FAKE_NPM = join(import.meta.dirname, 'fixtures', 'npm-fake');
/** A registry nothing listens on, so an install's manifest check is left to the fake npm. */
const NO_REGISTRY = 'http://127.0.0.1:1';
const fakeNpm = (extra: Record<string, string> = {}): Record<string, string> => ({
  PATH: `${FAKE_NPM}:${process.env['PATH'] ?? ''}`,
  npm_config_registry: NO_REGISTRY,
  ...extra,
});

interface Said {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface Daemon {
  child: ChildProcess;
  /** The host the WebSocket is on, as the announcement names it. */
  host: string;
  /** The port the WebSocket is on. */
  port: number;
  /** The host the API is on, as the announcement names it, or `''` with no API. */
  apiHost: string;
  /** The port the API is on, when it has one of its own. */
  apiPort: number;
  stderr(): string;
}

let home: string;
let config: string;
let usersFile: string;
/** The client's own directories, with no configuration and no daemon record. */
let clientHome: string;
let cache: string;
const started: Daemon[] = [];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-http-'));
  mkdirSync(join(home, 'ahpd'), { recursive: true });
  // Deliberately outside the default `$XDG_CONFIG_HOME/ahpd/config.json`: a
  // served command reads the daemon's own file, so a daemon on this one would
  // answer about a configuration nobody wrote if it read the default.
  config = join(home, 'config.json');
  usersFile = join(home, 'users.json');
  clientHome = join(home, 'client');
  cache = join(home, 'cache');
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
const daemon = (value: unknown, args: string[] = [], env: Record<string, string> = {}): Promise<Daemon> => new Promise((resolve, reject) => {
  writeFileSync(config, JSON.stringify(value));
  const child = spawn(
    process.execPath,
    [
      '--conditions', 'development', '--import', './scripts/dev.mjs', MAIN,
      '--config-file', config, '--port', '0', '--no-update-check', ...args,
    ],
    { cwd: REPO, env: { ...process.env, XDG_CONFIG_HOME: home, CI: '1', ...env }, stdio: ['pipe', 'pipe', 'pipe'] },
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
    const ws = /ahpd on ws:\/\/([^\s,]+):(\d+)/u.exec(stdout);
    if (ws === null) return;
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    const api = /http on http:\/\/([^\s,]+):(\d+)\/api/u.exec(stdout);
    const one: Daemon = {
      child,
      host: ws[1] as string,
      port: Number(ws[2]),
      apiHost: api === null ? '' : api[1] as string,
      apiPort: api === null ? -1 : Number(api[2]),
      stderr: () => stderr,
    };
    started.push(one);
    resolve(one);
  });
  child.once('exit', (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    reject(new Error(`the daemon exited with ${String(code)}:\n${stdout}\n${stderr}`));
  });
  child.stdin.end();
});

/**
 * The client, as a process: argv in, what it said and the code it left, out.
 *
 * Its configuration and cache directories are its own, with no configuration
 * and no daemon record, so a `--remote` case passes only when the daemon
 * answered: a command answered locally would find neither.
 */
const cli = (args: string[], env: Record<string, string> = {}): Promise<Said> => new Promise((done) => {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_CONFIG_HOME: clientHome,
    XDG_CACHE_HOME: cache,
    CI: '1',
  };
  delete environment['AHPD_TOKEN'];
  Object.assign(environment, env);
  const child = spawn(
    process.execPath,
    ['--conditions', 'development', '--import', './scripts/dev.mjs', MAIN, ...args],
    { cwd: REPO, env: environment, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  child.stdin.end();
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += String(chunk); });
  const timer = setTimeout(() => { child.kill('SIGKILL'); }, 20000);
  child.on('exit', (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
});

/** An address of this machine that is not loopback, when it has one. */
const nonLoopback = (): string | undefined => {
  for (const list of Object.values(networkInterfaces())) {
    for (const one of list ?? []) {
      if (one.family === 'IPv4' && !one.internal) return one.address;
    }
  }
  return undefined;
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

/**
 * One request written by hand, as the answer it drew.
 *
 * A client library refuses to send a `Host` or a path this test is about, so
 * the bytes go over a socket and the status line comes back as text.
 */
const raw = (port: number, request: string): Promise<string> => rawAt('127.0.0.1', port, request);

/** The same, at an address the daemon may have bound rather than loopback. */
const rawAt = (host: string, port: number, request: string): Promise<string> => new Promise((done) => {
  const socket = connect(port, host, () => { socket.write(request); });
  let text = '';
  socket.on('data', (chunk: Buffer) => { text += String(chunk); });
  socket.on('end', () => { done(text); });
  socket.on('error', () => { done(text); });
  socket.setTimeout(5000, () => { socket.destroy(); done(text); });
});

/** The status a raw answer carries, or 0 when it never got one. */
const status = (text: string): number => Number(/^HTTP\/1\.1 (\d+)/u.exec(text)?.[1] ?? 0);

describe('a malformed request', () => {
  it('answers 400 with the API off, and the daemon keeps answering', async () => {
    const one = await daemon({ plugins: [BACKEND] });
    const said = await raw(one.port, 'GET /api/status HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n');
    expect(said.startsWith('HTTP/1.1 400')).toBe(true);
    const after = await get(`http://127.0.0.1:${String(one.port)}/api/status`);
    expect(after.status).toBe(404);
  }, 30000);

  it('answers 400 with the API on, and the daemon keeps answering', async () => {
    const one = await daemon({ http: true, plugins: [BACKEND] }, ['--connection-token', 'root-secret']);
    const said = await raw(one.port, 'GET /api/status HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n');
    expect(said.startsWith('HTTP/1.1 400')).toBe(true);
    const after = await get(`http://127.0.0.1:${String(one.port)}/api/cli-manifest`, 'root-secret');
    expect(after.status).toBe(200);
  }, 30000);

  it('answers 400 for a path that is not a valid percent-encoding', async () => {
    const one = await daemon({ http: true, plugins: [BACKEND] }, ['--connection-token', 'root-secret']);
    const said = await raw(one.port, 'POST /api/user/add/%E0%A4%A HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    expect(said.startsWith('HTTP/1.1 400')).toBe(true);
    const after = await get(`http://127.0.0.1:${String(one.port)}/api/cli-manifest`, 'root-secret');
    expect(after.status).toBe(200);
  }, 30000);
});

describe('a foreign request', () => {
  it('refuses an Origin that is not the daemon\'s', async () => {
    const one = await daemon({ http: true, plugins: [BACKEND] }, ['--connection-token', 'root-secret']);
    const said = await raw(one.port, `GET /api/status HTTP/1.1\r\nHost: 127.0.0.1:${String(one.port)}\r\nOrigin: https://evil.example\r\nAuthorization: Bearer root-secret\r\nConnection: close\r\n\r\n`);
    expect(status(said)).toBe(403);
  }, 30000);

  it('refuses a Host that is not the daemon\'s', async () => {
    const one = await daemon({ http: true, plugins: [BACKEND] }, ['--connection-token', 'root-secret']);
    const said = await raw(one.port, `GET /api/status HTTP/1.1\r\nHost: evil.example:${String(one.port)}\r\nAuthorization: Bearer root-secret\r\nConnection: close\r\n\r\n`);
    expect(status(said)).toBe(403);
  }, 30000);

  it('refuses a body that is not JSON', async () => {
    const one = await daemon({ http: true, plugins: [BACKEND] }, ['--connection-token', 'root-secret']);
    const response = await fetch(`http://127.0.0.1:${String(one.port)}/api/user/add/x`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Bearer root-secret' },
      body: 'id=x',
    });
    expect(response.status).toBe(415);
  }, 30000);

  it('refuses a request that names no Host', async () => {
    const one = await daemon({ http: true, plugins: [BACKEND] }, ['--connection-token', 'root-secret']);
    const said = await raw(one.port, 'GET /api/status HTTP/1.0\r\nAuthorization: Bearer root-secret\r\nConnection: close\r\n\r\n');
    expect(status(said)).toBe(403);
    const after = await get(`http://127.0.0.1:${String(one.port)}/api/cli-manifest`, 'root-secret');
    expect(after.status).toBe(200);
  }, 30000);

  it('answers a loopback name and the address', async () => {
    const one = await daemon({ http: true, plugins: [BACKEND] }, ['--connection-token', 'root-secret']);
    const named = await raw(one.port, `GET /api/cli-manifest HTTP/1.1\r\nHost: localhost:${String(one.port)}\r\nConnection: close\r\n\r\n`);
    expect(status(named)).toBe(200);
    const addressed = await get(`http://127.0.0.1:${String(one.port)}/api/cli-manifest`);
    expect(addressed.status).toBe(200);
  }, 30000);

  it('answers the host a resource names', async () => {
    const one = await daemon(
      { http: true, resource: 'https://ahpd.example.com/', plugins: [BACKEND] },
      ['--connection-token', 'root-secret'],
    );
    const said = await raw(one.port, 'GET /api/cli-manifest HTTP/1.1\r\nHost: ahpd.example.com\r\nConnection: close\r\n\r\n');
    expect(status(said)).toBe(200);
  }, 30000);
});

/** One daemon with a token and two people: ada may not write the configuration, root may. */
const guarded = async (): Promise<{ one: Daemon; member: string; admin: string; token: string }> => {
  const directory = fileUsers({ path: usersFile });
  await directory.add('ada', ['member']);
  await directory.add('root', ['admin']);
  const member = await directory.mint('ada');
  const admin = await directory.mint('root');
  // The people file is passed as a flag and is not named by the configuration,
  // so a served `user` verb has to take it from the daemon, not from the file.
  const one = await daemon({ http: true, plugins: [BACKEND] }, ['--connection-token', 'root-secret', '--users', usersFile]);
  return { one, member, admin, token: 'root-secret' };
};

describe('http in the configuration', () => {
  it('answers /api with 404 when it is off', async () => {
    const one = await daemon({ plugins: [BACKEND] });
    expect(one.apiPort).toBe(-1);
    const response = await get(`http://127.0.0.1:${String(one.port)}/api/status`);
    expect(response.status).toBe(404);
  });

  it('serves the manifest on the daemon port when http is true', async () => {
    const one = await daemon({ http: true, plugins: [BACKEND] }, ['--connection-token', 'root-secret']);
    expect(one.apiPort).toBe(one.port);
    const response = await get(`http://127.0.0.1:${String(one.port)}/api/cli-manifest`, 'root-secret');
    expect(response.status).toBe(200);
    const manifest = await response.json() as { program: { name: string }; commands: { id: string }[] };
    expect(manifest.program.name).toBe('ahpd');
    expect(manifest.commands.map((command) => command.id)).toContain('daemon.status');
  });

  it('moves the API to its own listener when http.port is set', async () => {
    const one = await daemon({ http: { port: 0 }, plugins: [BACKEND] }, ['--connection-token', 'root-secret']);
    expect(one.apiPort).toBeGreaterThan(0);
    expect(one.apiPort).not.toBe(one.port);
    // The API's listener answers, and the daemon's own port says there is none.
    expect((await get(`http://127.0.0.1:${String(one.apiPort)}/api/cli-manifest`, 'root-secret')).status).toBe(200);
    expect((await get(`http://127.0.0.1:${String(one.port)}/api/cli-manifest`, 'root-secret')).status).toBe(404);
  }, 30000);

  it('refuses http with no token and no users', async () => {
    writeFileSync(config, JSON.stringify({ http: true, plugins: [BACKEND] }));
    const said = await cli(['--config-file', config, '--port', '0']);
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('--connection-token');
    expect(said.stderr).toContain('--connection-token-file');
    expect(said.stderr).toContain('--users');
  }, 20000);

  it('refuses http with --without-connection-token', async () => {
    writeFileSync(config, JSON.stringify({ http: true, plugins: [BACKEND] }));
    const said = await cli(['--config-file', config, '--port', '0', '--without-connection-token']);
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('http needs a credential: pass --connection-token, --connection-token-file or --users.');
  }, 20000);

  it('starts with a users directory and no deployment token', async () => {
    const one = await daemon({ http: true, users: usersFile, plugins: [BACKEND] });
    expect(one.apiPort).toBe(one.port);
  }, 30000);
});

/** One AHP frame over a real socket: what came back, or a failure when none did. */
const frame = (port: number, token: string, text: string): Promise<string> => new Promise((done, fail) => {
  const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/?tkn=${token}`);
  const timer = setTimeout(() => { socket.terminate(); fail(new Error('no frame came back')); }, 5000);
  socket.on('open', () => { socket.send(text); });
  socket.on('message', (data: Buffer) => { clearTimeout(timer); socket.close(); done(String(data)); });
  socket.on('error', (error: Error) => { clearTimeout(timer); fail(error); });
});

/** Whether this machine has an IPv6 loopback to bind the API to. */
const hasIPv6Loopback = (): boolean =>
  Object.values(networkInterfaces()).some((list) => (list ?? []).some((one) => one.family === 'IPv6' && one.internal));

describe('http.host', () => {
  it('binds the API where it says, and the announcement names that host', async () => {
    const one = await daemon(
      { http: { port: 0, host: '127.0.0.1' }, plugins: [BACKEND] },
      ['--host', '0.0.0.0', '--connection-token', 't'],
    );
    expect(one.host).toBe('0.0.0.0');
    expect(one.apiHost).toBe('127.0.0.1');
    expect(one.apiPort).toBeGreaterThan(0);
    expect(one.apiPort).not.toBe(one.port);
    expect((await get(`http://127.0.0.1:${String(one.apiPort)}/api/cli-manifest`, 't')).status).toBe(200);
    // The announcement is built from the same variable as the bind, so the bind
    // is checked from outside: an address this host has is not one it answers on.
    const elsewhere = nonLoopback();
    if (elsewhere !== undefined) {
      await expect(get(`http://${elsewhere}:${String(one.apiPort)}/api/cli-manifest`, 't')).rejects.toThrow();
    }
  }, 30000);

  it.skipIf(!hasIPv6Loopback())('answers an IPv6 bind by its bracketed name', async () => {
    const one = await daemon({ http: { port: 0, host: '::1' }, plugins: [BACKEND] }, ['--connection-token', 'root-secret']);
    expect(one.apiPort).toBeGreaterThan(0);
    const said = await rawAt('::1', one.apiPort, `GET /api/cli-manifest HTTP/1.1\r\nHost: [::1]:${String(one.apiPort)}\r\nAuthorization: Bearer root-secret\r\nConnection: close\r\n\r\n`);
    expect(status(said)).toBe(200);
    // The `http on` line names a URL a parser reads back, and `--remote` takes
    // its origin as printed.
    expect(one.apiHost).toBe('[::1]');
    const origin = `http://${one.apiHost}:${String(one.apiPort)}`;
    const remote = await cli(['--remote', origin, '--token', 'root-secret', 'status']);
    expect(remote.code).toBe(0);
    expect(remote.stdout).toContain(String(one.child.pid));
  }, 40000);

  it('refuses http.host without an http.port', async () => {
    writeFileSync(config, JSON.stringify({ http: { host: '127.0.0.1' }, plugins: [BACKEND] }));
    const said = await cli(['--config-file', config, '--port', '0', '--connection-token', 't']);
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('http.host');
  }, 20000);

  it('refuses an http.host that is not a string', async () => {
    writeFileSync(config, JSON.stringify({ http: { port: 0, host: 5 }, plugins: [BACKEND] }));
    const said = await cli(['--config-file', config, '--port', '0', '--connection-token', 't']);
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('http.host');
  }, 20000);
});

describe('the names the API answers to', () => {
  it('brackets an IPv6 bind in its authorities and its origins', () => {
    const names = apiOrigins('2001:db8::5', undefined, 9187);
    expect(names.authorities).toContain('[2001:db8::5]:9187');
    expect(names.origins).toContain('http://[2001:db8::5]:9187');
  });

  it('answers to a resource by its host with the port it names', () => {
    const names = apiOrigins('127.0.0.1', 'https://ahpd.example.com:8443/', 9187);
    expect(names.authorities).toContain('ahpd.example.com:8443');
    expect(names.origins).toContain('https://ahpd.example.com:8443');
  });

  it('keeps an IPv4 bind as it was written', () => {
    const names = apiOrigins('192.0.2.7', undefined, 9187);
    expect(names.authorities).toContain('192.0.2.7:9187');
    expect(names.origins).toContain('http://192.0.2.7:9187');
  });
});

describe('the handlers, called with a Request', () => {
  /** The authority every request below names, as a client on loopback would. */
  const AUTHORITY = '127.0.0.1:9350';

  /** A request to the API at `path`, with the `Host` a client sends and the token when there is one. */
  const request = (path: string, token?: string): Request => new Request(`http://${AUTHORITY}${path}`, {
    headers: { host: AUTHORITY, ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
  });

  it('answers user list for the deployment token', async () => {
    writeFileSync(usersFile, JSON.stringify({ roles: {}, users: [] }));
    const users = fileUsers({ path: usersFile });
    await users.add('ada', ['member']);
    const facts: ServedFacts = {
      options: { users: usersFile } as Options,
      configFile: config,
      users,
      running: () => ({ pid: process.pid, url: `ws://${AUTHORITY}`, host: '127.0.0.1', port: 9350, paths: [], startedAt: '' }),
      turning: () => [],
      restart: () => {},
    };
    const handler = apiHandler({
      registry: servedRegistry(facts),
      token: 'root-secret',
      users,
      program: { name: 'ahpd', version: '0.0.0' },
      origins: () => apiOrigins('127.0.0.1', undefined, 9350),
    });
    const answered = await handler(request('/api/user/list', 'root-secret'));
    expect(answered.status).toBe(200);
    expect(await answered.text()).toContain('ada');
    expect((await handler(request('/api/user/list'))).status).toBe(401);
  });

  it('answers 404 under /api and 426 elsewhere with no API', async () => {
    const handler = withoutApi();
    const missing = await handler(request('/api/x'));
    expect(missing.status).toBe(404);
    expect((await missing.json() as { message: string }).message).toBe('No API at /api/x');
    const plain = await handler(request('/'));
    expect(plain.status).toBe(426);
    expect(await plain.text()).toBe('ahpd speaks the Agent Host Protocol over WebSocket');
  });
});

describe('a request signs in', () => {
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
    const url = `http://127.0.0.1:${String(one.port)}/api/config`;
    const refused = await get(url, member);
    expect(refused.status).toBe(403);
    expect((await refused.json() as { message: string }).message).toBe('ada may not config:write here');
  }, 30000);

  it('refuses a member the commands that need config:read', async () => {
    const { one, member } = await guarded();
    for (const path of ['status', 'plugin/list']) {
      const refused = await get(`http://127.0.0.1:${String(one.port)}/api/${path}`, member);
      expect(refused.status).toBe(403);
      expect((await refused.json() as { message: string }).message).toBe('ada may not config:read here');
    }
  }, 30000);

  it('serves a plugin install only to the deployment token', async () => {
    const { one, admin, token } = await guarded();
    const url = `http://127.0.0.1:${String(one.port)}/api/plugin/install`;
    const refused = await post(url, admin, { name: ['left-pad'] });
    expect(refused.status).toBe(403);
    expect((await refused.json() as { message: string }).message).toContain('only the deployment token may');
    // The deployment token is not refused: a name that is not a package is the
    // command's own refusal, so nothing reached npm.
    const asRoot = await post(url, token, { name: ['./not-a-package'] });
    expect(asRoot.status).toBe(400);
  }, 30000);

  it('serves a plugin update only to the deployment token, and answers what moved', async () => {
    writeFileSync(join(home, 'ahpd', 'package.json'), JSON.stringify({ dependencies: { 'left-pad': '^1.0.0' } }));
    mkdirSync(join(home, 'ahpd', 'node_modules', 'left-pad'), { recursive: true });
    writeFileSync(join(home, 'ahpd', 'node_modules', 'left-pad', 'package.json'), JSON.stringify({ name: 'left-pad', version: '1.0.0' }));
    const log = join(home, 'npm.log');
    const directory = fileUsers({ path: usersFile });
    await directory.add('root', ['admin']);
    const admin = await directory.mint('root');
    const one = await daemon(
      { http: true, plugins: [BACKEND] },
      ['--connection-token', 'root-secret', '--users', usersFile],
      fakeNpm({ FAKE_NPM_LOG: log, FAKE_NPM_LANDS: 'left-pad 1.3.0' }),
    );
    const url = `http://127.0.0.1:${String(one.port)}/api/plugin/update`;
    const refused = await post(url, admin, { name: ['all'] });
    expect(refused.status).toBe(403);
    expect((await refused.json() as { message: string }).message).toContain('only the deployment token may');

    const neither = await post(url, 'root-secret', {});
    expect(neither.status).toBe(400);
    const mixed = await post(url, 'root-secret', { name: ['all', 'left-pad'] });
    expect(mixed.status).toBe(400);
    expect((await mixed.json() as { message: string }).message).toContain('ahpd plugin update all');

    const moved = await post(url, 'root-secret', { name: ['left-pad'] });
    expect(moved.status).toBe(200);
    expect(await moved.json()).toEqual({ plugins: [{ name: 'left-pad', from: '1.0.0', to: '1.3.0' }], restart: true });
    expect(readFileSync(log, 'utf8')).toContain(`start install --prefix ${join(home, 'ahpd')} --legacy-peer-deps @ahpd/sdk@${version()} left-pad@latest`);

    // The same update again moves nothing: an empty list, and no restart.
    const unmoved = await post(url, 'root-secret', { name: ['all'] });
    expect(unmoved.status).toBe(200);
    expect(await unmoved.json()).toEqual({ plugins: [] });
  }, 30000);

  it('answers user list for a role that holds users:write', async () => {
    writeFileSync(usersFile, JSON.stringify({ roles: { keeper: ['users:write'] }, users: [] }));
    const directory = fileUsers({ path: usersFile });
    await directory.add('keeper', ['keeper']);
    const keeper = await directory.mint('keeper');
    const one = await daemon(
      { http: true, plugins: [BACKEND] },
      ['--connection-token', 'root-secret', '--users', usersFile],
    );
    const answered = await get(`http://127.0.0.1:${String(one.port)}/api/user/list`, keeper);
    expect(answered.status).toBe(200);
    expect(await answered.text()).toContain('keeper');
  }, 30000);

  it('refuses a caller the roles and people it does not hold', async () => {
    writeFileSync(usersFile, JSON.stringify({ roles: { people: ['users:write'] }, users: [] }));
    const directory = fileUsers({ path: usersFile });
    await directory.add('pat', ['people']);
    await directory.add('ada', ['admin']);
    const pat = await directory.mint('pat');
    const ada = await directory.mint('ada');
    const one = await daemon(
      { http: true, plugins: [BACKEND] },
      ['--connection-token', 'root-secret', '--users', usersFile],
    );
    const base = `http://127.0.0.1:${String(one.port)}/api`;

    const above = await post(`${base}/user/add/eve`, pat, { role: ['admin'] });
    expect(above.status).toBe(403);
    expect((await above.json() as { message: string }).message).toBe('pat may not *:* here');
    expect(readFileSync(usersFile, 'utf8')).not.toContain('eve');

    expect((await post(`${base}/user/add/eve`, pat, { role: ['people'] })).status).toBe(200);

    expect((await post(`${base}/user/token/ada`, pat, {})).status).toBe(403);
    expect((await get(`${base}/status`, ada)).status).toBe(200);

    expect((await post(`${base}/user/rm/ada`, pat, {})).status).toBe(403);
    expect(readFileSync(usersFile, 'utf8')).toContain('ada');

    // Re-adding a person replaces their roles, so it is bounded by the roles
    // they hold as well as by the ones being given.
    const demoted = await post(`${base}/user/add/ada`, pat, { role: ['people'] });
    expect(demoted.status).toBe(403);
    expect((await demoted.json() as { message: string }).message).toBe('pat may not *:* here');
    expect(await directory.grantsOfPerson('ada')).toEqual(['*:*']);

    // The deployment token holds every grant, so the same three answer it.
    expect((await post(`${base}/user/add/mallory`, 'root-secret', { role: ['admin'] })).status).toBe(200);
    expect((await post(`${base}/user/token/ada`, 'root-secret', {})).status).toBe(200);
    expect((await post(`${base}/user/rm/ada`, 'root-secret', {})).status).toBe(200);
  }, 30000);

  it('answers while a served install is holding npm', async () => {
    const one = await daemon({ http: true, plugins: [BACKEND] }, ['--connection-token', 'root-secret'], fakeNpm({ FAKE_NPM_SLEEP: '2' }));
    const installing = post(`http://127.0.0.1:${String(one.port)}/api/plugin/install`, 'root-secret', { name: ['left-pad'] });
    // Inside npm by now: the fake waits two seconds before it says anything.
    await new Promise((wait) => setTimeout(wait, 400));

    const began = Date.now();
    const answered = await frame(one.port, 'root-secret', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    expect(Date.now() - began).toBeLessThan(1000);
    expect(answered).toContain('"id":1');

    expect((await installing).status).toBe(200);
  }, 30000);

  it('runs two served installs one after the other, and names both', async () => {
    const log = join(home, 'npm.log');
    const one = await daemon(
      { http: true, plugins: [BACKEND] },
      ['--connection-token', 'root-secret'],
      fakeNpm({ FAKE_NPM_SLEEP: '1', FAKE_NPM_LOG: log }),
    );
    const url = `http://127.0.0.1:${String(one.port)}/api/plugin/install`;
    const answers = await Promise.all([
      post(url, 'root-secret', { name: ['left-pad'] }),
      post(url, 'root-secret', { name: ['is-odd'] }),
    ]);
    expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
    const plugins = (JSON.parse(readFileSync(config, 'utf8')) as { plugins: unknown[] }).plugins;
    expect(plugins).toContain('left-pad');
    expect(plugins).toContain('is-odd');
    // Each npm ends before the next one starts.
    const steps = readFileSync(log, 'utf8').trim().split('\n').map((line) => line.split(' ')[0]);
    expect(steps).toEqual(['start', 'end', 'start', 'end']);
  }, 30000);

  it('keeps npm\'s reason in a served install that fails', async () => {
    const one = await daemon(
      { http: true, plugins: [BACKEND] },
      ['--connection-token', 'root-secret'],
      fakeNpm({ FAKE_NPM_EXIT: '1', FAKE_NPM_STDERR: 'npm error code E404' }),
    );
    const answered = await post(`http://127.0.0.1:${String(one.port)}/api/plugin/install`, 'root-secret', { name: ['left-pad'] });
    expect(answered.status).toBe(400);
    expect((await answered.json() as { message: string }).message).toContain('npm error code E404');
  }, 30000);

  it('tells a served install to restart the daemon that answered', async () => {
    const one = await daemon({ http: true, plugins: [BACKEND] }, ['--connection-token', 'root-secret'], fakeNpm());
    const answered = await post(`http://127.0.0.1:${String(one.port)}/api/plugin/install`, 'root-secret', { name: ['left-pad'] });
    expect(answered.status).toBe(200);
    expect((await answered.json() as { restart?: boolean }).restart).toBe(true);
  }, 30000);

  it('hides the connection token from a served config', async () => {
    const directory = fileUsers({ path: usersFile });
    await directory.add('root', ['admin']);
    const admin = await directory.mint('root');
    const one = await daemon(
      { http: true, plugins: [BACKEND], connectionToken: 'the-config-secret' },
      ['--connection-token', 'root-secret', '--users', usersFile],
    );
    const answered = await get(`http://127.0.0.1:${String(one.port)}/api/config`, admin);
    expect(answered.status).toBe(200);
    const body = await answered.text();
    expect(body).not.toContain('the-config-secret');
    expect((JSON.parse(body) as { config: Record<string, unknown> }).config['connectionToken']).toBe('<set>');
  }, 30000);

  it('answers a person who holds the grant', async () => {
    const { one, admin } = await guarded();
    const base = `http://127.0.0.1:${String(one.port)}/api/config`;
    expect((await get(base)).status).toBe(401);
    expect((await get(base, admin)).status).toBe(200);
  }, 30000);

  it('answers the running daemon for status, with its own pid', async () => {
    const one = await daemon({ http: true, plugins: [BACKEND] }, ['--connection-token', 'root-secret']);
    const response = await get(`http://127.0.0.1:${String(one.port)}/api/status`, 'root-secret');
    expect(response.status).toBe(200);
    expect((await response.json() as { pid: number }).pid).toBe(one.child.pid);
  }, 30000);

  it('answers a missing person with the sentence, and the daemon keeps running', async () => {
    const { one, token } = await guarded();
    const refused = await post(`http://127.0.0.1:${String(one.port)}/api/user/rm/nobody`, token, {});
    expect(refused.status).toBe(409);
    expect((await refused.json() as { message: string }).message).toBe('No user called nobody.');
    const answered = await get(`http://127.0.0.1:${String(one.port)}/api/status`, token);
    expect(answered.status).toBe(200);
  }, 30000);
});

describe('what a served command reads', () => {
  it('answers the daemon\'s own configuration file', async () => {
    const one = await daemon({ http: true, plugins: [BACKEND] }, ['--connection-token', 'root-secret']);
    const answered = await get(`http://127.0.0.1:${String(one.port)}/api/config`, 'root-secret');
    expect(answered.status).toBe(200);
    expect((await answered.json() as { path: string }).path).toBe(config);
  }, 30000);

  it('answers the daemon\'s own path when its file is gone, and no other file', async () => {
    writeFileSync(join(home, 'ahpd', 'config.json'), JSON.stringify({ port: 1234 }));
    const one = await daemon({ http: true, plugins: [BACKEND] }, ['--connection-token', 'root-secret']);
    rmSync(config);
    const answered = await get(`http://127.0.0.1:${String(one.port)}/api/config`, 'root-secret');
    expect(answered.status).toBe(200);
    const body = await answered.json() as { path: string; config: Record<string, unknown> };
    expect(body.path).toBe(config);
    expect(body.config['port']).toBeUndefined();
  }, 30000);

  it('masks every plugin option value', async () => {
    const one = await daemon(
      { http: true, plugins: [{ name: BACKEND, options: { apiKey: 'k1', region: 'eu' } }] },
      ['--connection-token', 'root-secret'],
    );
    const answered = await get(`http://127.0.0.1:${String(one.port)}/api/config`, 'root-secret');
    expect(answered.status).toBe(200);
    const body = await answered.text();
    expect(body).not.toContain('k1');
    expect(body).not.toContain('eu');
    const parsed = JSON.parse(body) as { config: { plugins: { options: Record<string, unknown> }[] } };
    expect(parsed.config.plugins[0]?.options).toEqual({ apiKey: '<set>', region: '<set>' });
  }, 30000);

  it('masks every plugin option value in a served plugin list', async () => {
    writeFileSync(usersFile, JSON.stringify({ roles: { reader: ['config:read'] }, users: [] }));
    const directory = fileUsers({ path: usersFile });
    await directory.add('rea', ['reader']);
    const reader = await directory.mint('rea');
    const one = await daemon(
      { http: true, plugins: [{ name: BACKEND, options: { apiKey: 'SECRETKEY1' } }] },
      ['--connection-token', 'root-secret', '--users', usersFile],
    );
    const answered = await get(`http://127.0.0.1:${String(one.port)}/api/plugin/list`, reader);
    expect(answered.status).toBe(200);
    const body = await answered.text();
    expect(body).not.toContain('SECRETKEY1');
    const rows = JSON.parse(body) as { spec: { options: Record<string, unknown> } }[];
    expect(rows[0]?.spec.options).toEqual({ apiKey: '<set>' });
  }, 30000);

  it('masks the credentials in a plugin spec URL, in the file and in a served row', async () => {
    writeFileSync(usersFile, JSON.stringify({
      roles: { writer: ['config:write'], reader: ['config:read'] },
      users: [],
    }));
    const directory = fileUsers({ path: usersFile });
    await directory.add('wri', ['writer']);
    const writer = await directory.mint('wri');
    await directory.add('rea', ['reader']);
    const reader = await directory.mint('rea');
    const one = await daemon(
      {
        http: true,
        plugins: [
          'git+https://someone:PAT12345@example.com/x.git',
          { name: 'git+https://someone:PAT12345@example.com/y.git' },
          BACKEND,
        ],
      },
      ['--connection-token', 'root-secret', '--users', usersFile],
    );

    for (const [path, token] of [['config', writer], ['plugin/list', reader]] as const) {
      const answered = await get(`http://127.0.0.1:${String(one.port)}/api/${path}`, token);
      expect(answered.status).toBe(200);
      const body = await answered.text();
      expect(body).not.toContain('PAT12345');
      expect(body).not.toContain('someone');
    }

    const config = JSON.parse(await (await get(`http://127.0.0.1:${String(one.port)}/api/config`, writer)).text()) as {
      config: { plugins: (string | { name: string })[] };
    };
    expect(config.config.plugins[0]).toBe('git+https://<set>@example.com/x.git');
    expect((config.config.plugins[1] as { name: string }).name).toBe('git+https://<set>@example.com/y.git');
    // A spec with no credentials is answered as the file holds it.
    expect(config.config.plugins[2]).toBe(BACKEND);
  }, 30000);

  it('ignores the query on plugin list, and the daemon keeps running', async () => {
    const one = await daemon({ http: true, plugins: [BACKEND] }, ['--connection-token', 'root-secret']);
    const query = `http://127.0.0.1:${String(one.port)}/api/plugin/list?noPlugins=true&plugins=x&plugins=y`;
    const answered = await get(query, 'root-secret');
    expect(answered.status).toBe(200);
    const body = await answered.text();
    expect(body).toContain('plugin-echo');
    expect(body).not.toContain('"x"');
    expect(body).not.toContain('"y"');
    const after = await get(`http://127.0.0.1:${String(one.port)}/api/cli-manifest`, 'root-secret');
    expect(after.status).toBe(200);
  }, 30000);

  it('does not read a configuration file the request names', async () => {
    const secret = join(home, 'secret.json');
    writeFileSync(secret, JSON.stringify({ plugins: ['TOPSECRET'] }));
    const one = await daemon({ http: true, plugins: [BACKEND] }, ['--connection-token', 'root-secret']);
    const answered = await get(
      `http://127.0.0.1:${String(one.port)}/api/plugin/list?configFile=${encodeURIComponent(secret)}`,
      'root-secret',
    );
    expect(answered.status).toBe(200);
    expect(await answered.text()).not.toContain('TOPSECRET');
  }, 30000);

  it('writes a person to the daemon\'s own users file, not the one the body names', async () => {
    const { one, token } = await guarded();
    const elsewhere = join(home, 'elsewhere.json');
    const answered = await post(`http://127.0.0.1:${String(one.port)}/api/user/add/mallory`, token, { users: elsewhere });
    expect(answered.status).toBe(200);
    expect(existsSync(elsewhere)).toBe(false);
    expect(readFileSync(usersFile, 'utf8')).toContain('mallory');
  }, 30000);

  it('lists the people in the daemon\'s own users file', async () => {
    const { one, token } = await guarded();
    const answered = await get(`http://127.0.0.1:${String(one.port)}/api/user/list`, token);
    expect(answered.status).toBe(200);
    expect(await answered.text()).toContain('ada');
  }, 30000);

  it('answers a daemon with no users file with a sentence, and keeps running', async () => {
    const one = await daemon({ http: true, plugins: [BACKEND] }, ['--connection-token', 'root-secret']);
    const answered = await get(`http://127.0.0.1:${String(one.port)}/api/user/list`, 'root-secret');
    expect(answered.status).toBeGreaterThanOrEqual(400);
    expect((await answered.json() as { message: string }).message).toContain('users file');
    const after = await get(`http://127.0.0.1:${String(one.port)}/api/cli-manifest`, 'root-secret');
    expect(after.status).toBe(200);
  }, 30000);

  it('publishes no path field on any command', async () => {
    const one = await daemon({ http: true, plugins: [BACKEND] }, ['--connection-token', 'root-secret']);
    const answered = await get(`http://127.0.0.1:${String(one.port)}/api/cli-manifest`, 'root-secret');
    const manifest = await answered.json() as { commands: { options: { name: string }[] }[] };
    const names = manifest.commands.flatMap((command) => command.options.map((option) => option.name));
    expect(names).not.toContain('--config-file');
    expect(names).not.toContain('--users');
    expect(names).not.toContain('--plugin');
    expect(names).not.toContain('--path');
  }, 30000);
});

describe('--remote', () => {
  /** One daemon on loopback with a token, and the URL it answers on. */
  const remote = async (): Promise<{ one: Daemon; url: string }> => {
    const one = await daemon({ http: true, plugins: [BACKEND] }, ['--connection-token', 'root-secret']);
    return { one, url: `http://127.0.0.1:${String(one.port)}` };
  };

  it('answers from the daemon, not from this machine', async () => {
    const { one, url } = await remote();
    // The served declarations take no field: the daemon's own options are what
    // they read, so a flag like `--no-update-check` has nothing to say here.
    const status = await cli(['--remote', url, '--token', 'root-secret', 'status']);
    expect(status.code).toBe(0);
    // The pid is the daemon's own, which a local `status` could not know.
    expect(status.stdout).toContain(String(one.child.pid));
    // Loopback, so the token crosses nothing and nothing is warned.
    expect(status.stderr).not.toContain('cleartext');

    const plugins = await cli(['--remote', url, '--token', 'root-secret', 'plugin', 'list']);
    expect(plugins.code).toBe(0);
    expect(plugins.stdout).toContain('plugin-echo');
  }, 40000);

  it('refuses a remote call with no token, before anything is fetched', async () => {
    const { url } = await remote();
    const said = await cli(['--remote', url, 'status']);
    expect(said.code).toBe(2);
    expect(said.stderr).toContain('--token');
    expect(said.stderr).toContain('--token-file');
    expect(said.stderr).toContain('AHPD_TOKEN');
    // Nothing was fetched, so the manifest cache was never made.
    expect(existsSync(join(cache, 'ahpd', 'remote'))).toBe(false);
  }, 30000);

  it('reads the token from AHPD_TOKEN too', async () => {
    const { one, url } = await remote();
    const said = await cli(['--remote', url, 'status'], { AHPD_TOKEN: 'root-secret' });
    expect(said.code).toBe(0);
    expect(said.stdout).toContain(String(one.child.pid));
  }, 40000);

  it('reads the token from a file, and refuses what cannot be one token', async () => {
    const { one, url } = await remote();
    const at = join(home, 'token');
    writeFileSync(at, 'root-secret\n');
    const said = await cli(['--remote', url, '--token-file', at, 'status']);
    expect(said.code).toBe(0);
    expect(said.stdout).toContain(String(one.child.pid));

    const both = await cli(['--remote', url, '--token', 'root-secret', '--token-file', at, 'status']);
    expect(both.code).toBe(2);
    const gone = await cli(['--remote', url, '--token-file', join(home, 'none'), 'status']);
    expect(gone.code).toBe(2);
    const empty = join(home, 'empty-token');
    writeFileSync(empty, '\n');
    const blank = await cli(['--remote', url, '--token-file', empty, 'status']);
    expect(blank.code).toBe(2);
  }, 40000);

  it('keeps its manifest cache private to this user', async () => {
    const { url } = await remote();
    // The run's own temporary directory, so a shared path this machine already
    // has from another day is not what the case is about.
    const shared = join(home, 'tmp');
    mkdirSync(shared, { recursive: true });
    const said = await cli(['--remote', url, '--token', 'root-secret', 'status'], { TMPDIR: shared });
    expect(said.code).toBe(0);
    const at = join(cache, 'ahpd', 'remote');
    expect(existsSync(at)).toBe(true);
    expect(statSync(at).mode & 0o777).toBe(0o700);
    // Per user under the cache directory, so nothing lands in a shared path.
    expect(existsSync(join(shared, 'ahpd-remote'))).toBe(false);
  }, 30000);

  it('tightens a cache directory that was already there', async () => {
    const { url } = await remote();
    const at = join(cache, 'ahpd', 'remote');
    mkdirSync(at, { recursive: true });
    chmodSync(at, 0o755);
    const said = await cli(['--remote', url, '--token', 'root-secret', 'status']);
    expect(said.code).toBe(0);
    expect(statSync(at).mode & 0o777).toBe(0o700);
  }, 30000);

  it('warns when the token travels in cleartext, and still answers', async () => {
    const address = nonLoopback();
    if (address === undefined) return;
    // A wildcard bind answers on every address, but `resource` is what makes
    // the address one of the daemon's own names for the Origin and Host check.
    const one = await daemon(
      { http: true, resource: `https://${address}/`, plugins: [BACKEND] },
      ['--host', '0.0.0.0', '--connection-token', 'root-secret'],
    );
    const said = await cli(['--remote', `http://${address}:${String(one.port)}`, '--token', 'root-secret', 'status']);
    expect(said.stderr).toContain('cleartext');
    expect(said.code).toBe(0);
    expect(said.stdout).toContain(String(one.child.pid));
  }, 40000);
});
