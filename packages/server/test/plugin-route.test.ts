/*
 * A plugin's own route, on the daemon's own listener.
 *
 * The daemon is a real process, because half of what is being checked is the
 * wiring rather than a function: a plugin registers a route, the fold holds it,
 * the listener is already built by the time the plugins load, and the path
 * reaches the handler on the port the daemon announced. The configuration
 * directory is temporary, so a case writes the file the daemon reads without
 * touching the machine it runs on.
 *
 * The requests written by hand are the ones a client library will not make: a
 * `Host` this daemon was never configured with, and an `Origin` a browser
 * would send cross-site, both of which are headers a library owns.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { announcedNames } from '../src/commands/run.js';

const REPO = join(import.meta.dirname, '../../..');
const MAIN = 'packages/server/src/main.ts';
/** A plugin that contributes a backend, which is what lets a run get to its announcement. */
const BACKEND = join(import.meta.dirname, 'fixtures', 'plugin-echo');
/** The plugin under test: one route, and a host announced of its own. */
const ROUTE = join(import.meta.dirname, 'fixtures', 'plugin-route');
/** What the fixture's prefix is, with the scope encoded as the listener serves it. */
const PREFIX = '/plugins/%40ahpd/plugin-route';
/** The host the fixture's announcement names, which the daemon learns from that line. */
const TUNNEL_HOST = 'fixture-tunnel.example.com';

interface Daemon {
  child: ChildProcess;
  port: number;
  stderr(): string;
}

let home: string;
const started: Daemon[] = [];

/**
 * The daemon as a process, started with one configuration.
 *
 * Resolved once the announcement names the WebSocket origin, which is the first
 * moment there is anything to ask. Resolved on that line rather than on the
 * plugins line, because a route is served whatever `http` says.
 */
const daemon = (value: unknown, args: string[] = []): Promise<Daemon> => new Promise((resolve, reject) => {
  const config = join(home, 'config.json');
  writeFileSync(config, JSON.stringify(value));
  const child = spawn(
    process.execPath,
    ['--conditions', 'development', '--import', './scripts/dev.mjs', MAIN, '--config-file', config, '--port', '0', '--no-update-check', ...args],
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
    const ws = /ahpd on ws:\/\/([^\s,]+):(\d+)/u.exec(stdout);
    if (ws === null || settled) return;
    settled = true;
    clearTimeout(timer);
    const one: Daemon = { child, port: Number(ws[2]), stderr: () => stderr };
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

/** One route request, as a client on loopback sends it: the `Host` a browser would. */
const hook = (port: number, path: string, body = ''): Promise<Response> =>
  fetch(`http://127.0.0.1:${String(port)}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

/** What the fixture's handler answers with: the request as it saw it. */
interface Seen {
  path: string;
  method: string;
  host: string | null;
  origin: string | null;
  contentType: string | null;
  body: string;
}

const seen = async (answer: Response): Promise<Seen> => JSON.parse(await answer.text()) as Seen;

/** One request written by hand, as the answer it drew. */
const raw = (port: number, head: string): Promise<string> => new Promise((resolve) => {
  const socket = connect(port, '127.0.0.1', () => {
    socket.write(`GET ${PREFIX}/hook HTTP/1.0\r\n${head}Connection: close\r\n\r\n`);
  });
  let text = '';
  socket.on('data', (chunk: Buffer) => { text += String(chunk); });
  socket.on('end', () => { resolve(text); });
  socket.on('error', () => { resolve(text); });
  socket.setTimeout(5000, () => { socket.destroy(); resolve(text); });
});

const status = (text: string): number => Number(/^HTTP\/1\.1 (\d+)/u.exec(text)?.[1] ?? 0);

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-route-'));
  mkdirSync(join(home, 'ahpd'), { recursive: true });
});

afterAll(async () => {
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

describe('a route with http off', () => {
  let one: Daemon;

  beforeAll(async () => { one = await daemon({ plugins: [BACKEND, ROUTE] }); }, 40000);

  it('answers a form body with no Origin, which the API would refuse', async () => {
    const answer = await hook(one.port, `${PREFIX}/hook`, 'id=x&name=y');
    expect(answer.status).toBe(200);
    const said = await seen(answer);
    // The path reaches the handler whole, prefix and all.
    expect(said.path).toBe(`${PREFIX}/hook`);
    expect(said.method).toBe('POST');
    expect(said.origin).toBeNull();
    expect(said.contentType).toBe('application/x-www-form-urlencoded');
    expect(said.body).toBe('id=x&name=y');
  });

  it('answers its own prefix with and without the trailing slash', async () => {
    expect((await hook(one.port, PREFIX, 'a=1')).status).toBe(200);
    expect((await hook(one.port, `${PREFIX}/`, 'a=1')).status).toBe(200);
  });

  it('refuses a Host that is not one of the daemon\'s', async () => {
    expect(status(await raw(one.port, `Host: evil.example:${String(one.port)}\r\n`))).toBe(403);
  });

  it('refuses a request that names no Host at all', async () => {
    expect(status(await raw(one.port, ''))).toBe(403);
  });

  it('answers a host a plugin announced, which was never configured', async () => {
    // The fixture says the tunnel's address in its announcement line; the
    // daemon reads the host out of it, so a webhook arriving there is served.
    expect(status(await raw(one.port, `Host: ${TUNNEL_HOST}\r\n`))).toBe(200);
    // What the announcement named is what answers, so the URL named no port
    // and none is added to it. A tunnel that is reached on one announces it.
    expect(status(await raw(one.port, `Host: ${TUNNEL_HOST}:443\r\n`))).toBe(403);
  });

  it('does not reach the route by a prefix that is not whole segments', async () => {
    // `@ahpd/plugin-route` is served under `%40ahpd/plugin-route/`, so a path
    // that only starts like it is nobody's.
    for (const path of [`${PREFIX}-extra/hook`, '/plugins/%40ahpd/plugin-rout/hook', '/plugins/plugin-route/hook']) {
      expect((await hook(one.port, path, 'a=1')).status).toBe(404);
    }
    // And the route itself is untouched by the requests that missed it.
    expect((await hook(one.port, `${PREFIX}/hook`, 'a=1')).status).toBe(200);
  });

  it('answers 404 for a plugin this daemon did not load', async () => {
    const answer = await hook(one.port, '/plugins/%40ahpd/nobody/hook', 'a=1');
    expect(answer.status).toBe(404);
    expect((await answer.json() as { message: string }).message).toContain('No plugin route at');
  });

  it('answers 500 for a handler that throws, names the plugin, and keeps serving', async () => {
    const failed = await hook(one.port, `${PREFIX}/boom`, 'a=1');
    expect(failed.status).toBe(500);
    const message = (await failed.json() as { message: string }).message;
    expect(message).toContain('@ahpd/plugin-route');
    // The reason is the plugin's own and goes to the log, not to the caller.
    expect(message).not.toContain('asked to fail');

    expect((await hook(one.port, `${PREFIX}/hook`, 'a=1')).status).toBe(200);
    expect(one.stderr()).toContain('plugin @ahpd/plugin-route failed at /plugins/%40ahpd/plugin-route/boom: the fixture was asked to fail');
  });

  it('leaves everything else this listener answered before it alone', async () => {
    // `/api` is still the 404 a daemon with no API gives, and a plain path that
    // is not a plugin's is still the 426.
    expect((await fetch(`http://127.0.0.1:${String(one.port)}/api/status`)).status).toBe(404);
    const plain = await fetch(`http://127.0.0.1:${String(one.port)}/not-a-route`);
    expect(plain.status).toBe(426);
    expect(await plain.text()).toContain('ahpd speaks the Agent Host Protocol');
  });
});

describe('a route with http on', () => {
  let one: Daemon;

  beforeAll(async () => {
    one = await daemon({ http: true, plugins: [BACKEND, ROUTE] }, ['--connection-token', 'root-secret']);
  }, 40000);

  it('answers beside the API, on the same port', async () => {
    expect((await hook(one.port, `${PREFIX}/hook`, 'a=1')).status).toBe(200);
    const manifest = await fetch(`http://127.0.0.1:${String(one.port)}/api/cli-manifest`, {
      headers: { authorization: 'Bearer root-secret' },
    });
    expect(manifest.status).toBe(200);
  });

  it('takes the Host check the API takes, and the Origin check it does not', async () => {
    expect(status(await raw(one.port, `Host: evil.example:${String(one.port)}\r\n`))).toBe(403);
    // A cross-site `Origin` is the API's business: a route is called by
    // something that is not a browser, and authenticates its own caller.
    const crossSite = await raw(one.port, `Host: 127.0.0.1:${String(one.port)}\r\nOrigin: https://evil.example\r\n`);
    expect(status(crossSite)).toBe(200);
  });

  it('still refuses the API its own guards', async () => {
    expect(status(await raw(one.port, `Host: evil.example:${String(one.port)}\r\n`))).toBe(403);
    expect((await fetch(`http://127.0.0.1:${String(one.port)}/api/cli-manifest`, {
      headers: { authorization: 'Bearer root-secret' },
    })).status).toBe(200);
  });

  it('leaves the API on its own listener when http.port names one', async () => {
    const apart = await daemon({ http: { port: 0 }, plugins: [BACKEND, ROUTE] }, ['--connection-token', 'root-secret']);
    // The route is served on the daemon's port, and the API is not there.
    expect((await hook(apart.port, `${PREFIX}/hook`, 'a=1')).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${String(apart.port)}/api/status`)).status).toBe(404);
  }, 40000);
});

describe('the names an announcement adds', () => {
  it('takes the host and the hostname of every URL a line holds, and nothing a parser refuses', () => {
    const names = announcedNames([
      'tunnel fixture-tunnel (https://fixture-tunnel.example.com/), port 443',
      'the tunnel is at http://127.0.0.1:4040 and nothing else',
      'see https://example.com:8443/path?q=1 for the docs',
      'a bare word like `not-a-url` and a shape like ://nowhere',
      '',
    ]);
    expect(names).toContain('fixture-tunnel.example.com');
    expect(names).toContain('127.0.0.1:4040');
    expect(names).toContain('127.0.0.1');
    expect(names).toContain('example.com:8443');
    expect(names).toContain('example.com');
    expect(names).not.toContain('nowhere');
    expect(names).not.toContain('not-a-url');
  });
});