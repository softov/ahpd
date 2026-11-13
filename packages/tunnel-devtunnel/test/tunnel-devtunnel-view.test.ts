import { loggerOf } from '@ahpd/sdk';
import { afterEach, expect, it, vi } from 'vitest';
import { pluginHost } from '../../sdk/src/plugins/plugins.js';
import { checkView } from '../../sdk/src/plugins/view.js';
import type { Alert, LoaderContext, PluginView } from '../../sdk/src/types/plugin.js';
import type { Tunnel } from '../../sdk/src/types/tunnels.js';
import { TUNNEL_PORT } from '../src/discovery.js';
import { devtunnelKind, POLL_MS } from '../src/kind.js';
import type { KindOptions } from '../src/kind.js';
import type { Service, Shown } from '../src/service.js';
import { WAIT_MS } from '../../../tools/wait.ts';

/*
 * The plugin's page, and the poll behind it.
 *
 * The service's answers are fixtures of the fields the page draws - the id, the
 * port's URL and the host and client counts - and fake timers stand in for the
 * thirty seconds between one read and the next. Nothing is reached: the service
 * is a script of answers, and the only Dev Tunnel in the file is made up.
 */

const TUNNEL = 'otter-1234';
const URL = `https://url-${String(TUNNEL_PORT)}.example.test/`;

/** A tunnel the service holds, with one host and two clients on it. */
const UP: Shown = { id: TUNNEL, url: URL, hosts: 1, clients: 2 };

/** The same tunnel after the relay dropped: no host is connected. */
const DOWN: Shown = { id: TUNNEL, hosts: 0, clients: 0 };

/** A read that failed, as the service's error. */
const failed = (why: string): Error => new Error(why);

/** One answer, a failure, or a promise that is answered by the test. */
type Answer = Shown | Error | Promise<Shown>;

/** A service that answers `show` from a script, and counts what it was asked. */
const scripted = (answers: Answer[]) => {
  const calls = { shown: 0 };
  const next = (): Promise<Shown | undefined> => {
    const at = answers[Math.min(calls.shown, answers.length - 1)];
    calls.shown += 1;
    if (at === undefined) return Promise.resolve(undefined);
    if (at instanceof Error) return Promise.reject(at);
    return Promise.resolve(at);
  };
  const service: Service = {
    add: async () => ({ remote: { id: TUNNEL, labels: [] }, url: URL }),
    access: async () => {},
    replace: async () => URL,
    carry: () => {},
    remove: async () => {},
    restart: async () => {},
    show: next,
    close: async () => {},
  };
  return { service, calls };
};

const context = (over: Partial<LoaderContext> = {}): LoaderContext => ({
  path: '/work', paths: ['/work'], version: '0.10.0', hostName: 'test', configDir: '/work', log: loggerOf(() => {}), say: () => {}, ...over,
});

/** The system tunnel, which is the one this plugin draws. */
const SYSTEM: Tunnel = {
  id: 'devtunnel-system',
  kind: 'devtunnel',
  plugin: 'tunnel-devtunnel',
  purpose: 'system',
  enabled: true,
  settings: { connector: 'mine', port: TUNNEL_PORT, anonymous: false },
};

/** The kind over a service, with what it drew, said and warned kept. */
const kindFor = (service: Service, over: Partial<KindOptions> = {}) => {
  const views: PluginView[] = [];
  const alerts: Alert[] = [];
  const logged: string[] = [];
  const clearedViews: string[] = [];
  const clearedAlerts: string[] = [];
  const { host } = pluginHost('tunnel', context({
    log: loggerOf((line: string) => { logged.push(line); }),
  }), {
    alert: (alert) => { alerts.push(alert); },
    clearAlert: (ref) => { clearedAlerts.push(ref); },
    showView: (_surface, view) => { views.push(view); },
    clearView: (surface) => { clearedViews.push(surface ?? 'main'); },
  });
  const kind = devtunnelKind({
    plugin: host,
    service,
    connector: 'mine',
    anonymous: false,
    keep: true,
    open: () => true,
    daemonPort: () => TUNNEL_PORT,
    guarded: () => false,
    ...over,
  });
  return { kind, views, alerts, logged, clearedViews, clearedAlerts };
};

/** The kind started on the system tunnel, with its first read in `views`. */
const running = async (answers: Answer[], over: Partial<KindOptions> = {}) => {
  const made = scripted(answers);
  const harness = kindFor(made.service, over);
  await harness.kind.create(SYSTEM, () => {});
  return { ...harness, calls: made.calls };
};

afterEach(() => { vi.useRealTimers(); });

// The page ----------------------------------------------------------------

it('shows a view the sdk accepts, with the URL and every value on it', async () => {
  vi.useFakeTimers();
  const { views } = await running([UP]);
  expect(views).toHaveLength(1);
  const view = views[0] as PluginView;

  expect(() => { checkView(view, 'main', 'tunnel', {}); }).not.toThrow();
  expect(view.components['address']).toEqual({ id: 'address', component: 'Link', label: URL, href: URL });
  expect(view.components['tunnel-value']?.text).toBe(TUNNEL);
  expect(view.components['port-value']?.text).toBe(String(TUNNEL_PORT));
  expect(view.components['relay-up']?.text).toBe('The relay is up');
  expect(view.components['clients-value']?.text).toBe('2');
  expect(view.components['body']?.children).toEqual(['status', 'rule', 'tunnel', 'port', 'clients']);
  expect(view.components['status']?.children).toEqual(['address', 'relay-up']);
  expect(view.components['relay-up']?.tone).toBe('success');
});

it('says the address is not ready rather than drawing a Link the sdk would refuse', async () => {
  vi.useFakeTimers();
  const { views } = await running([DOWN]);
  const view = views[0] as PluginView;
  expect(view.components['address']).toEqual({ id: 'address', component: 'Text', text: 'The tunnel address is not ready' });
  expect(view.components['relay-down']?.text).toBe('The relay is down');
  expect(view.components['relay-down']?.tone).toBe('danger');
  expect(() => { checkView(view, 'main', 'tunnel', {}); }).not.toThrow();
});

// The poll ----------------------------------------------------------------

it('draws the state again only when it changed', async () => {
  vi.useFakeTimers();
  const { views, calls } = await running([UP, UP, DOWN]);
  expect(views).toHaveLength(1);

  await vi.advanceTimersByTimeAsync(POLL_MS);
  // The same answer is read again and says nothing: the page is what it was.
  expect(views).toHaveLength(1);
  expect(calls.shown).toBe(2);

  await vi.advanceTimersByTimeAsync(POLL_MS);
  expect(views).toHaveLength(2);
  expect((views[1] as PluginView).components['relay-down']).toBeDefined();
  expect((views[1] as PluginView).components['clients-value']?.text).toBe('0');
});

it('keeps the view when a read fails, and logs one run of failures once', async () => {
  vi.useFakeTimers();
  const { views, logged } = await running([
    UP,
    failed('the service is gone'),
    failed('the service is gone'),
    UP,
    failed('the service is back down'),
  ]);
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

it('warns on the row once for a run of failed reads, and clears it on the next good one', async () => {
  vi.useFakeTimers();
  const { alerts, clearedAlerts } = await running([
    failed('the service is gone'),
    failed('the service is gone'),
    UP,
  ]);
  expect(alerts).toEqual([{
    level: 'warning',
    ref: 'read',
    text: 'The tunnel\'s status could not be checked, so this page may be out of date.',
  }]);

  await vi.advanceTimersByTimeAsync(POLL_MS);
  expect(alerts).toHaveLength(1);

  await vi.advanceTimersByTimeAsync(POLL_MS);
  expect(clearedAlerts).toContain('read');
});

it('stops the poll and clears the view when the tunnel stops', async () => {
  vi.useFakeTimers();
  const { kind, views, clearedViews, calls } = await running([UP]);
  expect(views).toHaveLength(1);

  await kind.invoke('stop', SYSTEM, () => {});
  expect(clearedViews).toContain('main');

  await vi.advanceTimersByTimeAsync(POLL_MS * 2);
  expect(calls.shown).toBe(1);
  expect(views).toHaveLength(1);
});

it('starts no poll when the tunnel stops during its first read', async () => {
  vi.useFakeTimers();
  let answer: (shown: Shown) => void = () => {};
  const pending = new Promise<Shown>((done) => { answer = done; });
  const shown: Shown[] = [];
  const service: Service = {
    add: async () => ({ remote: { id: TUNNEL, labels: [] }, url: URL }),
    access: async () => {},
    replace: async () => URL,
    carry: () => {},
    remove: async () => {},
    restart: async () => {},
    show: async () => { shown.push(UP); return await pending; },
    close: async () => {},
  };
  const { kind, views } = kindFor(service);

  const started = kind.create(SYSTEM, () => {});
  // The first read comes after the tunnel id is digested by `crypto.subtle`,
  // which answers from the thread pool and not after a count of event-loop
  // turns, so the read is waited for by the clock.
  await vi.waitFor(() => { expect(shown).toHaveLength(1); }, { timeout: WAIT_MS });

  await kind.invoke('stop', SYSTEM, () => {});
  answer(UP);
  await started;
  await vi.advanceTimersByTimeAsync(POLL_MS * 2);
  expect(shown).toHaveLength(1);
  expect(views).toEqual([]);
});
