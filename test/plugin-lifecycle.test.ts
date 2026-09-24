import { expect, it } from 'vitest';
import { pluginHost, raise } from '../packages/sdk/src/plugins.js';
import type { PluginContext } from '../packages/sdk/src/types/plugin.js';

/*
 * The two moments around the daemon's socket, and the line a plugin may add to
 * what the daemon announces.
 *
 * `listening` and `stopping` are the only events the daemon raises rather than
 * the host: a host answers connections and never opens one, so the listener is
 * not its to report. What is under test is that they reach a plugin under the
 * same rules every other event does, and that `say` is a separate thing from
 * `log` - because only one of the two is parsed by `ahpd status`.
 */

const context = (over: Partial<PluginContext> = {}): PluginContext => ({
  path: '/work',
  paths: ['/work'],
  version: '0.6.3',
  log: () => {},
  say: () => {},
  ...over,
});

it('hands a listening handler what the socket actually bound', async () => {
  const seen: unknown[] = [];
  const { host, contribution } = pluginHost('tunnel', context());
  host.on('listening', (event) => { seen.push(event); });

  await raise(contribution.events, {
    type: 'listening', runtime: 'node', host: '127.0.0.1', port: 9187, guarded: false,
  });

  expect(seen).toEqual([
    { type: 'listening', runtime: 'node', host: '127.0.0.1', port: 9187, guarded: false },
  ]);
});

it('routes on event.type, so a stopping handler hears only stopping', async () => {
  const heard: string[] = [];
  const { host, contribution } = pluginHost('tunnel', context());
  host.on('listening', () => { heard.push('listening'); });
  host.on('stopping', () => { heard.push('stopping'); });

  await raise(contribution.events, { type: 'stopping' });
  expect(heard).toEqual(['stopping']);
});

it('awaits a slow handler, so a tunnel is up before the daemon announces', async () => {
  const order: string[] = [];
  const { host, contribution } = pluginHost('tunnel', context());
  host.on('listening', async () => {
    await new Promise((done) => { setTimeout(done, 5); });
    order.push('handler');
  });

  await raise(contribution.events, {
    type: 'listening', runtime: 'node', host: '127.0.0.1', port: 9187, guarded: false,
  });
  order.push('after');

  expect(order).toEqual(['handler', 'after']);
});

it('reports a handler that throws against its plugin and carries on', async () => {
  const problems: string[] = [];
  const ran: string[] = [];
  const first = pluginHost('bad', context());
  const second = pluginHost('good', context());
  first.host.on('stopping', () => { throw new Error('no tunnel to take down'); });
  second.host.on('stopping', () => { ran.push('good'); });

  await raise(
    { stopping: [...(first.contribution.events.stopping ?? []), ...(second.contribution.events.stopping ?? [])] },
    { type: 'stopping' },
    (line) => { problems.push(line); },
  );

  expect(problems).toEqual(['bad failed at stopping: no tunnel to take down']);
  expect(ran).toEqual(['good']);
});

it('does nothing, and does not throw, when nobody subscribed', async () => {
  await expect(raise(undefined, { type: 'stopping' })).resolves.toBeUndefined();
  await expect(raise({}, { type: 'stopping' })).resolves.toBeUndefined();
});

it('keeps say apart from log, because only one of them is announced', () => {
  const logged: string[] = [];
  const said: string[] = [];
  const { host } = pluginHost('tunnel', context({
    log: (line) => { logged.push(line); },
    say: (line) => { said.push(line); },
  }));

  host.log('made a tunnel');
  host.say('tunnel abc123, port 31546');

  expect(logged).toEqual(['made a tunnel']);
  expect(said).toEqual(['tunnel abc123, port 31546']);
});
