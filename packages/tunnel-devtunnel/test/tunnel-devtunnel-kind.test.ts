import { loggerOf } from '@ahpd/sdk';
import { expect, it } from 'vitest';
import { pluginHost } from '../../sdk/src/plugins/plugins.js';
import { checkTunnelKind } from '../../sdk/src/plugins/validate.js';
import type { Alert, LoaderContext } from '../../sdk/src/types/plugin.js';
import { TUNNEL_PORT } from '../src/discovery.js';
import { devtunnelKind, NAME, OPERATIONS, SCHEMA } from '../src/kind.js';
import type { KindOptions } from '../src/kind.js';
import type { Service } from '../src/service.js';

/*
 * The kind as the host registers it: the form, the verbs and the system tunnel.
 *
 * Nothing here starts a tunnel, so the service is a set of methods that refuse
 * to be called. What a start does is in `tunnel-devtunnel.test.ts`, over a fake
 * SDK; this file is the declaration a client reads and the host checks.
 */

/** A service no case here reaches. */
const unreached = (): Service => ({
  add: async () => { throw new Error('this test starts no tunnel'); },
  access: async () => { throw new Error('this test starts no tunnel'); },
  replace: async () => { throw new Error('this test starts no tunnel'); },
  remove: async () => { throw new Error('this test starts no tunnel'); },
  restart: async () => { throw new Error('this test starts no tunnel'); },
  show: async () => { throw new Error('this test starts no tunnel'); },
  close: async () => { throw new Error('this test starts no tunnel'); },
});

/** The kind, the plugin host it is registered through, and the alerts it raised. */
const kindOf = (over: Partial<KindOptions> = {}) => {
  const alerts: Alert[] = [];
  const context: LoaderContext = {
    path: '/work', paths: ['/work'], version: '0.6.3', hostName: 'test', configDir: '/work', log: loggerOf(() => {}), say: () => {},
  };
  const { host } = pluginHost('tunnel', context, {
    alert: (alert) => { alerts.push(alert); },
  });
  const kind = devtunnelKind({
    plugin: host,
    service: unreached(),
    anonymous: false,
    keep: true,
    open: () => true,
    daemonPort: () => TUNNEL_PORT,
    guarded: () => false,
    ...over,
  });
  return { kind, alerts };
};

it('passes the registration check, with the connector mark, the port and anonymous off', () => {
  expect(() => { checkTunnelKind(kindOf().kind, 'tunnel-devtunnel'); }).not.toThrow();

  const properties = SCHEMA['properties'] as Record<string, Record<string, unknown>>;
  expect(properties['connector']).toMatchObject({ type: 'string', 'x-ahpd-connector': NAME });
  expect(properties['port']).toMatchObject({ type: 'number' });
  expect(properties['anonymous']).toMatchObject({ type: 'boolean', default: false });
  expect(SCHEMA['required']).toEqual(['connector', 'port']);
});

it('lists start, stop, restart and anonymous, and anonymous takes on', () => {
  expect(OPERATIONS.map((one) => one.id)).toEqual(['start', 'stop', 'restart', 'anonymous']);
  const anonymous = OPERATIONS.find((one) => one.id === 'anonymous');
  expect(anonymous?.input).toMatchObject({
    type: 'object',
    properties: { on: { type: 'boolean' } },
    required: ['on'],
  });
});

it('answers the system tunnel with its connector and the well-known port', async () => {
  const { kind } = kindOf({ connector: 'mine', anonymous: true });

  expect(await kind.system?.({ port: 9187 })).toEqual({
    connector: 'mine',
    port: TUNNEL_PORT,
    anonymous: true,
  });
});

it('adds no system tunnel without a connector, and says what to set', async () => {
  const { kind, alerts } = kindOf();

  expect(await kind.system?.({ port: 9187 })).toBeUndefined();
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.level).toBe('warning');
  expect(alerts[0]?.text).toContain('`connector`');
  expect(alerts[0]?.text).toContain('Sign in to a devtunnel connector');
});
