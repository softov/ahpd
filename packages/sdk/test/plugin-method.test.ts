import { loggerOf } from '../src/log.js';
import { expect, it } from 'vitest';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { sdkVersion } from '../src/version.js';
import { root } from './users-gate-helpers.js';
import type { LoaderContext, PluginMethod, ServedMethod } from '../src/types/plugin.js';

/*
 * A plugin registers an `x-` command, and the fold carries it into
 * `HostOptions.methods` beside the daemon's own.
 */

const context = (): LoaderContext => ({ path: root, paths: [root], version: sdkVersion(), hostName: 'test', configDir: root, log: loggerOf(() => {}), say: () => {} });

const echo: PluginMethod = { grant: 'session:list', handle: (params) => params };

it('registers x-test/echo, and the fold carries it into methods', () => {
  const { host: plugin, contribution } = pluginHost('test', context());
  plugin.registerMethod('x-test/echo', echo);
  const { options, problems } = foldHostOptions({ path: root, agents: [] }, [contribution]);
  expect(problems).toEqual([]);
  expect(options.methods?.['x-test/echo']).toEqual({ by: 'test', name: 'x-test/echo', method: echo });
});

it('keeps methods absent when nobody serves one', () => {
  const { contribution } = pluginHost('test', context());
  const { options } = foldHostOptions({ path: root, agents: [] }, [contribution]);
  expect(options).not.toHaveProperty('methods');
});

it('refuses a name without x-, and a name the plugin already registered', () => {
  const { host: plugin } = pluginHost('test', context());
  expect(() => { plugin.registerMethod('test/echo', echo); })
    .toThrow('plugin test: registerMethod needs the name to be a command name that starts with x-, the protocol\'s extension prefix');
  expect(() => { plugin.registerMethod('resourceRead', echo); }).toThrow(/starts with x-/);
  plugin.registerMethod('x-test/echo', echo);
  expect(() => { plugin.registerMethod('x-test/echo', echo); })
    .toThrow('plugin test: registerMethod needs x-test/echo to be a name no other method in this plugin uses');
});

it('refuses a name another plugin serves, and names the holder', () => {
  const first = pluginHost('first', context());
  const second = pluginHost('second', context());
  first.host.registerMethod('x-test/echo', echo);
  second.host.registerMethod('x-test/echo', echo);
  const { options, problems } = foldHostOptions({ path: root, agents: [] }, [first.contribution, second.contribution]);
  expect(problems).toEqual(['plugin second registers method x-test/echo, which plugin first already serves']);
  expect(options.methods?.['x-test/echo']?.by).toBe('first');
});

it('refuses a name the daemon serves, and keeps the daemon\'s', () => {
  const own: ServedMethod = { by: 'ahpd', name: 'x-ahpd/usage/totals', method: echo };
  const { host: plugin, contribution } = pluginHost('test', context());
  plugin.registerMethod('x-ahpd/usage/totals', { grant: 'session:list', handle: () => 'theirs' });
  plugin.registerMethod('x-test/echo', echo);
  const { options, problems } = foldHostOptions({ path: root, agents: [], methods: { [own.name]: own } }, [contribution]);
  expect(problems).toEqual(['plugin test registers method x-ahpd/usage/totals, which the daemon already serves']);
  expect(options.methods?.['x-ahpd/usage/totals']).toBe(own);
  expect(Object.keys(options.methods ?? {})).toEqual(['x-ahpd/usage/totals', 'x-test/echo']);
});

it('refuses a registration after apply returned', () => {
  const { host: plugin, seal } = pluginHost('test', context());
  seal();
  expect(() => { plugin.registerMethod('x-test/echo', echo); }).toThrow(/after apply returned/);
});
