/*
 * What a plugin registers to run when the host closes.
 *
 * `registerClose` is where a plugin stops the work the host does not own: a
 * timer it armed, a removal it started, a child process it spawned. The fold
 * carries every registration into `HostOptions.closers` in load order, with the
 * name of the plugin that made it - decision
 * `a-plugin-is-told-when-the-host-closes`.
 */

import { expect, it } from 'vitest';
import { foldHostOptions, pluginHost } from '../src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import type { HostOptions } from '../src/types/host.js';
import type { PluginContext } from '../src/types/plugin.js';

const base = (): HostOptions => ({ path: '/tmp/plugins-close', agents: [echo({ path: '/tmp/plugins-close' })] });

const context: PluginContext = {
  path: '/tmp/plugins-close',
  paths: ['/tmp/plugins-close'],
  version: '0.0.0',
  hostName: 'host',
  configDir: '/tmp/plugins-close',
  log: () => {},
  say: () => {},
};

it('keeps every closer a plugin registered, with its name and in registration order', async () => {
  const alpha = pluginHost('alpha', context);
  const beta = pluginHost('beta', context);
  const ran: string[] = [];
  // Called more than once, which is a plugin with two things to stop.
  alpha.host.registerClose(() => { ran.push('first'); });
  alpha.host.registerClose(async () => { ran.push('second'); });
  beta.host.registerClose(() => { ran.push('beta'); });

  const { options, problems } = foldHostOptions(base(), [alpha.contribution, beta.contribution]);
  expect(problems).toEqual([]);
  expect(options.closers?.map((one) => one.by)).toEqual(['alpha', 'alpha', 'beta']);

  for (const one of options.closers ?? []) await one.close();
  expect(ran).toEqual(['first', 'second', 'beta']);
});

it('leaves closers absent when no plugin registered one', () => {
  const { options } = foldHostOptions(base(), [pluginHost('alpha', context).contribution]);

  expect(options.closers).toBeUndefined();
});

it('keeps a closer the base was handed, before every plugin\'s', () => {
  const hold = (): void => {};
  const { options } = foldHostOptions({ ...base(), closers: [{ by: 'the daemon', close: hold }] }, [
    pluginHost('alpha', context).contribution,
  ]);

  expect(options.closers?.map((one) => one.by)).toEqual(['the daemon']);
});

it('refuses a value that is not a function', () => {
  const { host } = pluginHost('alpha', context);

  expect(() => (host.registerClose as (value: unknown) => void)('now'))
    .toThrow('plugin alpha: registerClose needs close to be a function');
});
