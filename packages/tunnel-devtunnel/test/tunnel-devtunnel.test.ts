import { createHash } from 'node:crypto';
import { connect, createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { pluginHost } from '../../sdk/src/plugins/plugins.js';
import type { Alert, LoaderContext, PluginView } from '../../sdk/src/types/plugin.js';
import type { Tunnel, TunnelReport } from '../../sdk/src/types/tunnels.js';
import {
  deriveConnectionToken, displayLabel, IDENTITY_LABEL, nameLabel,
  LAUNCHER_LABEL, PROTOCOL_LABEL, TUNNEL_PORT,
} from '../src/discovery.js';
import { forward } from '../src/forward.js';
import { devtunnelKind } from '../src/kind.js';
import type { KindOptions } from '../src/kind.js';
import { apply } from '../src/plugin.js';
import { labelsOf, sdkService } from '../src/service.js';
import type { Cloud, Host, Remote, Service } from '../src/service.js';

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
  path: '/work', paths: ['/work'], version: '0.6.3', hostName: 'test', configDir: '/work', log: () => {}, say: () => {}, ...over,
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
  // a protocol tag. Order matters, and the two markers must not win it.
  expect(displayLabel([LAUNCHER_LABEL, PROTOCOL_LABEL, IDENTITY_LABEL, 'dev03'])).toBe('dev03');
  expect(displayLabel([LAUNCHER_LABEL, PROTOCOL_LABEL, IDENTITY_LABEL])).toBeUndefined();
});

it('turns a machine name into something that can be a label', () => {
  expect(nameLabel('dev03.example.com')).toBe('dev03examplecom');
  expect(nameLabel('--dev')).toBe('dev');
  expect(nameLabel('x'.repeat(40))).toHaveLength(20);
  expect(nameLabel('!!!')).toBeUndefined();
  // A new tunnel carries every marker the convention needs, then the name.
  expect(labelsOf('dev03')).toEqual([LAUNCHER_LABEL, PROTOCOL_LABEL, IDENTITY_LABEL, 'dev03']);
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

// The fake SDK ------------------------------------------------------------

/** A made-up Dev Tunnel, which no service ever made. */
const REMOTE: Remote = {
  id: 'otter-1234',
  labels: [LAUNCHER_LABEL, PROTOCOL_LABEL, IDENTITY_LABEL, 'dev03'],
  cluster: 'brs',
};

/** What the fake SDK was asked to do, so a case can read the calls. */
interface Calls {
  found: number;
  made: number;
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
 * `find` answers what the account already holds, which is what makes a restart
 * keep the Dev Tunnel's id. The host counts the calls that matter to the
 * arrangement: one host for a connector, and a refresh after every port.
 */
const fakeCloud = (options: { found?: Remote } = {}) => {
  const calls: Calls = {
    found: 0, made: 0, hosted: 0, deleted: 0, refreshed: 0, restarted: 0, closed: 0,
    added: [], removed: [], access: [],
  };
  let held: Remote | undefined = options.found;
  const host: Host = {
    add: async (port) => { calls.added.push(port); return `https://url-${String(port)}.example.test/`; },
    access: async (port, on) => { calls.access.push([port, on]); },
    remove: async (port) => { calls.removed.push(port); },
    refresh: async () => { calls.refreshed += 1; },
    restart: async () => { calls.restarted += 1; },
    close: async () => { calls.closed += 1; },
  };
  const cloud: Cloud = {
    find: async () => { calls.found += 1; return held; },
    make: async (labels) => {
      calls.made += 1;
      calls.labels = labels;
      held = { id: 'made-1234', labels };
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

/** A service over the real arrangement and the fake SDK. */
const serviceOver = (cloud: Cloud): Service =>
  sdkService({ token: async () => ({ token: TOKEN }), cloud: () => cloud, name: 'dev03' });

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
    log: (line) => { logged.push(line); },
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

it('finds the Dev Tunnel it made before by its label, so its id and token stay', async () => {
  const { cloud, calls } = fakeCloud({ found: REMOTE });
  const { kind, said } = kindFor(serviceOver(cloud), { connector: 'mine' });
  const report = reporting();

  await kind.create(tunnel({ purpose: 'system', settings: { connector: 'mine', port: TUNNEL_PORT } }), report.report);

  expect(calls.found).toBe(1);
  expect(calls.made).toBe(0);
  // The id a client derives its connection token from is the one it had before.
  expect(said[0]).toBe(`tunnel ${REMOTE.id} (dev03), port ${TUNNEL_PORT}`);
  expect(report.seen.at(-1)).toMatchObject({ status: 'running', url: `https://url-${String(TUNNEL_PORT)}.example.test/` });
});

it('makes one with the convention\'s labels when the account has none', async () => {
  const { cloud, calls } = fakeCloud();
  const { kind } = kindFor(serviceOver(cloud));

  await kind.create(tunnel(), reporting().report);

  expect(calls.found).toBe(1);
  expect(calls.made).toBe(1);
  expect(calls.labels).toEqual([LAUNCHER_LABEL, PROTOCOL_LABEL, IDENTITY_LABEL, 'dev03']);
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

it('adds no system tunnel until a connector is set', async () => {
  const { host, contribution } = pluginHost('tunnel', context());
  await apply(host, { service: unusedService() });

  const kind = contribution.tunnelKinds?.['devtunnel'];
  expect(await kind?.system?.({ port: 9187 })).toBeUndefined();
});
