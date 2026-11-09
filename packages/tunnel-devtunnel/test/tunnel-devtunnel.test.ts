import { WAIT_MS } from '../../../tools/wait.ts';
import { loggerOf } from '@ahpd/sdk';
import { createHash } from 'node:crypto';
import { createServer as createHttpServer, get as httpGet } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { connect, createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { pluginHost } from '../../sdk/src/plugins/plugins.js';
import type { Host as DaemonHost } from '../../sdk/src/types/host.js';
import type { Alert, LoaderContext, PluginView } from '../../sdk/src/types/plugin.js';
import type { Tunnel, TunnelReport } from '../../sdk/src/types/tunnels.js';
import {
  deriveConnectionToken, displayLabel, normalizeTunnelName, tunnelNameFromHostname,
  LAUNCHER_LABEL, MAX_TUNNEL_NAME_LENGTH, PROTOCOL_LABEL, TUNNEL_PORT,
} from '../src/discovery.js';
import { forward } from '../src/forward.js';
import { devtunnelKind } from '../src/kind.js';
import type { KindOptions } from '../src/kind.js';
import { apply } from '../src/plugin.js';
import { labelsOf, portOf, sdkService } from '../src/service.js';
import type { Cloud, Host, Kept, Remote, Service } from '../src/service.js';

/*
 * The convention, the hop and the kind, with a fake SDK instead of an account.
 *
 * The convention is the half that has to be right, so it is checked against
 * what it is a convention *for* rather than against itself: the token is
 * recomputed here from its definition, and the labels are read back through
 * the same rule VS Code's `TunnelTags` applies. Below that, a `Cloud` and a
 * `Host` are arrays and counters: no token is real, no tunnel is opened, and
 * the SDK is never reached.
 */

const context = (over: Partial<LoaderContext> = {}): LoaderContext => ({
  path: '/work', paths: ['/work'], version: '0.6.3', hostName: 'test', configDir: '/work', log: loggerOf(() => {}), say: () => {}, ...over,
});

// The convention ----------------------------------------------------------

it('derives the token a client presents as unpadded base64url of the id hash', async () => {
  const id = 'sunny-otter-9k3';
  const expected = createHash('sha256').update(id).digest('base64url');
  expect(await deriveConnectionToken(id)).toBe(expected);
  // 32 bytes is 43 characters once the padding is gone, which is what the
  // client's own encoder produces and what the query parameter carries.
  expect(expected).toHaveLength(43);
});

it('never lets a derived token begin with a dash', async () => {
  // A token is a query parameter and one starting with a dash reads as a flag
  // to whatever handles it next, so the client prefixes it and so must this.
  const found = await Promise.all(
    Array.from({ length: 200 }, (_, at) => deriveConnectionToken(`id-${at}`)),
  );
  expect(found.some((token) => token.startsWith('a-'))).toBe(true);
  expect(found.every((token) => !token.startsWith('-'))).toBe(true);
});

it('reads the display name the way the client works it out', () => {
  // The first label that is not the launcher, not underscore-prefixed and not
  // a protocol tag, wherever it stands.
  expect(displayLabel([LAUNCHER_LABEL, PROTOCOL_LABEL, '_flags', 'dev03'])).toBe('dev03');
  expect(displayLabel([LAUNCHER_LABEL, PROTOCOL_LABEL])).toBeUndefined();
});

it('names a tunnel as VS Code does: the host name cleaned, a configured name normalized', () => {
  // VS Code's own cases (src/vs/platform/remoteTunnel/test/common/remoteTunnel.test.ts).
  expect(tunnelNameFromHostname('hello123')).toBe('hello123');
  expect(tunnelNameFromHostname('-cool-name-')).toBe('cool-name');
  expect(tunnelNameFromHostname('cool!name with_chars')).toBe('coolname-with-chars');
  expect(tunnelNameFromHostname('z')).toBe('remote-machine');
  expect(tunnelNameFromHostname('Dev03.Example.com')).toBe('dev03examplecom');
  expect(tunnelNameFromHostname('x'.repeat(40))).toHaveLength(MAX_TUNNEL_NAME_LENGTH);
  expect(normalizeTunnelName('--My_Box')).toBe('my_box');
  // A tunnel carries its name, the protocol and the launcher, as the CLI's labels.
  expect(labelsOf('dev03')).toEqual(['dev03', PROTOCOL_LABEL, LAUNCHER_LABEL]);
});

// The hop -----------------------------------------------------------------

const closing: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const close of closing.splice(0)) await close();
});

it('carries a connection from the well-known port to the one the daemon bound', async () => {
  const daemon = createServer((socket) => { socket.on('data', (chunk) => socket.write(`seen ${chunk}`)); });
  await new Promise<void>((done) => { daemon.listen(0, '127.0.0.1', done); });
  closing.push(() => new Promise<void>((done) => { daemon.close(() => done()); }));
  const bound = (daemon.address() as AddressInfo).port;

  // Not the well-known port: the whole point is that the two are different.
  const hop = await forward(0, bound, () => {});
  closing.push(() => hop.close());

  const answer = await new Promise<string>((done, fail) => {
    const client = connect({ host: '127.0.0.1', port: hop.port }, () => { client.write('frame'); });
    client.on('data', (chunk) => { done(String(chunk)); client.destroy(); });
    client.on('error', fail);
  });
  expect(answer).toBe('seen frame');
});

/*
 * Over a guarded daemon the hop sets the daemon's own token on every request
 * it carries, a WebSocket upgrade among them, as VS Code's CLI injects its
 * agent host's token into each request arriving over a tunnel
 * (cli/src/tunnels/agent_host.rs L1651-L1709 at 6b68d3fe).
 */
it('sets the daemon\'s token as the tkn of every request it carries, an upgrade among them', async () => {
  const seen: string[] = [];
  const daemon = createHttpServer((asked, answer) => { seen.push(asked.url ?? ''); answer.end('plain'); });
  daemon.on('upgrade', (asked: IncomingMessage, socket: Socket) => {
    seen.push(asked.url ?? '');
    socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
  });
  await new Promise<void>((done) => { daemon.listen(0, '127.0.0.1', done); });
  closing.push(() => new Promise<void>((done) => { daemon.closeAllConnections(); daemon.close(() => done()); }));
  const bound = (daemon.address() as AddressInfo).port;
  const hop = await forward(0, bound, () => {}, 's3cret');
  closing.push(() => hop.close());

  // A plain request, with a query and a token of the client's own.
  const plain = await new Promise<string>((done, fail) => {
    httpGet({ host: '127.0.0.1', port: hop.port, path: '/api/x?a=1&tkn=derived' }, (answer) => {
      let body = '';
      answer.on('data', (chunk) => { body += String(chunk); });
      answer.on('end', () => { done(body); });
    }).on('error', fail);
  });
  expect(plain).toBe('plain');

  // A WebSocket handshake, written by hand as a client sends one.
  const upgraded = await new Promise<string>((done, fail) => {
    const client = connect({ host: '127.0.0.1', port: hop.port }, () => {
      client.write('GET /?tkn=derived HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: x\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    client.on('data', (chunk) => { done(String(chunk)); client.destroy(); });
    client.on('error', fail);
  });
  expect(upgraded).toContain('101 Switching Protocols');
  expect(seen).toEqual(['/api/x?a=1&tkn=s3cret', '/?tkn=s3cret']);
});

// The fake SDK ------------------------------------------------------------

/** A made-up Dev Tunnel, which no service ever made. */
const REMOTE: Remote = {
  id: 'otter-1234',
  labels: ['dev03', PROTOCOL_LABEL, LAUNCHER_LABEL],
  cluster: 'brs',
};

/** What the fake SDK was asked to do, so a case can read the calls. */
interface Calls {
  got: Kept[];
  found: string[];
  made: number;
  synced: string[][];
  hosted: number;
  deleted: number;
  refreshed: number;
  restarted: number;
  closed: number;
  added: number[];
  removed: number[];
  access: [number, boolean][];
  labels?: string[];
}

/**
 * The SDK as two objects of arrays and counters.
 *
 * `get` answers the tunnel kept by id and `find` the account's tunnel by its
 * name, which is what makes a restart keep the Dev Tunnel's id. The host counts
 * the calls that matter to the arrangement: one host for a connector, and a
 * refresh after every port.
 */
const fakeCloud = (options: { found?: Remote; kept?: Remote } = {}) => {
  const calls: Calls = {
    got: [], found: [], made: 0, synced: [], hosted: 0, deleted: 0, refreshed: 0, restarted: 0, closed: 0,
    added: [], removed: [], access: [],
  };
  let held: Remote | undefined;
  const host: Host = {
    add: async (port) => { calls.added.push(port); return `https://url-${String(port)}.example.test/`; },
    access: async (port, on) => { calls.access.push([port, on]); },
    remove: async (port) => { calls.removed.push(port); },
    refresh: async () => { calls.refreshed += 1; },
    restart: async () => { calls.restarted += 1; },
    close: async () => { calls.closed += 1; },
  };
  const cloud: Cloud = {
    get: async (kept) => {
      calls.got.push(kept);
      if (options.kept === undefined || options.kept.id !== kept.id) return undefined;
      held = options.kept;
      return held;
    },
    find: async (name) => {
      calls.found.push(name);
      if (options.found === undefined || !options.found.labels.includes(name)) return undefined;
      held = options.found;
      return held;
    },
    make: async (labels) => {
      calls.made += 1;
      calls.labels = labels;
      held = { id: 'made-1234', labels };
      return held;
    },
    sync: async (labels) => {
      if (held === undefined) throw new Error('the fake was asked to sync before it held a tunnel');
      const same = held.labels.length === labels.length && labels.every((label) => held?.labels.includes(label));
      if (!same) {
        calls.synced.push(labels);
        held = { ...held, labels };
      }
      return held;
    },
    host: async () => { calls.hosted += 1; return host; },
    show: async (port) => ({
      id: held?.id ?? 'made-1234',
      url: `https://url-${String(port)}.example.test/`,
      hosts: 1,
      clients: 0,
    }),
    delete: async () => { calls.deleted += 1; },
  };
  return { cloud, calls };
};

/** The token a record of this kind would carry, which no call here uses. */
const TOKEN = 'gho_made-up-token';

/** A service over the real arrangement and the fake SDK, with the tunnels it keeps in `kept`. */
const serviceOver = (cloud: Cloud, kept = new Map<string, Kept>(), name = 'dev03'): Service => sdkService({
  token: async () => ({ token: TOKEN }),
  cloud: () => cloud,
  name,
  kept: {
    read: async (connector) => kept.get(connector),
    write: async (connector, one) => { kept.set(connector, one); },
  },
});

/** A service no case reaches, for the plugin tests that only register. */
const unusedService = (): Service => ({
  add: async () => { throw new Error('the fake service was not asked to add a port'); },
  access: async () => {},
  replace: async () => undefined,
  remove: async () => {},
  restart: async () => {},
  show: async () => undefined,
  close: async () => {},
});

/** A tunnel record as the host hands it to its kind. */
const tunnel = (over: Partial<Tunnel> = {}): Tunnel => ({
  id: 'devtunnel-1',
  kind: 'devtunnel',
  plugin: 'tunnel-devtunnel',
  purpose: 'person',
  enabled: true,
  settings: { connector: 'mine', port: 9101 },
  ...over,
});

/** What the kind reported, so a case reads the last answer. */
const reporting = () => {
  const seen: TunnelReport[] = [];
  return { seen, report: (report: TunnelReport) => { seen.push(report); } };
};

/** The kind over a service, with the lines, alerts and page it made kept. */
const kindFor = (service: Service, over: Partial<KindOptions> = {}) => {
  const said: string[] = [];
  const logged: string[] = [];
  const alerts: Alert[] = [];
  const views: PluginView[] = [];
  const cleared: string[] = [];
  const { host } = pluginHost('tunnel', context({
    say: (line) => { said.push(line); },
    log: loggerOf((line: string) => { logged.push(line); }),
  }), {
    alert: (alert) => { alerts.push(alert); },
    clearAlert: (ref) => { cleared.push(ref); },
    showView: (_surface, view) => { views.push(view); },
    clearView: (surface) => { cleared.push(surface ?? 'main'); },
  });
  const kind = devtunnelKind({
    plugin: host,
    service,
    anonymous: false,
    keep: true,
    open: () => true,
    daemonPort: () => TUNNEL_PORT,
    guarded: () => false,
    ...over,
  });
  return { kind, said, logged, alerts, views, cleared };
};

// The kind ----------------------------------------------------------------

it('finds the account\'s Dev Tunnel of its name, so its id and token stay', async () => {
  const { cloud, calls } = fakeCloud({ found: REMOTE });
  const { kind, said } = kindFor(serviceOver(cloud), { connector: 'mine' });
  const report = reporting();

  await kind.create(tunnel({ purpose: 'system', settings: { connector: 'mine', port: TUNNEL_PORT } }), report.report);

  expect(calls.found).toEqual(['dev03']);
  expect(calls.made).toBe(0);
  // The id a client derives its connection token from is the one it had before.
  expect(said[0]).toBe(`tunnel ${REMOTE.id} (dev03), port ${TUNNEL_PORT}`);
  expect(report.seen.at(-1)).toMatchObject({ status: 'running', url: `https://url-${String(TUNNEL_PORT)}.example.test/` });
});

it('makes one with the convention\'s labels when the account has none', async () => {
  const { cloud, calls } = fakeCloud();
  const { kind } = kindFor(serviceOver(cloud));

  await kind.create(tunnel(), reporting().report);

  expect(calls.found).toEqual(['dev03']);
  expect(calls.made).toBe(1);
  expect(calls.labels).toEqual(['dev03', PROTOCOL_LABEL, LAUNCHER_LABEL]);
});

it('keeps the tunnel a connector hosted and finds it again by its id, ahead of any name', async () => {
  const kept = new Map<string, Kept>();
  const first = fakeCloud();
  await kindFor(serviceOver(first.cloud, kept)).kind.create(tunnel(), reporting().report);
  expect(kept.get('mine')).toEqual({ id: 'made-1234', name: 'dev03' });

  // The next run asks for that id first, and names no tunnel when it answers.
  const again = fakeCloud({ kept: { id: 'made-1234', labels: ['dev03', PROTOCOL_LABEL, LAUNCHER_LABEL] } });
  await kindFor(serviceOver(again.cloud, kept)).kind.create(tunnel(), reporting().report);
  expect(again.calls.got).toEqual([{ id: 'made-1234', name: 'dev03' }]);
  expect(again.calls.found).toEqual([]);
  expect(again.calls.made).toBe(0);
});

it('gives a found tunnel the labels it should carry, a new name among them, and keeps the name', async () => {
  const kept = new Map<string, Kept>([['mine', { id: REMOTE.id, cluster: 'brs', name: 'dev03' }]]);
  const { cloud, calls } = fakeCloud({ kept: { ...REMOTE, labels: ['dev03', 'protocolv4', LAUNCHER_LABEL] } });
  await kindFor(serviceOver(cloud, kept, 'box-2')).kind.create(tunnel(), reporting().report);

  expect(calls.synced).toEqual([['box-2', PROTOCOL_LABEL, LAUNCHER_LABEL]]);
  expect(kept.get('mine')).toEqual({ id: REMOTE.id, cluster: 'brs', name: 'box-2' });
});

it('refuses a name another machine hosts a tunnel of, in the CLI\'s words', async () => {
  const { cloud, calls } = fakeCloud({ found: { ...REMOTE, hosts: 1 } });
  const report = reporting();
  await kindFor(serviceOver(cloud)).kind.create(tunnel(), report.report);

  expect(calls.made).toBe(0);
  expect(calls.hosted).toBe(0);
  expect(report.seen.at(-1)).toEqual({
    status: 'error',
    error: 'A tunnel with the name dev03 exists and is in-use. Please pick a different name or stop the existing tunnel.',
  });
});

it('writes a port as auto, with an anonymous allow when it is public and a deny when it is not', () => {
  expect(portOf(9101, true)).toEqual({
    portNumber: 9101,
    protocol: 'auto',
    accessControl: { entries: [{ type: 'Anonymous', subjects: [], scopes: ['connect'] }] },
  });
  expect(portOf(9101, false)).toEqual({
    portNumber: 9101,
    protocol: 'auto',
    accessControl: { entries: [{ type: 'Anonymous', isDeny: true, subjects: [], scopes: ['connect'] }] },
  });
});

it('hosts one Dev Tunnel for a connector, and refreshes it for every port', async () => {
  const { cloud, calls } = fakeCloud({ found: REMOTE });
  const { kind } = kindFor(serviceOver(cloud));

  await kind.create(tunnel({ id: 'devtunnel-a', settings: { connector: 'mine', port: 9101 } }), reporting().report);
  await kind.create(tunnel({ id: 'devtunnel-b', settings: { connector: 'mine', port: 9102 } }), reporting().report);

  // Two tunnels of one connector are two ports on one host.
  expect(calls.hosted).toBe(1);
  expect(calls.added).toEqual([9101, 9102]);
  // The second port was added after the relay connected, so it has to be told.
  expect(calls.refreshed).toBe(2);
});

it('closes the host when its last port goes, and deletes the Dev Tunnel only without keep', async () => {
  const kept = fakeCloud({ found: REMOTE });
  const first = kindFor(serviceOver(kept.cloud), { keep: true });
  await first.kind.create(tunnel({ id: 'devtunnel-a', settings: { connector: 'mine', port: 9101 } }), reporting().report);
  await first.kind.create(tunnel({ id: 'devtunnel-b', settings: { connector: 'mine', port: 9102 } }), reporting().report);

  await first.kind.invoke('stop', tunnel({ id: 'devtunnel-a', settings: { connector: 'mine', port: 9101 } }), reporting().report);
  expect(kept.calls.removed).toEqual([9101]);
  expect(kept.calls.closed).toBe(0);
  expect(kept.calls.deleted).toBe(0);

  await first.kind.invoke('stop', tunnel({ id: 'devtunnel-b', settings: { connector: 'mine', port: 9102 } }), reporting().report);
  expect(kept.calls.closed).toBe(1);
  // Kept: a new Dev Tunnel is a new id, and therefore a new token for every client.
  expect(kept.calls.deleted).toBe(0);

  const gone = fakeCloud({ found: REMOTE });
  const second = kindFor(serviceOver(gone.cloud), { keep: false });
  await second.kind.create(tunnel(), reporting().report);
  await second.kind.invoke('stop', tunnel(), reporting().report);
  expect(gone.calls.closed).toBe(1);
  expect(gone.calls.deleted).toBe(1);
});

it('says the derived token on a guarded daemon, and never the connector\'s', async () => {
  const { cloud } = fakeCloud({ found: REMOTE });
  const { kind, said, logged } = kindFor(serviceOver(cloud), { connector: 'mine', guarded: () => true });

  await kind.create(tunnel({ purpose: 'system', settings: { connector: 'mine', port: TUNNEL_PORT } }), reporting().report);

  expect(said[1]).toContain(await deriveConnectionToken(REMOTE.id));
  expect(said[1]).toContain('this daemon requires its own');
  for (const line of [...said, ...logged]) expect(line).not.toContain(TOKEN);
});

it('says no derived token where the hop carries the guarded daemon\'s own', async () => {
  const { cloud } = fakeCloud({ found: REMOTE });
  const daemon = createServer(() => {});
  await new Promise<void>((done) => { daemon.listen(0, '127.0.0.1', done); });
  closing.push(() => new Promise<void>((done) => { daemon.close(() => done()); }));
  const { kind, said } = kindFor(serviceOver(cloud), {
    connector: 'mine',
    guarded: () => true,
    connectionToken: () => 's3cret',
    daemonPort: () => (daemon.address() as AddressInfo).port,
  });

  await kind.create(tunnel({ purpose: 'system', settings: { connector: 'mine', port: TUNNEL_PORT } }), reporting().report);
  expect(said.some((line) => line.includes('this daemon requires its own'))).toBe(false);
  await kind.invoke('stop', tunnel({ purpose: 'system', settings: { connector: 'mine', port: TUNNEL_PORT } }), reporting().report);
});

it('reports a connector that is not open, and starts nothing', async () => {
  const { cloud, calls } = fakeCloud({ found: REMOTE });
  const { kind, said, logged } = kindFor(serviceOver(cloud), { connector: 'mine', open: () => false });
  const report = reporting();

  await kind.invoke('start', tunnel(), report.report);

  expect(report.seen).toEqual([{
    status: 'error',
    error: expect.stringContaining('Sign in to this connector again'),
  }]);
  expect(said).toEqual([]);
  expect(calls.hosted).toBe(0);
  for (const line of logged) expect(line).not.toContain(TOKEN);
});

it('changes the access of a running port live, and leaves the port where it is', async () => {
  const { cloud, calls } = fakeCloud({ found: REMOTE });
  const { kind } = kindFor(serviceOver(cloud));
  const report = reporting();
  await kind.create(tunnel(), report.report);

  await kind.invoke('anonymous', tunnel(), report.report, { on: true });

  expect(calls.access).toEqual([[9101, true]]);
  expect(calls.added).toEqual([9101]);
  // The change is kept in the record, so the next start puts it on the port.
  expect(report.seen.at(-1)).toEqual({ settings: { anonymous: true } });
});

it('restarts the port in place when a person moves it', async () => {
  const { cloud, calls } = fakeCloud({ found: REMOTE });
  const { kind } = kindFor(serviceOver(cloud));
  const report = reporting();
  await kind.create(tunnel(), report.report);

  await kind.update!(tunnel({ settings: { connector: 'mine', port: 9200 } }), { connector: 'mine', port: 9200 }, report.report);

  expect(calls.removed).toEqual([9101]);
  expect(calls.added).toEqual([9101, 9200]);
  // The host stays: closing it on the moved-away port would delete the tunnel
  // when `keep` is false, and a new tunnel is a new id.
  expect(calls.closed).toBe(0);
  expect(report.seen.at(-1)).toMatchObject({ status: 'running' });
});

// The plugin --------------------------------------------------------------

it('registers the connector and the devtunnel kind', async () => {
  const { host, contribution } = pluginHost('tunnel', context());
  await apply(host, { service: unusedService() });

  expect(contribution.adapters['devtunnel']?.name).toBe('devtunnel');
  expect(Object.keys(contribution.tunnelKinds ?? {})).toEqual(['devtunnel']);
  // The mark in the schema is how a client knows which connector fills it in.
  expect(contribution.tunnelKinds?.['devtunnel']?.schema).toHaveProperty(
    'properties.connector.x-ahpd-connector', 'devtunnel',
  );
});

it('offers its host every protocol version the package speaks, newest first, when a refresh writes its secret back', async () => {
  // GitHub's answer to the refresh a connector opens with.
  vi.stubGlobal('fetch', async () => new Response(
    JSON.stringify({ access_token: 'token-2', refresh_token: 'refresh-2' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ));
  try {
    const { host, contribution } = pluginHost('tunnel', context());
    await apply(host, { service: unusedService() });
    // A host that answers every request and keeps what the handshake offered.
    const offered: unknown[] = [];
    contribution.connects.host = {
      accept: () => ({
        handle: (request: { method: string; params?: Record<string, unknown> }) => {
          if (request.method === 'initialize') offered.push(request.params?.['protocolVersions']);
          return {};
        },
        close: () => {},
      }),
    } as unknown as DaemonHost;
    for (const listener of contribution.events.listening ?? []) {
      await listener.handle({ type: 'listening', runtime: 'node', host: '127.0.0.1', port: 9187, guarded: false }, listener.context);
    }

    const close = contribution.adapters['devtunnel']?.open({
      id: 'mine', adapter: 'devtunnel', owner: 'host', config: { token: 'token-1', refresh: 'refresh-1' },
    });
    try {
      await vi.waitFor(() => { expect(offered).toEqual([['1.0.0', '0.9.0']]); }, { timeout: WAIT_MS });
    }
    finally {
      if (typeof close === 'function') close();
    }
  }
  finally {
    vi.unstubAllGlobals();
  }
});

it('adds no system tunnel until a connector is set', async () => {
  const { host, contribution } = pluginHost('tunnel', context());
  await apply(host, { service: unusedService() });

  const kind = contribution.tunnelKinds?.['devtunnel'];
  expect(await kind?.system?.({ port: 9187 })).toBeUndefined();
});
