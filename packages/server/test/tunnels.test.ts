/*
 * The tunnels a daemon keeps, over a real process and a fake kind.
 *
 * The kind is a fixture plugin: it reports a made-up `.example` URL and writes
 * every call to a file, so a case reads the host's list and the order the
 * calls arrived in. Nothing here opens a socket, signs in or reaches a real
 * Dev Tunnel.
 *
 * The daemon is a real process because what is checked is the wiring: the
 * system tunnel is added after `listening`, the routes' `Host` check reads the
 * list's URLs, and the API reads them only when `tunnelHosts` says so.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { INITIALIZE, MAIN, REPO, config, daemonEnv, home, put, rpc, spawned } from './cli.js';

/** The plugin that offers the one kind every case here uses. */
const FIXTURE = join(import.meta.dirname, 'fixtures', 'plugin-tunnel');
/** Where that plugin's route is served, under its own name. */
const ROUTE = '/plugins/tunnel-fixture/hook';
/** The list every case reads. */
const URI = 'x-ahpd-tunnels://';
/** The token the API cases pass, so a case is one thing at a time. */
const TOKEN = 'root-secret';

type Bag = Record<string, any>;

/** A tunnel record a case writes before the daemon starts. */
const seed = (id: string, record: Bag): void => {
  const folder = join(home, 'ahpd', 'tunnels');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${id}.json`), JSON.stringify({ id, ...record }));
};

/** What the fixture wrote about its calls, in order. */
const calls = (): string[] => {
  try { return readFileSync(join(home, 'tunnel-calls.log'), 'utf8').split('\n').filter((one) => one !== ''); }
  catch { return []; }
};

interface Daemon {
  child: ChildProcess;
  /** The port the daemon answers on. */
  port: number;
  /** Its WebSocket origin, without a token. */
  url: string;
  stdout(): string;
  stderr(): string;
}

/**
 * The daemon as a process, started over one configuration.
 *
 * Resolved on the announcement, which is written after `listening` and after
 * the tunnels the start added, so a case that reads the list here reads what
 * the start left.
 */
const daemon = (value: unknown): Promise<Daemon> => new Promise((resolve, reject) => {
  put(value);
  const child = spawn(
    process.execPath,
    [MAIN, '--config-file', config, '--port', '0', '--no-update-check'],
    {
      cwd: REPO,
      env: daemonEnv({ AHPD_TUNNEL_LOG: join(home, 'tunnel-calls.log') }),
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  child.stdin.end();
  if (child.pid !== undefined) spawned.push(child.pid);
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
    const found = /ahpd on (ws:\/\/\S+)/u.exec(stdout);
    if (found === null || settled) return;
    settled = true;
    clearTimeout(timer);
    const url = found[1] as string;
    resolve({ child, port: Number(new URL(url).port), url, stdout: () => stdout, stderr: () => stderr });
  });
  child.once('exit', (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    reject(new Error(`the daemon exited with ${String(code)}:\n${stdout}\n${stderr}`));
  });
});

/** The list as one client reads it, with the token the case passed. */
const stateOf = async (one: Daemon, token?: string): Promise<Bag> => {
  const at = token === undefined ? `${one.url}/` : `${one.url}/?tkn=${token}`;
  const [, answer] = await rpc(at, [INITIALIZE, { method: 'subscribe', params: { channel: URI } }]) as [unknown, { snapshot: { state: Bag } }];
  return answer.snapshot.state;
};

/** The records a list holds: each entry is the id and the row under it. */
const rows = (state: Bag): Bag[] => (state['records'] as Bag[]).map((entry) => entry['record'] as Bag);

/** One request written by hand, as the answer it drew. */
const raw = (port: number, head: string): Promise<string> => new Promise((resolve) => {
  const socket = connect(port, '127.0.0.1', () => {
    // HTTP/1.0, so the answer has a length and no chunking around the body.
    socket.write(`GET ${ROUTE} HTTP/1.0\r\n${head}Connection: close\r\n\r\n`);
  });
  let text = '';
  socket.on('data', (chunk: Buffer) => { text += String(chunk); });
  socket.on('end', () => { resolve(text); });
  socket.on('error', () => { resolve(text); });
  socket.setTimeout(5000, () => { socket.destroy(); resolve(text); });
});

/** One request to an API path, with its own `Host` and the token. */
const api = (port: number, path: string, host: string): Promise<string> => new Promise((resolve) => {
  const socket = connect(port, '127.0.0.1', () => {
    socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nAuthorization: Bearer ${TOKEN}\r\nConnection: close\r\n\r\n`);
  });
  let text = '';
  socket.on('data', (chunk: Buffer) => { text += String(chunk); });
  socket.on('end', () => { resolve(text); });
  socket.on('error', () => { resolve(text); });
  socket.setTimeout(5000, () => { socket.destroy(); resolve(text); });
});

/** The status a written request was answered with. */
const status = (text: string): number => Number(/^HTTP\/1\.1 (\d+)/u.exec(text)?.[1] ?? 0);

/** Wait for a process to leave, or kill it once the wait is over. */
const gone = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, 10000);
    child.once('exit', () => { clearTimeout(timer); done(); });
  });
};

/** The system tunnel a start added, which every case reads its URL from. */
const systemOf = (state: Bag): Bag => {
  const found = rows(state).find((row) => row['purpose'] === 'system');
  if (found === undefined) throw new Error(`no system tunnel in ${JSON.stringify(state)}`);
  return found;
};

it('adds the kind\'s system tunnel after listening, and starts only the enabled records', async () => {
  seed('kept', { kind: 'fixture', plugin: 'tunnel-fixture', purpose: 'person', enabled: true, port: 8081 });
  seed('off', { kind: 'fixture', plugin: 'tunnel-fixture', purpose: 'person', enabled: false, port: 8082 });
  const one = await daemon({ plugins: [FIXTURE], sessions: 'memory', automations: 'memory' });

  const state = await stateOf(one);
  const system = systemOf(state);
  expect(system).toMatchObject({ kind: 'fixture', plugin: 'tunnel-fixture', purpose: 'system', enabled: true, status: 'running' });
  expect(String(system['url'])).toBe(`https://${String(system['id'])}.example/`);
  // The host set the port the kind forwards to, which is the one it bound.
  expect(system['port']).toBe(one.port);

  expect(rows(state).find((row) => row['id'] === 'kept')).toMatchObject({
    purpose: 'person', enabled: true, status: 'running', url: 'https://kept.example/',
  });
  expect(rows(state).find((row) => row['id'] === 'off')).toMatchObject({ enabled: false, status: 'stopped' });

  // The system tunnel was made, the enabled record started, and the off one not.
  expect(calls().filter((call) => call === 'start kept')).toHaveLength(1);
  expect(calls()).not.toContain('start off');
  expect(calls().some((call) => call.startsWith('start fixture-'))).toBe(true);
});

it('answers a route to a tunnel\'s URL, which was never configured', async () => {
  const one = await daemon({ plugins: [FIXTURE], sessions: 'memory', automations: 'memory' });
  const system = systemOf(await stateOf(one));
  const host = new URL(String(system['url'])).hostname;

  const answer = await raw(one.port, `Host: ${host}\r\n`);
  expect(status(answer)).toBe(200);
  const body = JSON.parse(answer.slice(answer.indexOf('\r\n\r\n') + 4)) as Bag;
  expect(body['host']).toBe(host);
});

it('refuses the API a tunnel\'s URL with tunnelHosts off', async () => {
  const one = await daemon({ plugins: [FIXTURE], httpApi: true, connectionToken: TOKEN, sessions: 'memory', automations: 'memory' });
  const system = systemOf(await stateOf(one, TOKEN));
  const host = new URL(String(system['url'])).hostname;

  expect(status(await api(one.port, '/api/cli-manifest', host))).toBe(403);
});

it('answers the API a tunnel\'s URL with tunnelHosts on', async () => {
  const one = await daemon({ plugins: [FIXTURE], httpApi: true, tunnelHosts: true, connectionToken: TOKEN, sessions: 'memory', automations: 'memory' });
  const system = systemOf(await stateOf(one, TOKEN));
  const host = new URL(String(system['url'])).hostname;

  expect(status(await api(one.port, '/api/cli-manifest', host))).toBe(200);
});

it('stops every running tunnel before the plugins hear stopping', async () => {
  const one = await daemon({ plugins: [FIXTURE], sessions: 'memory', automations: 'memory' });
  const system = systemOf(await stateOf(one));

  one.child.kill('SIGTERM');
  await gone(one.child);

  const log = calls();
  const stopping = log.indexOf('stopping');
  const stops = log.flatMap((call, at) => (call.startsWith('stop ') ? [at] : []));
  expect(stopping).toBeGreaterThan(-1);
  expect(stops.length).toBeGreaterThan(0);
  expect(stops).toContain(log.indexOf(`stop ${String(system['id'])}`));
  expect(Math.max(...stops)).toBeLessThan(stopping);
}, 30000);
