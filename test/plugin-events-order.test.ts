import { expect, it } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { foldHostOptions, pluginHost } from '../packages/sdk/src/plugins.js';
import { sdkVersion } from '../packages/sdk/src/version.js';
import { echo } from '../examples/echo/agent.js';
import type { EventName, HostEvent } from '../packages/sdk/src/types/events.js';
import type { HostOptions } from '../packages/sdk/src/types/host.js';
import type { PluginContext } from '../packages/sdk/src/types/plugin.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * The rules around the call, not the call sites: order, awaiting, a handler
 * that throws, and a `log` listener that logs.
 *
 * A handler is on the path of what it observes, so these are the properties
 * that make subscribing safe to offer: two plugins see a moment in
 * configuration order, an asynchronous handler is finished before the next
 * begins, and a broken one costs a line rather than the turn.
 */

const DIR = '/tmp/plugin-events-order';
const ROOT = 'ahp-root://';

const peer = (): Peer => ({
  send: () => {},
  notify: () => {},
  request: async () => ({}),
  answered: () => {},
  close: () => {},
});

const settle = async (times = 12): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

interface Subscription {
  by: string;
  event: EventName;
  handle: (event: HostEvent, context: PluginContext) => void | Promise<void>;
}

/** One host, one contribution per subscription's plugin, in the order given. */
function built(subscriptions: Subscription[]) {
  const lines: string[] = [];
  const ctxLines: string[] = [];
  const contributions = subscriptions.map((one) => {
    const context: PluginContext = {
      path: DIR,
      paths: [DIR],
      version: sdkVersion(),
      log: (line) => { ctxLines.push(`${one.by}: ${line}`); },
    };
    const { host, contribution } = pluginHost(one.by, context);
    host.on(one.event, one.handle);
    return contribution;
  });

  const base: HostOptions = {
    path: DIR,
    agents: [echo({ path: DIR, pace: 0 })],
    onEvent: (line) => { lines.push(line); },
  };
  const { options } = foldHostOptions(base, contributions);
  const host = createHost(options);
  const client = host.accept(peer());
  return { client, lines, ctxLines };
}

const hello = (client: ReturnType<ReturnType<typeof createHost>['accept']>) => client.handle({
  method: 'initialize',
  params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: [ROOT] },
});

const create = (client: ReturnType<ReturnType<typeof createHost>['accept']>) => client.handle({
  method: 'createSession',
  params: { channel: 'ahp-session:/one', provider: 'echo' },
});

it('calls two plugins on one event in the order they were configured', async () => {
  const order: string[] = [];
  const { client } = built([
    { by: 'alpha', event: 'session_start', handle: () => { order.push('alpha'); } },
    { by: 'beta', event: 'session_start', handle: () => { order.push('beta'); } },
  ]);
  await hello(client);
  await create(client);
  await settle();
  expect(order).toEqual(['alpha', 'beta']);
});

it('finishes an asynchronous handler before the next one runs', async () => {
  const order: string[] = [];
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { client } = built([
    { by: 'alpha', event: 'session_start', handle: async () => { await gate; order.push('alpha'); } },
    { by: 'beta', event: 'session_start', handle: () => { order.push('beta'); } },
  ]);
  await hello(client);
  await create(client);
  await settle();

  // Beta has not run: alpha is still awaiting, which is the whole point of
  // awaiting each handler rather than starting them all.
  expect(order).toEqual([]);
  release();
  await settle();
  expect(order).toEqual(['alpha', 'beta']);
});

it('reports a throwing handler against its plugin and runs the next one', async () => {
  const order: string[] = [];
  const { client, lines } = built([
    { by: 'alpha', event: 'session_start', handle: () => { order.push('alpha'); throw new Error('alpha broke'); } },
    { by: 'beta', event: 'session_start', handle: () => { order.push('beta'); } },
  ]);
  await hello(client);
  await create(client);
  await settle();

  expect(order).toEqual(['alpha', 'beta']);
  const reports = lines.filter((line) => line.includes('alpha failed at session_start: alpha broke'));
  expect(reports).toHaveLength(1);
});

it('does not reject the action that raised the event', async () => {
  const { client } = built([
    { by: 'alpha', event: 'session_start', handle: () => { throw new Error('alpha broke'); } },
  ]);
  await hello(client);
  // The request that started the session answers, and the session is there,
  // even though a listener threw while it was being announced.
  await expect(create(client)).resolves.toBeDefined();
  await settle();
  const listed = await client.handle({ method: 'listSessions', params: { channel: ROOT } }) as { items: unknown[] };
  expect(listed.items).toHaveLength(1);
});

it('tells a log handler that logs once, and does not recurse', async () => {
  const seen: string[] = [];
  const { client, lines, ctxLines } = built([
    {
      by: 'alpha',
      event: 'log',
      handle: (event, context) => {
        seen.push((event as { line: string }).line);
        // The handler's own logger is the context it was handed, which is the
        // loader's writer and not this host's `log`, so it cannot re-raise the
        // event; the flag in `fire` is what would stop it if it could.
        context.log('from the handler');
      },
    },
  ]);
  await hello(client);
  await create(client);
  await settle();

  // The handler ran, and its own line went to its logger rather than back
  // through the event it is observing.
  expect(ctxLines).toContain('alpha: from the handler');
  expect(seen.length).toBeGreaterThan(0);
  expect(seen).toEqual(lines);
  expect(seen.some((line) => line.includes('from the handler'))).toBe(false);
});

it('does nothing when an event has no listeners', async () => {
  const order: string[] = [];
  const { client } = built([
    { by: 'alpha', event: 'turn_end', handle: () => { order.push('turn_end'); } },
  ]);
  await hello(client);
  await expect(create(client)).resolves.toBeDefined();
  await settle();
  expect(order).toEqual([]);
});
