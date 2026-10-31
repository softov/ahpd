import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { checkView } from '../../sdk/src/plugins/view.js';
import { pluginHost, raise } from '../../sdk/src/plugins/plugins.js';
import type { LoaderContext, PluginView } from '../../sdk/src/types/plugin.js';
import { LAUNCHER_LABEL, PROTOCOL_LABEL, TUNNEL_PORT } from '../src/discovery.js';
import { show } from '../src/devtunnel.js';
import type { Result, Runner } from '../src/devtunnel.js';
import { apply, POLL_MS } from '../src/plugin.js';

/*
 * The plugin's page, and the poll behind it.
 *
 * The answers of `devtunnel show` are fixtures built from the fields the plan
 * names - `hostConnections`, `clientConnections` and each port's `portNumber`
 * and `portUri` - and `CAPTURED` is one the CLI printed, with its tunnel id and
 * URL replaced. A fake runner and spawner stand in for the CLI, and fake timers
 * stand in for the thirty seconds between one read and the next.
 */

const ok = (stdout: string): Result => ({ status: 0, signal: null, stdout, stderr: '' });
const no = (stderr: string, status = 1): Result => ({ status, signal: null, stdout: '', stderr });

/** A runner that answers each command by its first word, and records the calls. */
const runner = (answers: Record<string, Result | Result[]>): Runner & { calls: string[][] } => {
  const calls: string[][] = [];
  const left = new Map(Object.entries(answers).map(([at, value]) => [at, Array.isArray(value) ? [...value] : [value]]));
  const one = ((args: readonly string[]) => {
    calls.push([...args]);
    const queue = left.get(args[0] ?? '');
    return (queue !== undefined && queue.length > 1 ? queue.shift() : queue?.[0]) ?? ok('{}');
  }) as Runner & { calls: string[][] };
  one.calls = calls;
  return one;
};

/** A `devtunnel host` that does not exist, so nothing is spawned in a test. */
const spawner = () => {
  const child = new EventEmitter() as ChildProcess & { killed: boolean };
  child.killed = false;
  child.kill = () => { child.killed = true; return true; };
  return child;
};

const TUNNEL = 'sunny-otter-9k3';
const URL = `https://${TUNNEL}-${String(TUNNEL_PORT)}.devtunnels.ms`;

/** The list answer for the tunnel this plugin made before. */
const kept = (): Result => ok(JSON.stringify({
  tunnels: [{ tunnelId: TUNNEL, labels: [LAUNCHER_LABEL, PROTOCOL_LABEL, '_ahpd', 'dev03'] }],
}));

/** A tunnel the service holds, with one host and two clients on it. */
const UP = JSON.stringify({
  tunnel: {
    tunnelId: TUNNEL,
    hostConnections: 1,
    clientConnections: 2,
    // The daemon's own port comes first, so taking it would be the wrong URL.
    ports: [
      { portNumber: 9187, portUri: 'https://direct.example.test' },
      { portNumber: TUNNEL_PORT, portUri: URL },
    ],
  },
});

/** The same tunnel after the relay dropped: no host is connected. */
const DOWN = JSON.stringify({
  tunnel: {
    tunnelId: TUNNEL,
    hostConnections: 0,
    clientConnections: 0,
    ports: [{ portNumber: TUNNEL_PORT, portUri: URL }],
  },
});

/**
 * What `devtunnel show <id> --json` printed, from CLI 1.0.2094, for a tunnel
 * this plugin made and is hosting with no client on it. Every field is as the
 * CLI wrote it but the tunnel id, the URL and the machine's label: the
 * connection token is derived from the id.
 */
const CAPTURED = JSON.stringify({
  tunnel: {
    tunnelId: 'quiet-river-x1y2z3a.brs',
    hostConnections: 1,
    clientConnections: 0,
    labels: [LAUNCHER_LABEL, PROTOCOL_LABEL, '_ahpd', 'dev03'],
    tunnelExpiration: '30 days',
    description: '',
    currentUploadRate: '0 MB/s (limit: 20 MB/s)',
    currentDownloadRate: '0 MB/s (limit: 20 MB/s)',
    uploadTotal: '290 KB',
    downloadTotal: '318 KB',
    ports: [{ portNumber: TUNNEL_PORT, protocol: 'http', portUri: `https://abcd1234-${String(TUNNEL_PORT)}.brs.devtunnels.ms/` }],
    accessControl: [],
  },
}, null, 2);

const context = (log: (line: string) => void = () => {}): LoaderContext => ({
  path: '/work', paths: ['/work'], version: '0.10.0', hostName: 'test', configDir: '/work', log, say: () => {},
});

const listening = { type: 'listening', runtime: 'node', host: '127.0.0.1', port: TUNNEL_PORT, guarded: false } as const;

/** The plugin applied to a host, raised to `listening`, with what it drew kept. */
const running = async (run: Runner, log: (line: string) => void = () => {}) => {
  const views: PluginView[] = [];
  const cleared: string[] = [];
  const { host, contribution } = pluginHost('tunnel', context(log), {
    showView: (_surface, view) => { views.push(view); },
    clearView: (surface) => { cleared.push(surface); },
  });
  await apply(host, { runner: run, spawner });
  await raise(contribution.events, listening);
  return { views, cleared, events: contribution.events };
};

afterEach(() => { vi.useRealTimers(); });

// What the CLI says -------------------------------------------------------

it('reads the URL of the tunnel\'s own port, the relay state and the client count', async () => {
  const tunnel = { tunnelId: TUNNEL, labels: [] };
  const up = runner({ show: ok(UP) });
  expect(await show(tunnel, up)).toEqual({ url: URL, hosts: 1, clients: 2 });
  expect(up.calls[0]).toEqual(['show', TUNNEL, '--json']);

  // A relay that is down answers 0 hosts, and the URL is still there to open.
  expect(await show(tunnel, runner({ show: ok(DOWN) }))).toEqual({ url: URL, hosts: 0, clients: 0 });
});

it('reads the answer the CLI printed', async () => {
  const tunnel = { tunnelId: 'quiet-river-x1y2z3a.brs', labels: [] };
  expect(await show(tunnel, runner({ show: ok(CAPTURED) }))).toEqual({
    url: `https://abcd1234-${String(TUNNEL_PORT)}.brs.devtunnels.ms/`,
    hosts: 1,
    clients: 0,
  });
});

it('has no URL to show when the service answers no port for the tunnel', async () => {
  const answer = ok(JSON.stringify({ tunnel: { hostConnections: 0, clientConnections: 0, ports: [] } }));
  expect(await show({ tunnelId: TUNNEL, labels: [] }, runner({ show: answer }))).toEqual({ hosts: 0, clients: 0 });
});

it('refuses a count that is there and is not a number', async () => {
  const answer = ok(JSON.stringify({ tunnel: { hostConnections: 'one', clientConnections: 0 } }));
  await expect(show({ tunnelId: TUNNEL, labels: [] }, runner({ show: answer })))
    .rejects.toThrow(/hostConnections that is not a number/);
});

// The page ----------------------------------------------------------------

it('shows a view the sdk accepts, with the URL and every value on it', async () => {
  const { views } = await running(runner({ list: kept(), port: ok(''), show: ok(UP) }));
  expect(views).toHaveLength(1);
  const view = views[0] as PluginView;

  expect(() => { checkView(view, 'main', 'tunnel', {}); }).not.toThrow();
  expect(view.components['address']).toEqual({ id: 'address', component: 'Link', label: 'Open the tunnel', href: URL });
  expect(view.components['tunnel-value']?.text).toBe(TUNNEL);
  expect(view.components['port-value']?.text).toBe(String(TUNNEL_PORT));
  expect(view.components['relay-up']?.text).toBe('The relay is up');
  expect(view.components['clients-value']?.text).toBe('2');
  expect(view.components['body']?.children).toEqual(['status', 'rule', 'tunnel', 'port', 'clients']);
  expect(view.components['status']?.children).toEqual(['address', 'relay-up']);
  expect(view.components['relay-up']?.tone).toBe('success');
  expect(view.components['port']).toEqual({ id: 'port', component: 'Row', justify: 'spaceBetween', align: 'center', children: ['port-label', 'port-value'] });
  expect(view.components['port-label']).toEqual({ id: 'port-label', component: 'Text', variant: 'caption', text: 'Port' });
});

it('says the address is not ready rather than drawing a Link the sdk would refuse', async () => {
  const answer = ok(JSON.stringify({ tunnel: { hostConnections: 0, clientConnections: 0, ports: [] } }));
  const { views } = await running(runner({ list: kept(), port: ok(''), show: answer }));
  const view = views[0] as PluginView;
  expect(view.components['address']).toEqual({ id: 'address', component: 'Text', text: 'The tunnel address is not ready' });
  expect(view.components['relay-down']?.text).toBe('The relay is down');
  expect(view.components['relay-down']?.tone).toBe('danger');
  expect(() => { checkView(view, 'main', 'tunnel', {}); }).not.toThrow();
});

// The poll ----------------------------------------------------------------

it('draws the state again only when it changed', async () => {
  vi.useFakeTimers();
  const run = runner({ list: kept(), port: ok(''), show: [ok(UP), ok(UP), ok(DOWN)] });
  const { views } = await running(run);
  expect(views).toHaveLength(1);

  await vi.advanceTimersByTimeAsync(POLL_MS);
  // The same answer is read again and says nothing: the page is what it was.
  expect(views).toHaveLength(1);
  expect(run.calls.filter((one) => one[0] === 'show')).toHaveLength(2);

  await vi.advanceTimersByTimeAsync(POLL_MS);
  expect(views).toHaveLength(2);
  expect((views[1] as PluginView).components['relay-down']).toBeDefined();
  expect((views[1] as PluginView).components['clients-value']?.text).toBe('0');
});

it('keeps the view when a read fails, and logs one run of failures once', async () => {
  vi.useFakeTimers();
  const logged: string[] = [];
  const run = runner({
    list: kept(),
    port: ok(''),
    show: [ok(UP), no('the service is gone'), no('the service is gone'), ok(UP), no('the service is back down')],
  });
  const { views } = await running(run, (line) => { logged.push(line); });
  expect(views).toHaveLength(1);

  await vi.advanceTimersByTimeAsync(POLL_MS);
  await vi.advanceTimersByTimeAsync(POLL_MS);
  // Two failures in a row: the page is the last good state, and one line says why.
  expect(views).toHaveLength(1);
  expect(logged.filter((line) => line.includes('the service is gone'))).toHaveLength(1);

  // A success ends the run of failures, so the next one is said again.
  await vi.advanceTimersByTimeAsync(POLL_MS);
  await vi.advanceTimersByTimeAsync(POLL_MS);
  expect(views).toHaveLength(1);
  expect(logged.filter((line) => line.includes('the service is back down'))).toHaveLength(1);
});

it('stops the poll and clears the view when the tunnel stops', async () => {
  vi.useFakeTimers();
  const run = runner({ list: kept(), port: ok(''), show: ok(UP) });
  const { views, cleared, events } = await running(run);
  const reads = run.calls.filter((one) => one[0] === 'show').length;

  await raise(events, { type: 'stopping' });
  expect(cleared).toEqual(['main']);

  await vi.advanceTimersByTimeAsync(POLL_MS * 2);
  expect(run.calls.filter((one) => one[0] === 'show')).toHaveLength(reads);
  expect(views).toHaveLength(1);
});

it('starts no poll when the tunnel stops during its first read', async () => {
  vi.useFakeTimers();
  let answer: (result: Result) => void = () => {};
  const base = runner({ list: kept(), port: ok('') });
  const run: Runner = (args) => {
    if (args[0] !== 'show') return base(args);
    base.calls.push([...args]);
    return new Promise<Result>((resolve) => { answer = resolve; });
  };
  const views: PluginView[] = [];
  const { host, contribution } = pluginHost('tunnel', context(), { showView: (_surface, view) => { views.push(view); } });
  await apply(host, { runner: run, spawner });
  const listened = raise(contribution.events, listening);
  await vi.advanceTimersByTimeAsync(0);
  expect(base.calls.filter((one) => one[0] === 'show')).toHaveLength(1);

  await raise(contribution.events, { type: 'stopping' });
  answer(ok(UP));
  await listened;
  await vi.advanceTimersByTimeAsync(POLL_MS * 2);
  expect(base.calls.filter((one) => one[0] === 'show')).toHaveLength(1);
  expect(views).toEqual([]);
});
