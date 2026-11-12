import { invokeOperation, loggerOf, memoryRecords, tunnelsChannel } from '@ahpd/sdk';
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

/** A service that puts a port up and takes it down, with no network behind it. */
const serving = (): Service => ({
  add: async (_connector, port) => ({ remote: { id: 't1', labels: [] }, url: `https://port-${port}.example.com/` }),
  access: async () => {},
  replace: async () => undefined,
  remove: async () => {},
  restart: async () => {},
  show: async () => undefined,
  close: async () => {},
});

it('answers the system tunnel with its connector and the well-known port', async () => {
  const { kind } = kindOf({ connector: 'mine', anonymous: true });

  expect(await kind.system?.({ port: 9187 })).toEqual({
    connector: 'mine',
    port: TUNNEL_PORT,
    anonymous: true,
  });
});

it('lists on a devtunnel record only the operations its status offers now', async () => {
  const URI = 'x-ahpd-tunnels://';
  const collection = await memoryRecords().collection('tunnels', { format: 'json' });
  const tunnels = tunnelsChannel({
    collection,
    kinds: () => ({ devtunnel: { ...kindOf({ service: serving() }).kind, by: 'tunnel-devtunnel' } }),
    vault: () => undefined,
    check: () => {},
  });
  const command = invokeOperation({ channels: () => ({ [URI]: tunnels.operations }), check: () => {} });

  // A create starts the tunnel, so it is running from its first row.
  const made = await command.handle({
    channel: URI,
    operationId: 'devtunnel/create',
    input: { connector: 'mine', port: 8080 },
  }, undefined, 'c1') as Record<string, unknown>;
  const id = String(made['id']);

  const idsOf = async (): Promise<string[]> => {
    const state = await tunnels.channel.channel.snapshot(URI, undefined, 'c1') as Record<string, unknown>;
    const entry = (state['records'] as Record<string, unknown>[]).find((one) => one['id'] === id)!;
    return (entry['record'] as Record<string, unknown>)['operations'] as string[];
  };

  expect(await idsOf()).toEqual([
    'devtunnel/update', 'devtunnel/remove', 'devtunnel/disable', 'devtunnel/stop', 'devtunnel/restart', 'devtunnel/anonymous',
  ]);

  await command.handle({ channel: URI, operationId: 'devtunnel/stop', target: { id } }, undefined, 'c1');
  const stopped = await idsOf();
  expect(stopped).toContain('devtunnel/start');
  expect(stopped).not.toContain('devtunnel/stop');
  expect(stopped).not.toContain('devtunnel/restart');
  expect(stopped).toContain('devtunnel/anonymous');
});


it('adds no system tunnel without a connector, and says what to set', async () => {
  const { kind, alerts } = kindOf();

  expect(await kind.system?.({ port: 9187 })).toBeUndefined();
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.level).toBe('warning');
  expect(alerts[0]?.text).toContain('`connector`');
  expect(alerts[0]?.text).toContain('Sign in to a devtunnel connector');
});
